const cloud = require('wx-server-sdk');
const nodemailer = require('nodemailer');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const SUPPORTED_STATUSES = new Set(['待审批', '同意申请', '试用中...', '全部入库', '已拒绝']);

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeErrorMessage(err, fallback = '\u5bfc\u51fa\u5931\u8d25') {
  if (!err) {
    return fallback;
  }

  if (typeof err === 'string') {
    return err;
  }

  return err.message || err.errMsg || err.error || fallback;
}

function toDateStart(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function toDateEndExclusive(dateStr) {
  const date = toDateStart(dateStr);
  date.setDate(date.getDate() + 1);
  return date;
}

function getDisplayStatus(order) {
  if (order.审批状态 === '拒绝') {
    return '已拒绝';
  }

  if (order.审批状态 === '待审批') {
    return '待审批';
  }

  if (order.审批状态 === '通过') {
    if (order.入库归还日期) {
      return '全部入库';
    }
    if (order.出库使用日期) {
      return '试用中...';
    }
    return '同意申请';
  }

  return order.审批状态 || '未知';
}

function parseCreateTime(order) {
  return new Date(order.createTime || 0);
}

function escapeCsvValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(orders) {
  const headers = [
    '序号',
    '订单ID',
    '创建时间',
    '使用人',
    '部门',
    '手机号',
    '套餐名称',
    '订单状态',
    '借用码',
    '申请借用日期',
    '预计归还日期',
    '出库使用日期',
    '入库归还日期',
    '资产名称',
    '数量',
    '需求附言',
    '审批人',
    '拒绝理由'
  ];

  const rows = orders.map((order, index) => {
    const row = [
      index + 1,
      order._id || '',
      order.createTime ? new Date(order.createTime).toISOString() : '',
      order.使用人 || '',
      order.部门 || '',
      order.手机号 || '',
      order.套餐名称 || '',
      getDisplayStatus(order),
      order.借用码 || '',
      order.申请借用日期 || '',
      order.预计归还日期 || '',
      order.出库使用日期 || '',
      order.入库归还日期 || '',
      order.资产名称 || '',
      order.数量 || 0,
      order.需求附言 || '',
      order.审批人 || '',
      order.拒绝理由 || ''
    ];

    return row.map(escapeCsvValue).join(',');
  });

  return `\uFEFF${headers.join(',')}\n${rows.join('\n')}`;
}

async function queryOrdersByFilters({ startAt, departments }) {
  const where = {
    createTime: _.gte(startAt)
  };

  if (departments.length > 0) {
    where.部门 = _.in(departments);
  }

  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await db.collection('orders')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get();

    all.push(...res.data);

    if (res.data.length < PAGE_SIZE) {
      break;
    }
  }

  return all;
}

async function uploadCsv(csvContent) {
  const fileName = `exports/orders_${Date.now()}.csv`;
  const uploadRes = await cloud.uploadFile({
    cloudPath: fileName,
    fileContent: Buffer.from(csvContent, 'utf8')
  });

  const tempRes = await cloud.getTempFileURL({ fileList: [uploadRes.fileID] });
  const tempFileURL = tempRes.fileList && tempRes.fileList[0] ? tempRes.fileList[0].tempFileURL : '';

  return {
    fileID: uploadRes.fileID,
    tempFileURL
  };
}

function createMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const secure = String(process.env.SMTP_SECURE || 'true') === 'true';

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function sendCsvByEmail({ email, startDate, endDate, csvContent }) {
  const transporter = createMailer();

  if (!transporter) {
    return {
      sent: false,
      message: '邮件服务未配置（缺少 SMTP 环境变量）'
    };
  }

  const subject = `快借快还订单导出 ${startDate} 至 ${endDate}`;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to: email,
    subject,
    text: `请查收附件 CSV（时间范围：${startDate} 至 ${endDate}）。`,
    attachments: [
      {
        filename: `orders_${startDate}_${endDate}.csv`,
        content: csvContent,
        contentType: 'text/csv; charset=utf-8'
      }
    ]
  });

  return {
    sent: true,
    message: `CSV 已发送到 ${email}`
  };
}

async function handleExportOrdersCsv(payload) {
  const { startDate, endDate, statuses, departments, email } = payload;

  if (!startDate || !endDate) {
    return { success: false, error: '时间范围不能为空' };
  }

  const startAt = toDateStart(startDate);
  const endAt = toDateStart(endDate);

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { success: false, error: '\u65f6\u95f4\u683c\u5f0f\u65e0\u6548\uff0c\u8bf7\u4f7f\u7528 YYYY-MM-DD' };
  }

  if (endAt < startAt) {
    return { success: false, error: '\u7ed3\u675f\u65e5\u671f\u4e0d\u80fd\u65e9\u4e8e\u5f00\u59cb\u65e5\u671f' };
  }

  if (!Array.isArray(statuses) || statuses.length === 0) {
    return { success: false, error: '请至少选择一个订单状态' };
  }

  if (!email || !isValidEmail(email)) {
    return { success: false, error: '请输入有效邮箱地址' };
  }

  const safeStatuses = statuses.filter(status => SUPPORTED_STATUSES.has(status));
  if (safeStatuses.length === 0) {
    return { success: false, error: '订单状态参数无效' };
  }

  const safeDepartments = Array.isArray(departments)
    ? departments.map(item => String(item || '').trim()).filter(Boolean)
    : [];

  const endExclusive = toDateEndExclusive(endDate);
  const rawOrders = await queryOrdersByFilters({
    startAt,
    departments: safeDepartments
  });

  const filtered = rawOrders.filter(order => {
    const createTime = parseCreateTime(order);
    const inRange = createTime >= startAt && createTime < endExclusive;
    if (!inRange) {
      return false;
    }

    const statusMatched = safeStatuses.includes(getDisplayStatus(order));
    if (!statusMatched) {
      return false;
    }

    if (safeDepartments.length === 0) {
      return true;
    }

    return safeDepartments.includes(order.部门 || '');
  });

  const csvContent = buildCsv(filtered);
  const { fileID, tempFileURL } = await uploadCsv(csvContent);

  let emailSent = false;
  let message = '';
  try {
    const mailRes = await sendCsvByEmail({
      email,
      startDate,
      endDate,
      csvContent
    });
    emailSent = mailRes.sent;
    message = mailRes.message;
  } catch (error) {
    emailSent = false;
    message = `\u90ae\u4ef6\u53d1\u9001\u5931\u8d25\uff1a${normalizeErrorMessage(error, '\u672a\u77e5\u9519\u8bef')}`;
  }

  return {
    success: true,
    total: filtered.length,
    emailSent,
    message,
    fileID,
    tempFileURL
  };
}

exports.main = async event => {
  const { action, payload = {} } = event;

  try {
    if (action === 'exportOrdersCsv') {
      return await handleExportOrdersCsv(payload);
    }

    return {
      success: false,
      error: 'Unknown action',
      message: 'Unknown action'
    };
  } catch (err) {
    console.error(err);
    const message = normalizeErrorMessage(err);
    return {
      success: false,
      error: message,
      message
    };
  }
};


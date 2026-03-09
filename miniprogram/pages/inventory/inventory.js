const app = getApp();
const { formatDateTime, formatDateToYMD } = require('../../utils/order');

const EXPORT_STATUS_OPTIONS = ['待审批', '同意申请', '试用中...', '全部入库', '已拒绝'];

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractResultError(result, fallback = '\u5bfc\u51fa\u5931\u8d25') {
  if (!result || typeof result !== 'object') {
    return fallback;
  }

  return result.error || result.errMsg || result.message || result.msg || fallback;
}

function getDefaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 60);
  return formatDateToYMD(date);
}

Page({
  data: {
    isAdmin: false,
    pendingOrders: [],
    recentOrders: [],
    totalPending: 0,
    showExportDialog: false,
    exportSubmitting: false,
    exportForm: {
      startDate: '',
      endDate: '',
      email: ''
    },
    statusOptions: EXPORT_STATUS_OPTIONS.map(label => ({ label, checked: true })),
    deptOptions: []
  },

  onShow() {
    const isAdmin = app.globalData.role === 'admin';
    this.setData({ isAdmin });

    if (isAdmin) {
      this.fetchOrders();
      app.checkPendingOrders();
    }
  },

  async fetchOrders() {
    wx.showLoading({ title: '加载中...' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'getOrders' }
      });

      if (!result || !result.success) {
        throw new Error(result?.error || '获取失败');
      }

      const pendingOrders = result.pendingOrders.map(order => this.mapOrder(order));
      const recentOrders = result.recentOrders.map(order => this.mapOrder(order));

      this.setData({
        pendingOrders,
        recentOrders,
        totalPending: pendingOrders.length
      });

      this.updateExportDeptOptions(pendingOrders, recentOrders);
    } catch (err) {
      console.error('获取订单失败', err);
      wx.showToast({ title: '获取数据失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  mapOrder(order) {
    let displayStatus = order.审批状态;
    let statusClass = '';

    if (order.审批状态 === '通过') {
      if (order.入库归还日期) {
        displayStatus = '全部入库';
        statusClass = 'returned';
      } else if (order.出库使用日期) {
        displayStatus = '试用中...';
        statusClass = 'active';
      } else {
        displayStatus = '同意申请';
        statusClass = 'approved';
      }
    } else if (order.审批状态 === '拒绝') {
      displayStatus = '已拒绝';
      statusClass = 'rejected';
    }

    return {
      id: order._id,
      applicant: order.使用人,
      dept: order.部门,
      packageName: order.套餐名称,
      status: displayStatus,
      statusClass,
      firstChar: order.使用人 ? order.使用人.substring(0, 1) : '?',
      formatTime: formatDateTime(order.createTime || new Date())
    };
  },

  updateExportDeptOptions(pendingOrders, recentOrders) {
    const deptSet = new Set();
    [...pendingOrders, ...recentOrders].forEach(order => {
      if (order.dept) {
        deptSet.add(order.dept);
      }
    });

    const sorted = Array.from(deptSet).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    const currentSelected = new Set(this.data.deptOptions.filter(item => item.checked).map(item => item.label));
    const hasCurrent = this.data.deptOptions.length > 0;

    const deptOptions = sorted.map(label => ({
      label,
      checked: hasCurrent ? currentSelected.has(label) : true
    }));

    this.setData({ deptOptions });
  },

  onOrderClick(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/approval/approval?id=${id}`
    });
  },

  onExport() {
    const today = formatDateToYMD(new Date());
    const startDate = this.data.exportForm.startDate || getDefaultStartDate();

    this.setData({
      showExportDialog: true,
      exportSubmitting: false,
      exportForm: {
        ...this.data.exportForm,
        startDate,
        endDate: this.data.exportForm.endDate || today
      },
      statusOptions: this.data.statusOptions.map(item => ({ ...item, checked: true })),
      deptOptions: this.data.deptOptions.map(item => ({ ...item, checked: true }))
    });
  },

  onCloseExportDialog() {
    this.setData({
      showExportDialog: false,
      exportSubmitting: false
    });
  },

  noop() {},

  onExportStartDateChange(e) {
    const startDate = e.detail.value;
    this.setData({ 'exportForm.startDate': startDate });

    if (this.data.exportForm.endDate && new Date(this.data.exportForm.endDate) < new Date(startDate)) {
      this.setData({ 'exportForm.endDate': startDate });
    }
  },

  onExportEndDateChange(e) {
    this.setData({ 'exportForm.endDate': e.detail.value });
  },

  onExportEmailInput(e) {
    this.setData({ 'exportForm.email': e.detail.value });
  },

  onExportStatusChange(e) {
    const selected = new Set(e.detail.value);
    this.setData({
      statusOptions: this.data.statusOptions.map(item => ({
        ...item,
        checked: selected.has(item.label)
      }))
    });
  },

  onExportDeptChange(e) {
    const selected = new Set(e.detail.value);
    this.setData({
      deptOptions: this.data.deptOptions.map(item => ({
        ...item,
        checked: selected.has(item.label)
      }))
    });
  },

  getSelectedStatuses() {
    return this.data.statusOptions.filter(item => item.checked).map(item => item.label);
  },

  getSelectedDepartments() {
    return this.data.deptOptions.filter(item => item.checked).map(item => item.label);
  },

  async onSubmitExport() {
    const { startDate, endDate } = this.data.exportForm;
    const email = (this.data.exportForm.email || '').trim();
    const statuses = this.getSelectedStatuses();
    const departments = this.getSelectedDepartments();

    if (!startDate || !endDate) {
      return wx.showToast({ title: '请选择时间范围', icon: 'none' });
    }

    if (new Date(endDate) < new Date(startDate)) {
      return wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' });
    }

    if (statuses.length === 0) {
      return wx.showToast({ title: '请至少选择一个订单状态', icon: 'none' });
    }

    if (this.data.deptOptions.length > 0 && departments.length === 0) {
      return wx.showToast({ title: '请至少选择一个部门', icon: 'none' });
    }

    if (!email || !isValidEmail(email)) {
      return wx.showToast({ title: '请输入有效邮箱地址', icon: 'none' });
    }

    this.setData({ exportSubmitting: true });

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'exportExcel',
        data: {
          action: 'exportOrdersCsv',
          payload: {
            startDate,
            endDate,
            statuses,
            departments,
            email
          }
        }
      });

      if (!result || !result.success) {
        throw new Error(extractResultError(result));
      }

      this.setData({ showExportDialog: false });
      wx.showToast({ title: '导出完成', icon: 'success' });

      if (result.emailSent) {
        wx.showModal({
          title: '导出成功',
          content: `CSV 已发送到：${email}`,
          showCancel: false
        });
      } else if (result.tempFileURL) {
        wx.setClipboardData({
          data: result.tempFileURL,
          success: () => {
            wx.showModal({
              title: '导出完成',
              content: `${result.message || '邮件发送失败'}\n已复制下载链接到剪贴板。`,
              showCancel: false
            });
          }
        });
      } else {
        wx.showModal({
          title: '导出完成',
          content: result.message || 'CSV 已生成',
          showCancel: false
        });
      }
    } catch (err) {
      console.error('导出失败', err);
      const message = err?.message || err?.errMsg || '\u5bfc\u51fa\u5931\u8d25';
      wx.showToast({ title: `导出失败: ${message}`, icon: 'none', duration: 3000 });
    } finally {
      this.setData({ exportSubmitting: false });
    }
  },

  onScanOut() {
    this.scanToPage('/pages/outbound/outbound?code=');
  },

  onScanIn() {
    this.scanToPage('/pages/inbound/inbound?code=');
  },

  scanToPage(prefix) {
    wx.scanCode({
      onlyFromCamera: true,
      success: res => {
        wx.navigateTo({
          url: `${prefix}${res.result}`
        });
      },
      fail: () => {
        wx.showToast({ title: '取消扫码', icon: 'none' });
      }
    });
  }
});

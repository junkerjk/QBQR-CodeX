const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function formatYMD(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatBorrowCodeDatePart(date = new Date()) {
  const yy = String(date.getFullYear()).substring(2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function hasItems(list) {
  return Array.isArray(list) && list.length > 0;
}

async function addOperationLog(data) {
  await db.collection('operation_logs').add({
    data: {
      时间: db.serverDate(),
      ...data
    }
  });
}

async function handleGetPendingCount() {
  const countRes = await db.collection('orders').where({ 审批状态: '待审批' }).count();
  return { success: true, count: countRes.total };
}

async function handleGetOrders() {
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const pendingRes = await db.collection('orders')
    .where({ 审批状态: '待审批' })
    .orderBy('createTime', 'desc')
    .get();

  const recentRes = await db.collection('orders')
    .where({
      createTime: _.gte(sixtyDaysAgo),
      审批状态: _.neq('拒绝')
    })
    .orderBy('createTime', 'desc')
    .limit(20)
    .get();

  return {
    success: true,
    pendingOrders: pendingRes.data,
    recentOrders: recentRes.data
  };
}

async function handleApproveOrder(payload) {
  const { orderId, order, adminName, adminOpenId } = payload;

  const deptCode = order.deptCode || 'AA';
  const userNum = String(order.userNum || '000').padStart(3, '0');
  const datePart = formatBorrowCodeDatePart();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const countRes = await db.collection('orders').where({
    createTime: _.gte(startOfToday),
    审批状态: '通过'
  }).count();

  const seq = String(countRes.total + 1).padStart(2, '0');
  const borrowCode = `${datePart}${deptCode}${userNum}${seq}`;

  await db.collection('orders').doc(orderId).update({
    data: {
      审批状态: '通过',
      借用码: borrowCode,
      审批人: adminName,
      updateTime: db.serverDate()
    }
  });

  await addOperationLog({
    操作人: adminName,
    操作人ID: adminOpenId,
    操作类型: 'APPROVE',
    操作内容: '审批通过',
    关联单据ID: orderId,
    操作对象: `借用码: ${borrowCode}`,
    变更明细: { from: '待审批', to: '通过' }
  });

  return { success: true, borrowCode };
}

async function handleRejectOrder(payload) {
  const { orderId, reason, adminName, adminOpenId } = payload;

  await db.collection('orders').doc(orderId).update({
    data: {
      审批状态: '拒绝',
      拒绝理由: reason,
      审批人: adminName,
      updateTime: db.serverDate()
    }
  });

  await addOperationLog({
    操作人: adminName,
    操作人ID: adminOpenId,
    操作类型: 'REJECT',
    操作内容: '拒绝申请',
    关联单据ID: orderId,
    备注: reason,
    变更明细: { from: '待审批', to: '拒绝' }
  });

  return { success: true };
}

async function handleOutboundOrder(payload) {
  const {
    orderId,
    borrowCode,
    totalCount,
    remark,
    assetNames,
    adminName,
    adminOpenId,
    addedAssets,
    updatedReturnedCounts,
    updatedReturnedList
  } = payload;

  if (hasItems(addedAssets)) {
    for (const asset of addedAssets) {
      await db.collection('assets').doc(asset.id).update({
        data: {
          数量: _.inc(-asset.count)
        }
      });
    }
  }

  const updateData = {
    出库使用日期: formatYMD(),
    资产名称: assetNames,
    数量: totalCount,
    需求附言: remark,
    updateTime: db.serverDate()
  };

  // 追加设备后，订单需要回到“未全部归还”状态。
  if (hasItems(addedAssets)) {
    updateData.入库归还日期 = _.remove();
  }

  if (updatedReturnedCounts) {
    updateData.已归还数量 = updatedReturnedCounts;
  }
  if (updatedReturnedList) {
    updateData.已归还清单 = updatedReturnedList;
  }

  await db.collection('orders').doc(orderId).update({ data: updateData });

  await addOperationLog({
    操作人: adminName,
    操作人ID: adminOpenId,
    操作类型: 'OUTBOUND',
    操作内容: hasItems(addedAssets) ? '追加设备出库' : '确认放行',
    关联单据ID: orderId,
    操作对象: `借用码: ${borrowCode}`,
    设备清单: assetNames,
    修改后附言: remark
  });

  return { success: true };
}

async function handleInboundOrder(payload) {
  const {
    orderId,
    borrowCode,
    updatedReturnedList,
    updatedReturnedCounts,
    allReturned,
    toReturnNames,
    returnedAssets,
    adminName,
    adminOpenId
  } = payload;

  if (hasItems(returnedAssets)) {
    for (const asset of returnedAssets) {
      const assetRes = await db.collection('assets').where(_.or([
        { 名称: asset.name },
        { 资产名称: asset.name }
      ])).get();

      if (hasItems(assetRes.data)) {
        await db.collection('assets').doc(assetRes.data[0]._id).update({
          data: {
            数量: _.inc(asset.count)
          }
        });
      }
    }
  }

  const updateData = {
    updateTime: db.serverDate(),
    已归还清单: updatedReturnedList
  };

  if (updatedReturnedCounts) {
    updateData.已归还数量 = updatedReturnedCounts;
  }
  if (allReturned) {
    updateData.入库归还日期 = formatYMD();
  }

  await db.collection('orders').doc(orderId).update({ data: updateData });

  await addOperationLog({
    操作人: adminName,
    操作人ID: adminOpenId,
    操作类型: 'INBOUND',
    操作内容: allReturned ? '全部入库归还' : '部分入库归还',
    关联单据ID: orderId,
    操作对象: `借用码: ${borrowCode}`,
    归还设备清单: toReturnNames,
    归还状态: allReturned ? 'COMPLETE' : 'PARTIAL'
  });

  return { success: true };
}

exports.main = async event => {
  const { action, payload } = event;

  try {
    switch (action) {
      case 'getPendingCount':
        return await handleGetPendingCount();

      case 'getOrders':
        return await handleGetOrders();

      case 'getOrderById': {
        const res = await db.collection('orders').doc(payload.id).get();
        return { success: true, data: res.data };
      }

      case 'getOrderByCode': {
        const res = await db.collection('orders').where({ 借用码: payload.code, 审批状态: '通过' }).get();
        return { success: true, data: res.data };
      }

      case 'getAssets': {
        const res = await db.collection('assets').limit(100).get();
        return { success: true, data: res.data };
      }

      case 'approveOrder':
        return await handleApproveOrder(payload);

      case 'rejectOrder':
        return await handleRejectOrder(payload);

      case 'outboundOrder':
        return await handleOutboundOrder(payload);

      case 'inboundOrder':
        return await handleInboundOrder(payload);

      default:
        return { success: false, error: 'Unknown action' };
    }
  } catch (err) {
    console.error(err);
    return { success: false, error: err.message };
  }
};

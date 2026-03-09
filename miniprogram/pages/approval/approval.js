const app = getApp();
const { getInclusiveDays, getReturnedCount, parseAssetString } = require('../../utils/order');

Page({
  data: {
    orderId: '',
    order: null,
    totalDays: 0,
    isAdmin: false
  },

  onLoad(options) {
    this.setData({ isAdmin: app.globalData.role === 'admin' });
    if (options.id) {
      this.setData({ orderId: options.id });
      this.fetchOrderDetails(options.id);
    }
  },

  async fetchOrderDetails(id) {
    wx.showLoading({ title: '加载中...' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'getOrderById', payload: { id } }
      });

      if (!result || !result.success || !result.data) {
        throw new Error('订单不存在');
      }

      const rawOrder = result.data;
      const returnedList = rawOrder.已归还清单 || [];
      const returnedCounts = rawOrder.已归还数量 || {};
      const assetStr = rawOrder.资产名称 || '';
      const assetEntries = parseAssetString(assetStr);

      let allAssets = [];
      const returnedAssets = [];
      const unreturnedAssets = [];

      if (assetStr === '无设备') {
        allAssets = ['无设备'];
      } else {
        allAssets = assetEntries.map(item => item.raw);
      }

      assetEntries.forEach(item => {
        const returnedCount = getReturnedCount({
          index: item.index,
          totalCount: item.count,
          returnedList,
          returnedCounts,
          hasInboundDate: !!rawOrder.入库归还日期
        });

        if (returnedCount > 0) {
          returnedAssets.push(`${item.name} x${returnedCount}`);
        }
        if (returnedCount < item.count) {
          unreturnedAssets.push(`${item.name} x${item.count - returnedCount}`);
        }
      });

      // WXML 中统一使用英文键名，避免中文字段键在模板表达式中出错。
      const order = {
        id: rawOrder._id,
        applicant: rawOrder.使用人,
        dept: rawOrder.部门,
        startDate: rawOrder.申请借用日期,
        endDate: rawOrder.预计归还日期,
        remark: rawOrder.需求附言,
        packageName: rawOrder.套餐名称,
        status: rawOrder.审批状态,
        phone: rawOrder.手机号,
        openid: rawOrder.OpenID,
        deptCode: rawOrder.部门编号,
        userNum: rawOrder.用户编号,
        borrowCode: rawOrder.借用码,
        outboundDate: rawOrder.出库使用日期,
        inboundDate: rawOrder.入库归还日期,
        assets: rawOrder.资产名称,
        count: rawOrder.数量,
        returnedAssets,
        unreturnedAssets,
        allAssets
      };

      this.setData({
        order,
        firstChar: order.applicant ? order.applicant.substring(0, 1) : '?',
        totalDays: getInclusiveDays(order.startDate, order.endDate)
      });
    } catch (err) {
      console.error('获取订单详情失败', err);
      wx.showToast({ title: '订单不存在', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onApprove() {
    const { order, orderId } = this.data;
    if (!order) {
      return;
    }

    wx.showLoading({ title: '处理中...' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: {
          action: 'approveOrder',
          payload: {
            orderId,
            order,
            adminName: app.globalData.userInfo.姓名,
            adminOpenId: app.globalData.userInfo.OpenID
          }
        }
      });

      if (!result || !result.success) {
        throw new Error(result?.error || '审批失败');
      }

      wx.hideLoading();
      wx.showToast({ title: '审批通过', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err) {
      console.error('审批失败', err);
      wx.hideLoading();
      wx.showToast({ title: `审批失败: ${err.message}`, icon: 'none' });
    }
  },

  onReject() {
    wx.showModal({
      title: '拒绝申请',
      content: '',
      editable: true,
      placeholderText: '请输入拒绝理由',
      success: res => {
        if (res.confirm) {
          this.submitReject(res.content || '未填写理由');
        }
      }
    });
  },

  async submitReject(reason) {
    wx.showLoading({ title: '处理中...' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: {
          action: 'rejectOrder',
          payload: {
            orderId: this.data.orderId,
            reason,
            adminName: app.globalData.userInfo.姓名,
            adminOpenId: app.globalData.userInfo.OpenID
          }
        }
      });

      if (!result || !result.success) {
        throw new Error(result?.error || '操作失败');
      }

      wx.hideLoading();
      wx.showToast({ title: '已拒绝申请', icon: 'none' });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err) {
      console.error('拒绝失败', err);
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});

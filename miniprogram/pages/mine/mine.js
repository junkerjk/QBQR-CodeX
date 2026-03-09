const app = getApp();
const { getInclusiveDays } = require('../../utils/order');

Page({
  data: {
    userInfo: null,
    isAdmin: false,
    orders: [],
    activeOrders: []
  },

  onShow() {
    const userInfo = app.globalData.userInfo;
    if (!userInfo) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    this.setData({
      userInfo: {
        avatar: userInfo.avatar || '',
        name: userInfo.姓名 || '',
        surname: userInfo.姓名 ? userInfo.姓名.substring(0, 1) : '',
        gender: userInfo.性别 || '男',
        avatarColor: userInfo.性别 === '女' ? '#FFD1DC' : '#B3E5FC',
        role: userInfo.角色 || '',
        dept: userInfo.部门 || ''
      },
      isAdmin: app.globalData.role === 'admin'
    });

    this.fetchOrders();

    if (this.data.isAdmin) {
      app.checkPendingOrders();
    }
  },

  async fetchOrders() {
    const userInfo = app.globalData.userInfo;
    if (!userInfo) {
      return;
    }

    try {
      const db = wx.cloud.database();
      const _ = db.command;

      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const res = await db.collection('orders')
        .where({
          OpenID: userInfo.OpenID,
          手机号: userInfo.手机号,
          createTime: _.gte(sixtyDaysAgo)
        })
        .orderBy('createTime', 'desc')
        .get();

      const orders = res.data.map(order => this.mapOrder(order));
      const activeOrders = orders.filter(o => !o.入库归还日期 && o.审批状态 !== '拒绝');

      this.setData({ orders, activeOrders });
    } catch (err) {
      console.error('获取订单失败', err);
    }
  },

  mapOrder(order) {
    let statusText = '待审批';
    let statusClass = 'pending';
    let qrStatusText = '待审核';
    let qrStatusClass = 'pending';

    if (order.审批状态 === '拒绝') {
      statusText = '已拒绝';
      statusClass = 'rejected';
    } else if (order.审批状态 === '通过') {
      qrStatusText = '生效中';
      qrStatusClass = 'active';

      if (order.入库归还日期) {
        statusText = '已归还';
        statusClass = 'returned';
      } else if (order.出库使用日期) {
        statusText = '使用中';
        statusClass = 'active';
      } else {
        statusText = '待领用';
        statusClass = 'approved';
      }
    }

    const pkgTag = order.套餐名称 === '直播套装'
      ? '直播'
      : (order.套餐名称 === '录制套装' ? '录制' : '协助');

    return {
      ...order,
      statusText,
      statusClass,
      qrStatusText,
      qrStatusClass,
      pkgTag,
      showQR: order.审批状态 === '通过',
      totalDays: getInclusiveDays(order.申请借用日期, order.预计归还日期),
      borrowCode: order.借用码,
      packageName: order.套餐名称,
      applyDate: order.申请借用日期,
      returnDate: order.预计归还日期
    };
  },

  onOrderClick(e) {
    const order = e.currentTarget.dataset.order;

    wx.showActionSheet({
      itemList: ['查看详情', '取消本次预约'],
      itemColor: '#000000',
      success: async res => {
        if (res.tapIndex === 0) {
          wx.navigateTo({
            url: `/pages/approval/approval?id=${order._id}`
          });
          return;
        }

        if (order.出库使用日期) {
          wx.showToast({ title: '已出库设备无法取消预约', icon: 'none' });
          return;
        }

        this.cancelOrder(order._id);
      }
    });
  },

  async cancelOrder(orderId) {
    wx.showLoading({ title: '取消中...' });
    try {
      const db = wx.cloud.database();
      await db.collection('orders').doc(orderId).remove();
      wx.hideLoading();
      wx.showToast({ title: '已取消预约' });
      this.fetchOrders();
    } catch (err) {
      console.error('取消失败', err);
      wx.hideLoading();
      wx.showToast({ title: '取消失败', icon: 'none' });
    }
  },

  onAboutUs() {
    wx.showModal({
      title: '关于我们',
      content: '感谢 SFC 支持开发测试维护 \r\n 联系我：📞13822177944',
      showCancel: false
    });
  },

  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: async res => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '注销中...' });
        try {
          await wx.cloud.callFunction({
            name: 'syncUser',
            data: { action: 'unbind' }
          });
          wx.removeStorageSync('userInfo');
          app.globalData.userInfo = null;
          app.globalData.role = 'guest';
          wx.hideLoading();
          wx.reLaunch({ url: '/pages/login/login' });
        } catch (err) {
          console.error('注销失败', err);
          wx.hideLoading();
          wx.reLaunch({ url: '/pages/login/login' });
        }
      }
    });
  }
});

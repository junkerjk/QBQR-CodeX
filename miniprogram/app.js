const { getRoleByUser } = require('./utils/order');

App({
  globalData: {
    userInfo: null,
    role: 'guest'
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-0gq7kxp570f144fa',
        traceUser: true
      });
    }




    // 尝试从本地缓存恢复登录态。
    const cachedUser = wx.getStorageSync('userInfo');
    if (cachedUser) {
      this.globalData.userInfo = cachedUser;
      this.globalData.role = getRoleByUser(cachedUser);
    }
  },

  checkPendingOrders() {
    if (this.globalData.role !== 'admin') {
      return;
    }

    wx.cloud.callFunction({
      name: 'adminApi',
      data: { action: 'getPendingCount' }
    }).then(res => {
      if (!res.result || !res.result.success) {
        return;
      }

      const { count } = res.result;
      if (count > 0) {
        wx.showTabBarRedDot({ index: 1 }).catch(() => {});
      } else {
        wx.hideTabBarRedDot({ index: 1 }).catch(() => {});
      }
    }).catch(err => {
      console.error('获取待审批数量失败', err);
    });
  }
});

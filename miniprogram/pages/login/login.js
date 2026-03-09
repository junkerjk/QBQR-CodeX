const app = getApp();
const { getRoleByUser } = require('../../utils/order');

Page({
  data: {
    phone: '',
    name: ''
  },

  onLoad() {
    // 1. 全局已恢复登录态则直接进入主页。
    if (app.globalData.userInfo) {
      this.goToHome();
      return;
    }

    // 2. 尝试静默检查云端绑定状态。
    this.checkAutoLogin();
  },

  goToHome() {
    wx.switchTab({
      url: '/pages/reserve/reserve'
    });
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  async checkAutoLogin() {
    wx.showLoading({ title: '检查登录中...' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'syncUser',
        data: { action: 'check' }
      });

      if (result && result.success) {
        this.handleUserLogin(result.user);
      }
    } catch (err) {
      console.error('静默检查失败', err);
    } finally {
      wx.hideLoading();
    }
  },

  async onLogin() {
    const name = this.data.name.trim();
    const phone = this.data.phone.trim();

    if (!name || !phone) {
      return wx.showToast({ title: '请填写姓名和手机号', icon: 'none' });
    }

    wx.showLoading({ title: '绑定中...' });

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'syncUser',
        data: {
          action: 'bind',
          name,
          phone
        }
      });

      if (result && result.success) {
        this.handleUserLogin(result.user);
      } else {
        wx.showToast({
          title: result.msg || '未找到匹配信息',
          icon: 'none',
          duration: 3000
        });
      }
    } catch (err) {
      console.error('绑定失败', err);
      wx.showToast({ title: '系统异常，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  handleUserLogin(user) {
    if (user.状态 === '拒绝' || user.角色 === '拒绝') {
      wx.showModal({ title: '登录失败', content: '您暂无权限使用该系统', showCancel: false });
      return;
    }

    wx.setStorageSync('userInfo', user);
    app.globalData.userInfo = user;
    app.globalData.role = getRoleByUser(user);

    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      this.goToHome();
    }, 1000);
  }
});

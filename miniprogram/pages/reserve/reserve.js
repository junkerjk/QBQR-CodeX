const app = getApp();
const { formatDateToYMD } = require('../../utils/order');

Page({
  data: {
    today: '',
    startDate: '',
    endDate: '',
    remark: '',
    selectedPackage: 'live',
    packages: [
      { id: 'live', name: '直播套装', emoji: '📺', desc: '会议、综艺、赛事\n互联网直播', bgColor: '#E3F2FD' },
      { id: 'record', name: '录制套装', emoji: '📹', desc: '新闻、专题、影视剧\n素材采集', bgColor: '#FFEBEE' },
      { id: 'tech', name: '技术支持', emoji: '🎭', desc: '专业技术人员外派\n产品交付沟通', bgColor: '#F3E5F5' },
      { id: 'other', name: '其他协助', emoji: '🎧', desc: '其他设备借用\n及技术支持协助', bgColor: '#E8F5E9' }
    ]
  },

  onLoad() {
    const today = formatDateToYMD(new Date());
    this.setData({
      today,
      startDate: today,
      endDate: today
    });
  },

  onShow() {
    if (app.globalData.role === 'admin') {
      app.checkPendingOrders();
    }
  },

  onStartDateChange(e) {
    const newStart = e.detail.value;
    this.setData({ startDate: newStart });

    // 如果结束日期早于开始日期，同步更新结束日期。
    if (new Date(this.data.endDate) < new Date(newStart)) {
      this.setData({ endDate: newStart });
    }
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  onSelectPackage(e) {
    const id = e.currentTarget.dataset.id;
    const pkg = this.data.packages.find(p => p.id === id);
    if (!pkg) {
      return;
    }

    this.setData({
      selectedPackage: id,
      remark: `【${pkg.name}】${pkg.desc.replace(/\n/g, ' ')}`
    });
  },

  async onSubmit() {
    const { startDate, endDate, remark, selectedPackage, packages } = this.data;
    const userInfo = app.globalData.userInfo;

    if (!userInfo) {
      return wx.showToast({ title: '请先登录', icon: 'none' });
    }

    if (!startDate || !endDate) {
      return wx.showToast({ title: '请选择日期', icon: 'none' });
    }

    wx.showLoading({ title: '提交中...' });

    try {
      const db = wx.cloud.database();

      // 1. 检查是否有未取消且未归还的预约。
      const checkRes = await db.collection('orders').where({
        OpenID: userInfo.OpenID,
        手机号: userInfo.手机号,
        入库归还日期: ''
      }).get();

      // 过滤掉已被拒绝的订单（被拒绝的可以重新申请）。
      const activeOrders = checkRes.data.filter(o => o.审批状态 !== '拒绝');
      if (activeOrders.length > 0) {
        wx.hideLoading();
        return wx.showModal({
          title: '提示',
          content: '您有未取消的预约申请，请先取消后再提交新的预约申请。',
          showCancel: false
        });
      }

      // 2. 提交新预约。
      const pkg = packages.find(p => p.id === selectedPackage);
      await db.collection('orders').add({
        data: {
          OpenID: userInfo.OpenID,
          手机号: userInfo.手机号,
          使用人: userInfo.姓名,
          部门: userInfo.部门,
          部门编号: userInfo.部门编号 || 'AA',
          用户编号: userInfo.编号 || '000',
          申请借用日期: startDate,
          预计归还日期: endDate,
          需求附言: remark,
          套餐名称: pkg.name,
          审批状态: '待审批',
          出库使用日期: '',
          入库归还日期: '',
          借用码: '',
          资产名称: '',
          数量: 0,
          createTime: db.serverDate()
        }
      });

      wx.hideLoading();
      wx.showToast({ title: '预约成功', icon: 'success' });

      setTimeout(() => {
        wx.switchTab({ url: '/pages/mine/mine' });
      }, 1500);
    } catch (err) {
      console.error('提交失败', err);
      wx.hideLoading();
      wx.showToast({ title: '提交失败，请重试', icon: 'none' });
    }
  }
});

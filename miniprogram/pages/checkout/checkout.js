Page({
  data: {
    orderInfo: null
  },

  onScan() {
    wx.scanCode({
      success: () => {
        // 占位页：当前仍使用本地模拟数据展示流程。
        this.setData({
          orderInfo: {
            applicant: '张三',
            itemName: '笔记本电脑',
            count: 1
          }
        });
      }
    });
  },

  onConfirmCheckout() {
    wx.showLoading({ title: '处理中...' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: '已确认放行' });
      this.setData({ orderInfo: null });
    }, 1000);
  }
});

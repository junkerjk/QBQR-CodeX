Page({
  data: {
    list: [],
    showQR: false
  },

  onShow() {
    this.fetchData();
  },

  fetchData() {
    // 占位页：当前仍使用模拟数据。
    const mockData = [
      { _id: '1', itemName: '笔记本电脑', count: 1, date: '2024-03-01', status: 'approved', statusText: '已通过', statusClass: 'approved' },
      { _id: '2', itemName: '显示器', count: 1, date: '2024-03-05', status: 'pending', statusText: '审批中', statusClass: 'pending' }
    ];
    this.setData({ list: mockData });
  },

  onGoReserve() {
    wx.switchTab({ url: '/pages/reserve/reserve' });
  },

  onShowQR() {
    this.setData({ showQR: true });
  },

  onCloseQR() {
    this.setData({ showQR: false });
  },

  stop() {}
});

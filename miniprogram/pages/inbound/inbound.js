const app = getApp();
const { getReturnedCount, normalizeReturnedCounts, parseAssetString } = require('../../utils/order');

Page({
  data: {
    borrowCode: '',
    order: null,
    borrowedItems: [],
    confirmedCount: 0,
    totalBorrowed: 0
  },

  onLoad(options) {
    if (options.code) {
      this.setData({ borrowCode: options.code });
      this.fetchBorrowedItems(options.code);
    }
  },

  async fetchBorrowedItems(code) {
    wx.showLoading({ title: '核验中...' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'getOrderByCode', payload: { code } }
      });

      if (!result || !result.success || !result.data || result.data.length === 0) {
        wx.showModal({
          title: '核验失败',
          content: '未找到该借用码对应的记录',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }

      const rawOrder = result.data[0];

      if (!rawOrder.出库使用日期) {
        wx.showModal({
          title: '入库拦截',
          content: '该订单尚未出库（处于“待领用”状态），无法进行入库操作',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }

      if (rawOrder.入库归还日期) {
        wx.showModal({
          title: '入库拦截',
          content: '该订单已全部归还入库，无需再次操作',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }

      const order = {
        id: rawOrder._id,
        applicant: rawOrder.使用人,
        dept: rawOrder.部门,
        outboundDate: rawOrder.出库使用日期,
        borrowCode: rawOrder.借用码,
        returnDate: rawOrder.入库归还日期,
        returnedList: rawOrder.已归还清单 || [],
        returnedCounts: rawOrder.已归还数量 || {}
      };

      const borrowedItems = parseAssetString(rawOrder.资产名称 || '')
        .map(item => {
          const returnedCount = getReturnedCount({
            index: item.index,
            totalCount: item.count,
            returnedList: order.returnedList,
            returnedCounts: order.returnedCounts,
            hasInboundDate: !!order.returnDate
          });

          return {
            id: item.index,
            name: item.name,
            count: item.count,
            returnedCount,
            remainCount: item.count - returnedCount,
            returnCount: 0,
            returned: returnedCount >= item.count
          };
        });

      const totalBorrowed = borrowedItems.reduce((sum, item) => sum + item.count, 0);
      const alreadyReturnedCount = borrowedItems.reduce((sum, item) => sum + item.returnedCount, 0);

      this.setData({
        order,
        borrowedItems,
        totalBorrowed,
        confirmedCount: alreadyReturnedCount
      });
    } catch (err) {
      console.error('核验失败', err);
      wx.showToast({ title: '系统错误', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onMinus(e) {
    const index = e.currentTarget.dataset.index;
    const borrowedItems = this.data.borrowedItems;
    if (borrowedItems[index].returnCount > 0) {
      borrowedItems[index].returnCount -= 1;
      this.updateSummary(borrowedItems);
    }
  },

  onPlus(e) {
    const index = e.currentTarget.dataset.index;
    const borrowedItems = this.data.borrowedItems;
    if (borrowedItems[index].returnCount < borrowedItems[index].remainCount) {
      borrowedItems[index].returnCount += 1;
      this.updateSummary(borrowedItems);
    }
  },

  updateSummary(borrowedItems) {
    const currentReturnCount = borrowedItems.reduce((sum, item) => sum + item.returnCount, 0);
    const alreadyReturnedCount = borrowedItems.reduce((sum, item) => sum + item.returnedCount, 0);

    this.setData({
      borrowedItems,
      confirmedCount: currentReturnCount + alreadyReturnedCount
    });
  },

  async onConfirm() {
    const { order, borrowedItems, totalBorrowed } = this.data;
    const currentReturnCount = borrowedItems.reduce((sum, item) => sum + item.returnCount, 0);

    if (totalBorrowed > 0 && currentReturnCount === 0) {
      return wx.showToast({ title: '请先选择要归还的设备数量', icon: 'none' });
    }

    wx.showLoading({ title: '处理中...' });

    try {
      const updatedReturnedCounts = normalizeReturnedCounts(order.returnedCounts);
      let allReturned = true;
      const toReturnNamesArr = [];

      borrowedItems.forEach(item => {
        const newReturnedCount = item.returnedCount + item.returnCount;
        updatedReturnedCounts[item.id] = newReturnedCount;

        if (newReturnedCount < item.count) {
          allReturned = false;
        }

        if (item.returnCount > 0) {
          toReturnNamesArr.push(`${item.name} x${item.returnCount}`);
        }
      });

      const updatedReturnedList = borrowedItems
        .filter(item => (item.returnedCount + item.returnCount) >= item.count)
        .map(item => item.id);

      const returnedAssets = borrowedItems
        .filter(item => item.returnCount > 0)
        .map(item => ({ name: item.name, count: item.returnCount }));

      const toReturnNames = totalBorrowed === 0 ? '无设备' : toReturnNamesArr.join(', ');

      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: {
          action: 'inboundOrder',
          payload: {
            orderId: order.id,
            borrowCode: order.borrowCode,
            updatedReturnedList,
            updatedReturnedCounts,
            allReturned,
            toReturnNames,
            returnedAssets,
            adminName: app.globalData.userInfo.姓名,
            adminOpenId: app.globalData.userInfo.OpenID
          }
        }
      });

      if (!result || !result.success) {
        throw new Error(result?.error || '归还失败');
      }

      wx.hideLoading();
      wx.showToast({ title: allReturned ? '全部归还成功' : '部分归还成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err) {
      console.error('入库失败', err);
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});

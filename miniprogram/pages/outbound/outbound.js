const app = getApp();
const {
  getInclusiveDays,
  getReturnedCount,
  normalizeReturnedCounts,
  parseAssetString
} = require('../../utils/order');

Page({
  data: {
    borrowCode: '',
    order: null,
    assetList: [],
    totalItems: 0,
    totalCount: 0
  },

  async onLoad(options) {
    if (options.code) {
      this.setData({ borrowCode: options.code });
      await this.fetchOrderByCode(options.code);
    }
    this.fetchAssets();
  },

  async fetchOrderByCode(code) {
    wx.showLoading({ title: '核验中...' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'getOrderByCode', payload: { code } }
      });

      if (!result || !result.success || !result.data || result.data.length === 0) {
        wx.showModal({
          title: '核验失败',
          content: '未找到有效的借用码或该申请尚未通过审批',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }

      const rawOrder = result.data[0];
      if (rawOrder.入库归还日期) {
        wx.showModal({
          title: '出库拦截',
          content: '该订单已全部归还入库，无法再次进行出库操作',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }

      const order = {
        id: rawOrder._id,
        applicant: rawOrder.使用人,
        dept: rawOrder.部门,
        startDate: rawOrder.申请借用日期,
        endDate: rawOrder.预计归还日期,
        remark: rawOrder.需求附言,
        packageName: rawOrder.套餐名称,
        borrowCode: rawOrder.借用码,
        outboundDate: rawOrder.出库使用日期,
        inboundDate: rawOrder.入库归还日期,
        assetStr: rawOrder.资产名称 || '',
        returnedList: rawOrder.已归还清单 || [],
        returnedCounts: rawOrder.已归还数量 || {},
        totalDays: getInclusiveDays(rawOrder.申请借用日期, rawOrder.预计归还日期)
      };

      this.setData({
        order,
        firstChar: order.applicant ? order.applicant.substring(0, 1) : '?'
      });
    } catch (err) {
      console.error('核验失败', err);
      wx.showToast({ title: '系统错误', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async fetchAssets() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'getAssets' }
      });

      if (!result || !result.success) {
        return;
      }

      const order = this.data.order;
      const isAppendMode = !!(order && order.outboundDate);
      const existingAssets = {};
      const usingAssets = {};

      if (order && order.assetStr && order.assetStr !== '无设备') {
        parseAssetString(order.assetStr).forEach(item => {
          existingAssets[item.name] = item.count;

          const returnedCount = getReturnedCount({
            index: item.index,
            totalCount: item.count,
            returnedList: order.returnedList,
            returnedCounts: order.returnedCounts,
            hasInboundDate: !!order.inboundDate
          });

          usingAssets[item.name] = item.count - returnedCount;
        });
      }

      const assetList = result.data.map(item => {
        const name = item.资产名称 || item.名称 || '未命名设备';
        const existingCount = existingAssets[name] || 0;
        const usingCount = usingAssets[name] || 0;

        let borrowCount = 1;
        let checked = false;

        if (isAppendMode) {
          borrowCount = 0;
        } else {
          borrowCount = existingCount > 0 ? existingCount : 1;
          checked = existingCount > 0;
        }

        return {
          id: item._id,
          assetId: item.资产ID || item.ID || 'N/A',
          name,
          totalCount: item.数量 !== undefined ? item.数量 : (item.资产数量 || 0),
          checked,
          borrowCount,
          existingCount,
          usingCount
        };
      });

      this.setData({ assetList, isAppendMode }, () => {
        this.calculateTotal();
        wx.setNavigationBarTitle({
          title: isAppendMode ? '追加领用' : '物资出库'
        });
      });
    } catch (err) {
      console.error('获取资产列表失败', err);
    }
  },

  onToggleAsset(e) {
    if (this.data.isAppendMode) {
      return;
    }

    const index = e.currentTarget.dataset.index;
    const assetList = this.data.assetList;

    if (assetList[index].existingCount > 0) {
      wx.showToast({ title: '已出库设备不可取消', icon: 'none' });
      return;
    }

    if (!assetList[index].checked && assetList[index].totalCount <= 0) {
      wx.showToast({ title: '库存不足', icon: 'none' });
      return;
    }

    assetList[index].checked = !assetList[index].checked;
    if (assetList[index].checked && assetList[index].borrowCount === 0) {
      assetList[index].borrowCount = 1;
    }

    this.setData({ assetList }, () => this.calculateTotal());
  },

  onCountChange(e) {
    const { index, type } = e.currentTarget.dataset;
    const assetList = this.data.assetList;
    const isAppendMode = this.data.isAppendMode;
    const existingCount = assetList[index].existingCount || 0;

    let count = assetList[index].borrowCount;
    if (type === 'add') {
      const maxAllowed = isAppendMode
        ? assetList[index].totalCount
        : (existingCount + assetList[index].totalCount);

      if (count < maxAllowed) {
        count += 1;
      } else {
        wx.showToast({ title: '超出库存', icon: 'none' });
      }
    } else {
      const minAllowed = isAppendMode ? 0 : Math.max(1, existingCount);
      if (count > minAllowed) {
        count -= 1;
      } else if (!isAppendMode && existingCount > 0 && count === existingCount) {
        wx.showToast({ title: '不能少于已出库数量', icon: 'none' });
      }
    }

    assetList[index].borrowCount = count;
    if (isAppendMode) {
      assetList[index].checked = count > 0;
    }

    this.setData({ assetList }, () => this.calculateTotal());
  },

  calculateTotal() {
    const selected = this.data.assetList.filter(a => a.checked);
    this.setData({
      totalItems: selected.length,
      totalCount: selected.reduce((sum, a) => sum + a.borrowCount, 0)
    });
  },

  onRemarkInput(e) {
    this.setData({
      'order.remark': e.detail.value
    });
  },

  async onConfirm() {
    const { order, assetList, isAppendMode } = this.data;

    wx.showLoading({ title: '处理中...' });
    try {
      const selected = assetList.filter(a => a.checked && a.borrowCount > 0);
      const originalAssets = [];

      if (isAppendMode && order && order.assetStr && order.assetStr !== '无设备') {
        parseAssetString(order.assetStr).forEach(item => {
          originalAssets.push({ name: item.name, count: item.count });
        });
      }

      const addedAssets = [];
      const updatedReturnedCounts = normalizeReturnedCounts(order.returnedCounts);
      const updatedReturnedList = [...(order.returnedList || [])];

      if (!isAppendMode) {
        selected.forEach(a => {
          addedAssets.push({ id: a.id, name: a.name, count: a.borrowCount });
          originalAssets.push({ name: a.name, count: a.borrowCount });
        });
      } else {
        selected.forEach(a => {
          const addedCount = a.borrowCount;
          if (addedCount <= 0) {
            return;
          }

          addedAssets.push({ id: a.id, name: a.name, count: addedCount });
          const existingIndex = originalAssets.findIndex(oa => oa.name === a.name);

          if (existingIndex !== -1) {
            const existingItem = originalAssets[existingIndex];

            // 追加到“已全部归还”的设备时，需要把它从 fully returned 标记改为部分归还状态。
            if (updatedReturnedList.includes(existingIndex)) {
              if (updatedReturnedCounts[existingIndex] === undefined) {
                updatedReturnedCounts[existingIndex] = existingItem.count;
              }
              const listIndex = updatedReturnedList.indexOf(existingIndex);
              updatedReturnedList.splice(listIndex, 1);
            }

            existingItem.count += addedCount;
          } else {
            originalAssets.push({ name: a.name, count: addedCount });
          }
        });
      }

      const assetNames = originalAssets.length > 0
        ? originalAssets.map(item => `${item.name} x${item.count}`).join(', ')
        : '无设备';

      const finalTotalCount = originalAssets.reduce((sum, item) => sum + item.count, 0);

      const { result } = await wx.cloud.callFunction({
        name: 'adminApi',
        data: {
          action: 'outboundOrder',
          payload: {
            orderId: order.id,
            borrowCode: order.borrowCode,
            totalCount: finalTotalCount,
            remark: order.remark,
            assetNames,
            addedAssets,
            updatedReturnedCounts,
            updatedReturnedList,
            adminName: app.globalData.userInfo.姓名,
            adminOpenId: app.globalData.userInfo.OpenID
          }
        }
      });

      if (!result || !result.success) {
        throw new Error(result?.error || '放行失败');
      }

      wx.hideLoading();
      wx.showToast({ title: '放行成功', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    } catch (err) {
      console.error('放行失败', err);
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});


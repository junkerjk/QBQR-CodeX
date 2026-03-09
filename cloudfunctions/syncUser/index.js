const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 云函数：处理用户绑定、解绑和状态检查。
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  const { action, name, phone } = event;

  if (action === 'bind') {
    const res = await db.collection('users').where(_.or([
      { 姓名: name, 手机号: phone },
      { 姓名: name, 手机号: Number(phone) }
    ])).get();

    if (res.data.length === 0) {
      return { success: false, msg: '未找到匹配的员工信息' };
    }

    const user = res.data[0];
    await db.collection('users').doc(user._id).update({
      data: {
        OpenID: OPENID,
        绑定状态: '已绑定'
      }
    });

    return {
      success: true,
      user: {
        ...user,
        OpenID: OPENID,
        绑定状态: '已绑定'
      }
    };
  }

  if (action === 'unbind') {
    await db.collection('users').where({ OpenID: OPENID }).update({
      data: {
        OpenID: '',
        绑定状态: '未绑定'
      }
    });
    return { success: true };
  }

  if (action === 'check') {
    const res = await db.collection('users').where({
      OpenID: OPENID,
      绑定状态: '已绑定'
    }).get();

    if (res.data.length > 0) {
      return { success: true, user: res.data[0] };
    }

    return { success: false };
  }

  return { success: false, msg: 'Unknown action' };
};

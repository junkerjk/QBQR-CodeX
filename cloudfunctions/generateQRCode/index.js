const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async event => {
  return {
    event,
    msg: '生成二维码功能开发中'
  };
};

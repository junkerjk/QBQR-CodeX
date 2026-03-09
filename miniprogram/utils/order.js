const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateToYMD(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDateTime(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${formatDateToYMD(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function getInclusiveDays(startDate, endDate) {
  if (!startDate || !endDate) {
    return 0;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / DAY_MS) + 1;
}

function getRoleByUser(user) {
  return user && (user.角色 === '库管' || user.角色 === '库管员') ? 'admin' : 'user';
}

function parseAssetString(assetStr) {
  if (!assetStr || assetStr === '无设备') {
    return [];
  }

  return assetStr
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const parts = item.split(' x');
      return {
        index,
        name: parts[0] || '未知设备',
        count: parseInt(parts[1] || '1', 10),
        raw: item
      };
    });
}

function getReturnedCount({ index, totalCount, returnedList, returnedCounts, hasInboundDate }) {
  if (hasInboundDate) {
    return totalCount;
  }

  if (returnedCounts && returnedCounts[index] !== undefined && returnedCounts[index] !== null) {
    return returnedCounts[index];
  }

  if (Array.isArray(returnedList) && returnedList.includes(index)) {
    return totalCount;
  }

  return 0;
}

function normalizeReturnedCounts(source) {
  if (Array.isArray(source)) {
    return [...source];
  }

  if (source && typeof source === 'object') {
    return Object.assign([], source);
  }

  return [];
}

module.exports = {
  formatDateToYMD,
  formatDateTime,
  getInclusiveDays,
  getRoleByUser,
  parseAssetString,
  getReturnedCount,
  normalizeReturnedCounts
};

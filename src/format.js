const pad = (value, width = 2) => String(value).padStart(width, '0');

/** 把毫秒格式化为 HH:MM:SS.cc，小时超过 99 时自然扩展位数。 */
export function formatDuration(ms) {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const centiseconds = Math.floor(safe / 10) % 100;
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

function startOfDay(ts) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function clockOf(ts) {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 结束时刻文案：今天/昨天带秒，同年更早显示 MM-DD HH:MM，跨年补上年份。
 */
export function formatEndedAt(ts, now = Date.now()) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const reference = Number.isFinite(now) ? now : Date.now();
  const dayDiff = Math.round((startOfDay(reference) - startOfDay(ts)) / DAY_MS);
  if (dayDiff === 0) return `今天 ${clockOf(ts)}`;
  if (dayDiff === 1) return `昨天 ${clockOf(ts)}`;

  const date = new Date(ts);
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
  return date.getFullYear() === new Date(reference).getFullYear()
    ? monthDay
    : `${date.getFullYear()}-${monthDay}`;
}

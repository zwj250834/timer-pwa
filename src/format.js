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
 * 倒计时读数：向上取整到秒（读到 00:01 时还剩不到一秒），
 * 不足 1 小时用 MM:SS，超过 1 小时用 H:MM:SS。
 */
export function formatRemaining(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** 时刻：HH:MM。 */
export function formatClock(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 时长的口语说法：90 分钟 → 1 小时 30 分钟。 */
export function describeDuration(ms) {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const parts = [];
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分钟`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} 秒`);
  return parts.join(' ');
}

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

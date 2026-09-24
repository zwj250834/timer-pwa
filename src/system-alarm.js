/**
 * 把倒计时交给 Android 系统时钟 App。
 *
 * 网页没法在熄屏时叫醒设备，但系统时钟 App 可以：这里的做法是构造一个
 * `intent://` 链接并跳转过去，让时钟 App 用 `ACTION_SET_ALARM` 建一个真正的
 * 系统闹钟。那一份响铃完全由系统负责，锁屏、Doze、飞行模式都会准点响。
 *
 * 两个硬性约束（来自 Chrome 的 Android intent 规范）：
 *   1. 必须由用户手势触发，不能在定时器里自动跳转；
 *   2. 只有声明了 BROWSABLE 的 Activity 才能被这样唤起（时钟 App 是支持的）。
 */

export const SET_ALARM_ACTION = 'android.intent.action.SET_ALARM';

/** 时钟 App 里闹钟标签的长度上限，避免超长文案被截得莫名其妙。 */
const MAX_MESSAGE_LENGTH = 60;

/**
 * 「刚请求过闹钟、页面却又被重新加载」的时间窗口。
 * 真的跳到时钟 App 时页面不会被重新加载，所以窗口内重新加载基本等于跳转失败。
 */
export const FALLBACK_WARN_WINDOW_MS = 60_000;

/**
 * 这台设备值不值得显示「加入闹钟」按钮：Android + Chromium 系浏览器。
 * Firefox for Android 不支持 intent:// 链接，所以排除掉。
 */
export function supportsSystemAlarm(userAgent = globalThis.navigator?.userAgent ?? '') {
  const ua = String(userAgent);
  if (!/android/i.test(ua)) return false;
  return /chrome|chromium|crios|samsungbrowser|edg|opr\//i.test(ua);
}

/**
 * 构造 SET_ALARM 的 intent URL。
 * HOUR / MINUTES 是 24 小时制的本地时间；SKIP_UI=true 让时钟 App 直接建好闹钟，
 * 不再多要一次确认（个别机型会忽略它，那就只是多点一下保存）。
 */
export function buildSetAlarmIntent({ at, label = '', skipUi = true, fallbackUrl } = {}) {
  const stamp = Number.isFinite(at) ? at : Date.now();
  const date = new Date(stamp);

  const parts = [
    `action=${SET_ALARM_ACTION}`,
    `i.android.intent.extra.alarm.HOUR=${date.getHours()}`,
    `i.android.intent.extra.alarm.MINUTES=${date.getMinutes()}`,
  ];

  const message = String(label).replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
  if (message) {
    parts.push(`S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(message)}`);
  }
  if (skipUi) parts.push('b.android.intent.extra.alarm.SKIP_UI=true');
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);

  return `intent://#Intent;${parts.join(';')};end`;
}

/**
 * 判断一条「已请求闹钟」的暂存记录能否说明这次跳转失败了。
 * 记录太旧（用户早就回来了）或时间戳不合法都不算。
 */
export function isFailedHandoff(record, now = Date.now(), windowMs = FALLBACK_WARN_WINDOW_MS) {
  if (!record || typeof record !== 'object') return false;
  if (!Number.isFinite(record.ts)) return false;
  const stamp = Number.isFinite(now) ? now : Date.now();
  const delta = stamp - record.ts;
  return delta >= 0 && delta <= windowMs;
}

/**
 * 跳转到时钟 App，并在「其实没跳走」时回调 onBlocked。
 *
 * 跳转是否成功没法直接读取，这里的判据是：过了 graceMs 之后页面仍然可见、
 * 仍然有焦点，说明外部 App 没被拉起来（浏览器不支持、被拦截、或没有时钟 App）。
 * 不会自动重试，避免在同一时刻建出两个闹钟。
 */
export function openSystemAlarm({
  at,
  label = '',
  fallbackUrl,
  navigate,
  setTimer = globalThis.setTimeout,
  isStillHere = () => true,
  onBlocked,
  graceMs = 1800,
} = {}) {
  const url = buildSetAlarmIntent({ at, label, fallbackUrl });
  if (typeof navigate !== 'function') return null;

  navigate(url);

  if (typeof onBlocked === 'function' && typeof setTimer === 'function') {
    setTimer(() => {
      if (isStillHere()) onBlocked(url);
    }, graceMs);
  }

  return url;
}

/**
 * 闹铃输出层：蜂鸣声、震动、系统通知。
 *
 * 纯平台封装，不碰 DOM 结构；外部依赖都可以注入，方便在 Node 里测试。
 * 浏览器里无法直接启动系统时钟自带的闹钟，能做到的最接近效果是
 * 「系统级通知 + 响铃 + 震动 + 全屏提醒」，本模块负责前三样。
 */

/** 响铃自动停止的时间，避免没人管时一直吵。 */
export const ALARM_AUTO_STOP_MS = 60_000;
/** 一次蜂鸣脉冲的间隔。 */
export const PULSE_MS = 1800;
/** 震动节奏（毫秒，奇数为震动、偶数为停歇），与通知里的 vibrate 共用。 */
export const VIBRATE_PATTERN = [600, 350, 600, 350, 600, 1200];

function defaultContextFactory() {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return typeof Ctor === 'function' ? new Ctor() : null;
}

function defaultVibrate(pattern) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  return navigator.vibrate(pattern);
}

const defaultSchedule = (fn, ms) => globalThis.setInterval(fn, ms);
const defaultCancel = (handle) => globalThis.clearInterval(handle);

/**
 * 蜂鸣闹铃。首次用户交互时调用 unlock() 唤醒 AudioContext，
 * 之后 start() 才能在没有手势的情况下出声（移动端浏览器要求）。
 */
export function createSiren({
  createContext = defaultContextFactory,
  setInterval: schedule = defaultSchedule,
  clearInterval: cancel = defaultCancel,
  pulseMs = PULSE_MS,
  volume = 0.18,
} = {}) {
  let ctx = null;
  let loop = 0;
  let playing = false;
  let primed = false;

  function context() {
    if (ctx) return ctx;
    try {
      ctx = typeof createContext === 'function' ? createContext() : null;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function beep(at, frequency, duration, level) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.02);
    gain.gain.setValueAtTime(level, at + Math.max(0.03, duration - 0.06));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  /** 一次脉冲：高低交替的四声，听感上像闹钟而不是提示音。 */
  function pulse(level = volume) {
    if (!ctx) return;
    const start = ctx.currentTime + 0.02;
    beep(start, 932, 0.18, level);
    beep(start + 0.24, 1244, 0.18, level);
    beep(start + 0.48, 932, 0.18, level);
    beep(start + 0.72, 1244, 0.34, level);
  }

  function resumeContext() {
    const active = context();
    if (!active) return null;
    try {
      if (active.state === 'suspended' && typeof active.resume === 'function') active.resume();
    } catch {
      /* 唤醒失败就等下一次手势 */
    }
    return active;
  }

  function start() {
    if (playing) return false;
    if (!resumeContext()) return false;
    playing = true;
    pulse();
    if (pulseMs > 0) {
      loop = schedule(() => {
        if (playing) pulse();
      }, pulseMs);
    }
    return true;
  }

  function stop() {
    if (!playing) return false;
    playing = false;
    if (loop) cancel(loop);
    loop = 0;
    return true;
  }

  return {
    start,
    stop,
    /**
     * 在用户手势里调用：唤醒音频通道，并放一次听不见的脉冲。
     * iOS 只有在手势里真正播过声音之后，后续才允许自动出声。
     */
    unlock: () => {
      const active = resumeContext();
      if (!active) return false;
      if (!primed && !playing) {
        primed = true;
        pulse(0.0001);
      }
      return true;
    },
    get playing() {
      return playing;
    },
  };
}

/** 震动循环：一次长节奏，反复触发直到停止。 */
export function createVibrator({
  vibrate = defaultVibrate,
  setInterval: schedule = defaultSchedule,
  clearInterval: cancel = defaultCancel,
  pattern = VIBRATE_PATTERN,
  gapMs = 3200,
} = {}) {
  let loop = 0;
  let playing = false;

  function start() {
    if (playing || typeof vibrate !== 'function') return false;
    playing = true;
    vibrate(pattern);
    if (gapMs > 0) {
      loop = schedule(() => {
        if (playing) vibrate(pattern);
      }, gapMs);
    }
    return true;
  }

  function stop() {
    if (!playing) return false;
    playing = false;
    if (loop) cancel(loop);
    loop = 0;
    try {
      vibrate(0);
    } catch {
      /* 忽略：部分浏览器拒绝震动参数 */
    }
    return true;
  }

  return {
    start,
    stop,
    get playing() {
      return playing;
    },
  };
}

function notificationOptions({ body, tag, icon, badge }) {
  const options = {
    body,
    renotify: true,
    requireInteraction: true,
    vibrate: VIBRATE_PATTERN,
  };
  if (tag) options.tag = tag;
  if (icon) options.icon = icon;
  if (badge) options.badge = badge;
  return options;
}

/** 询问通知权限，返回 'granted' | 'denied' | 'default' | 'unsupported'。 */
export async function requestNotificationPermission({
  NotificationCtor = globalThis.Notification,
} = {}) {
  if (typeof NotificationCtor !== 'function') return 'unsupported';
  if (NotificationCtor.permission === 'granted') return 'granted';
  if (typeof NotificationCtor.requestPermission !== 'function') return 'unsupported';
  try {
    const result = await NotificationCtor.requestPermission();
    if (result === 'granted' || result === 'denied' || result === 'default') return result;
    return 'default';
  } catch {
    return 'unsupported';
  }
}

/**
 * 弹一条系统通知。优先用 Service Worker 注册对象，页面被切到后台时
 * 也由系统托盘弹出；退而求其次用页面通知。
 */
export async function showSystemNotification({
  title,
  body,
  tag,
  icon,
  badge,
  registration,
  NotificationCtor = globalThis.Notification,
} = {}) {
  const options = notificationOptions({ body, tag, icon, badge });

  if (registration && typeof registration.showNotification === 'function') {
    try {
      await registration.showNotification(title, options);
      return 'service-worker';
    } catch {
      /* 交给下面的页面通知 */
    }
  }

  try {
    if (typeof NotificationCtor === 'function' && NotificationCtor.permission === 'granted') {
      // eslint-disable-next-line no-new
      new NotificationCtor(title, options);
      return 'window';
    }
  } catch {
    /* 落到 unsupported */
  }

  return 'unsupported';
}

/** 关闭同一 tag 的历史通知，避免用户清掉提醒后还有残留。 */
export async function closeSystemNotifications({ tag, registration } = {}) {
  if (!tag || !registration || typeof registration.getNotifications !== 'function') return 0;
  try {
    const list = await registration.getNotifications({ tag });
    for (const item of list ?? []) item.close();
    return (list ?? []).length;
  } catch {
    return 0;
  }
}

/**
 * 实验性的 Notification Triggers（Chromium 部分版本可用）：
 * 把通知交给系统在指定时刻投递，即使页面被挂起也不会迟到。
 */
export function scheduleSystemTrigger({
  title,
  body,
  tag,
  at,
  registration,
  TimestampTriggerCtor = globalThis.TimestampTrigger,
} = {}) {
  if (typeof TimestampTriggerCtor !== 'function') return false;
  if (!registration || typeof registration.showNotification !== 'function') return false;
  if (!Number.isFinite(at)) return false;
  try {
    registration.showNotification(title, {
      ...notificationOptions({ body, tag }),
      showTrigger: new TimestampTriggerCtor(at),
    });
    return true;
  } catch {
    return false;
  }
}

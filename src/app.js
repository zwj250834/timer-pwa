import { createTimer, IDLE, PAUSED, RUNNING } from './timer.js';
import { createHistory } from './history.js';
import { createResetGuard, RESET_CONFIRM_MS } from './reset-guard.js';
import {
  createCountdowns,
  FIRED as CD_FIRED,
  PAUSED as CD_PAUSED,
  RUNNING as CD_RUNNING,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
} from './countdown.js';
import {
  ALARM_AUTO_STOP_MS,
  closeSystemNotifications,
  createSiren,
  createVibrator,
  requestNotificationPermission,
  scheduleSystemTrigger,
  showSystemNotification,
} from './alarm.js';
import {
  describeDuration,
  formatClock,
  formatDuration,
  formatEndedAt,
  formatRemaining,
} from './format.js';
import { createKeepAlive, isAndroid } from './keep-alive.js';
import { createPushClient } from './push.js';

const MODE_KEY = 'timer.mode.v1';
const KEEP_ALIVE_KEY = 'timer.keepAlive.v1';
const STOPWATCH = 'stopwatch';
const COUNTDOWN = 'countdown';
/** 剩余时间少于这个值就进入「快到了」的视觉状态。 */
const URGENT_MS = 30_000;
const ICON = './icons/icon-192.png';
/** 保活只在 Android 上有意义，iOS 会在后台直接挂起 JS。 */
const IS_ANDROID = isAndroid();

const els = {
  // 正计时
  display: document.getElementById('display'),
  status: document.getElementById('status'),
  mainBtn: document.getElementById('main-btn'),
  resetBtn: document.getElementById('reset-btn'),
  list: document.getElementById('history-list'),
  empty: document.getElementById('history-empty'),
  count: document.getElementById('history-count'),
  historyView: document.getElementById('history-view'),
  // 模式
  modeBtns: Array.from(document.querySelectorAll('.mode__btn')),
  stopwatchView: document.getElementById('stopwatch-view'),
  countdownView: document.getElementById('countdown-view'),
  queueView: document.getElementById('queue-view'),
  // 倒计时
  form: document.getElementById('countdown-form'),
  labelInput: document.getElementById('cd-label'),
  presets: document.getElementById('cd-presets'),
  minInput: document.getElementById('cd-min'),
  secInput: document.getElementById('cd-sec'),
  queue: document.getElementById('queue'),
  queueEmpty: document.getElementById('queue-empty'),
  queueCount: document.getElementById('queue-count'),
  queueClear: document.getElementById('queue-clear'),
  carryover: document.getElementById('carryover'),
  carryoverText: document.getElementById('carryover-text'),
  carryoverBtn: document.getElementById('carryover-btn'),
  keepAliveRow: document.getElementById('keep-alive-row'),
  keepAlive: document.getElementById('keep-alive'),
  keepAliveWarn: document.getElementById('keep-alive-warn'),
  pushPanel: document.getElementById('push-panel'),
  pushState: document.getElementById('push-state'),
  pushUrl: document.getElementById('push-url'),
  pushEnable: document.getElementById('push-enable'),
  pushTest: document.getElementById('push-test'),
  pushDisable: document.getElementById('push-disable'),
  pushNote: document.getElementById('push-note'),
  // 提示层
  toast: document.getElementById('toast'),
  alarm: document.getElementById('alarm'),
  alarmLabel: document.getElementById('alarm-label'),
  alarmMeta: document.getElementById('alarm-meta'),
  alarmMore: document.getElementById('alarm-more'),
  alarmStop: document.getElementById('alarm-stop'),
};

const STATUS_TEXT = {
  [IDLE]: '就绪',
  [RUNNING]: '计时中',
  [PAUSED]: '已暂停',
};

const MAIN_TEXT = {
  [IDLE]: '开始',
  [RUNNING]: '暂停',
  [PAUSED]: '继续',
};

let mode = readMode();

let storageWarningShown = false;
let toastTimer = 0;
let frameHandle = 0;
let resetTimer = 0;
let countdownTimer = 0;
let alarmTimer = 0;
let wakeLock = null;
let swRegistration = null;
let notificationAsked = false;
let keepAliveOn = IS_ANDROID && readKeepAliveSetting();
let keepAliveShould = false;

/** 等待响铃的项，按到点顺序排队。 */
let ringing = false;
let alarmQueue = [];

function readMode() {
  try {
    return globalThis.localStorage?.getItem(MODE_KEY) === COUNTDOWN ? COUNTDOWN : STOPWATCH;
  } catch {
    return STOPWATCH;
  }
}

function writeMode(value) {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, value);
  } catch {
    /* 记不住也无所谓 */
  }
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function onStorageError(error) {
  if (storageWarningShown) return;
  storageWarningShown = true;
  console.warn('[timer] 本地存储不可用：', error);
  showToast('本机存储不可用，这次的记录只在打开期间保留。');
}

const timer = createTimer();
const history = createHistory({ onStorageError });
const countdowns = createCountdowns({ onStorageError });
const resetGuard = createResetGuard();
const siren = createSiren();
const vibrator = createVibrator();
const keepAlive = createKeepAlive();
const push = createPushClient();

/* ---------- 正计时渲染 ---------- */

function renderTimer() {
  const text = formatDuration(timer.elapsedMs());
  if (els.display.textContent !== text) els.display.textContent = text;

  els.status.textContent = STATUS_TEXT[timer.state];
  els.status.dataset.state = timer.state;
  els.mainBtn.textContent = MAIN_TEXT[timer.state];
  els.mainBtn.dataset.state = timer.state;

  const armed = resetGuard.armed;
  els.resetBtn.classList.toggle('is-armed', armed);
  els.resetBtn.textContent = armed ? '确认清空？' : '重置';
  els.resetBtn.disabled = timer.state === IDLE && history.list().length === 0;
}

function renderHistory() {
  const items = history.list();
  els.count.textContent = String(items.length);
  els.empty.hidden = items.length > 0;

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const row = document.createElement('li');
    row.className = 'history__item';
    row.dataset.id = item.id;

    const main = document.createElement('div');
    main.className = 'history__main';

    const order = document.createElement('span');
    order.className = 'history__index';
    order.textContent = `#${index + 1}`;

    const duration = document.createElement('span');
    duration.className = 'history__duration';
    duration.textContent = formatDuration(item.durationMs);

    const ended = document.createElement('span');
    ended.className = 'history__ended';
    ended.textContent = formatEndedAt(item.endedAt);

    main.append(order, duration, ended);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history__delete';
    remove.dataset.action = 'delete';
    remove.setAttribute('aria-label', `删除第 ${index + 1} 条记录`);
    remove.textContent = '✕';

    row.append(main, remove);
    fragment.append(row);
  });

  els.list.replaceChildren(fragment);
}

/* ---------- 倒计时渲染 ---------- */

function cap(text) {
  return text || '未填写事项';
}

/** 条目：运行中显示剩余读数，已响铃的显示状态徽标。 */
function createQueueRow(item, isNext) {
  const row = document.createElement('li');
  row.className = 'queue__item';
  row.dataset.id = item.id;
  row.dataset.state = item.state;
  if (isNext) row.dataset.next = 'true';
  if (item.state === CD_RUNNING && item.remainingMs <= URGENT_MS) row.dataset.urgent = 'true';

  const head = document.createElement('div');
  head.className = 'queue__head';

  if (item.state === CD_FIRED) {
    const flag = document.createElement('span');
    flag.className = 'queue__flag';
    flag.textContent = item.missed ? '已错过' : '已响铃';
    head.append(flag);
  } else {
    const time = document.createElement('span');
    time.className = 'queue__time';
    time.dataset.role = 'time';
    time.textContent = formatRemaining(item.remainingMs);
    head.append(time);
  }

  const label = document.createElement('span');
  label.className = 'queue__label';
  label.textContent = cap(item.label);
  head.append(label);

  row.append(head);

  let fill = null;
  if (item.state !== CD_FIRED) {
    const rail = document.createElement('div');
    rail.className = 'queue__rail';
    rail.setAttribute('aria-hidden', 'true');
    fill = document.createElement('span');
    fill.className = 'queue__fill';
    fill.dataset.role = 'fill';
    fill.style.width = `${(queueProgress(item) * 100).toFixed(2)}%`;
    rail.append(fill);
    row.append(rail);
  }

  const foot = document.createElement('div');
  foot.className = 'queue__foot';

  const meta = document.createElement('span');
  meta.className = 'queue__meta';
  meta.dataset.role = 'meta';
  meta.textContent = queueMeta(item);

  const actions = document.createElement('div');
  actions.className = 'queue__actions';
  for (const action of queueActions(item)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'act';
    button.dataset.action = action.name;
    button.textContent = action.text;
    if (action.title) button.title = action.title;
    button.setAttribute(
      'aria-label',
      action.title
        ? `${action.text}：${cap(item.label)}，${action.title}`
        : `${action.text}：${cap(item.label)}`
    );
    actions.append(button);
  }

  foot.append(meta, actions);
  row.append(foot);
  return row;
}

function queueMeta(item) {
  if (item.state === CD_FIRED) return `原定 ${formatClock(item.firedAt)} 提醒`;
  if (item.state === CD_PAUSED) return '已暂停';
  return `${formatClock(item.endsAt)} 提醒`;
}

function queueActions(item) {
  if (item.state === CD_FIRED) {
    return [
      { name: 'repeat', text: '再来一次' },
      { name: 'remove', text: '删除' },
    ];
  }
  return [
    { name: 'toggle', text: item.state === CD_PAUSED ? '继续' : '暂停' },
    { name: 'remove', text: '取消' },
  ];
}

function queueProgress(item) {
  if (item.state === CD_FIRED) return 0;
  if (!item.durationMs) return 0;
  return Math.min(1, Math.max(0, item.remainingMs / item.durationMs));
}

function nextIdOf(items) {
  let next = null;
  for (const item of items) {
    if (item.state === CD_FIRED) continue;
    if (!next || item.remainingMs < next.remainingMs) next = item;
  }
  return next ? next.id : null;
}

function renderQueue() {
  const items = countdowns.list();
  els.queueCount.textContent = String(items.length);
  els.queueEmpty.hidden = items.length > 0;
  els.queueClear.hidden = !items.some((item) => item.state === CD_FIRED);

  const nextId = nextIdOf(items);
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    fragment.append(createQueueRow(item, item.id === nextId));
  }
  els.queue.replaceChildren(fragment);
}

/** 只刷新随时间变化的读数，不动 DOM 结构（每帧都要跑）。 */
function refreshQueueReadouts() {
  const items = countdowns.list();
  const byId = new Map(items.map((item) => [item.id, item]));
  const nextId = nextIdOf(items);

  for (const row of els.queue.children) {
    const item = byId.get(row.dataset.id);
    if (!item || item.state === CD_FIRED) continue;

    const time = row.querySelector('[data-role="time"]');
    if (time) {
      const text = formatRemaining(item.remainingMs);
      if (time.textContent !== text) time.textContent = text;
    }

    const fill = row.querySelector('[data-role="fill"]');
    if (fill) fill.style.width = `${(queueProgress(item) * 100).toFixed(2)}%`;

    const meta = row.querySelector('[data-role="meta"]');
    if (meta) {
      const text = queueMeta(item);
      if (meta.textContent !== text) meta.textContent = text;
    }

    const urgent = item.state === CD_RUNNING && item.remainingMs <= URGENT_MS;
    if (row.dataset.urgent !== String(urgent)) row.dataset.urgent = String(urgent);

    const isNext = item.id === nextId;
    if (isNext) row.dataset.next = 'true';
    else delete row.dataset.next;
  }
}

/** 正计时还在跑的时候切到倒计时，给一条提示，避免忘了它。 */
function renderCarryover() {
  const visible = mode === COUNTDOWN && timer.state !== IDLE;
  els.carryover.hidden = !visible;
  if (!visible) return;
  els.carryoverText.textContent = `${
    timer.state === RUNNING ? '正计时还在跑' : '正计时已暂停'
  }：${formatDuration(timer.elapsedMs())}`;
}

function renderAll() {
  renderTimer();
  renderHistory();
  renderQueue();
  renderCarryover();
}

/* ---------- 模式切换 ---------- */

function setMode(next) {
  mode = next === COUNTDOWN ? COUNTDOWN : STOPWATCH;
  writeMode(mode);
  document.body.dataset.mode = mode;

  for (const button of els.modeBtns) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }

  const counting = mode === COUNTDOWN;
  els.stopwatchView.hidden = counting;
  els.historyView.hidden = counting;
  els.countdownView.hidden = !counting;
  els.queueView.hidden = !counting;

  renderAll();
  ensureLoop();
  updateTitle();
}

/* ---------- 计时循环 ---------- */

function loopFrame() {
  frameHandle = 0;
  renderTimer();
  if (timer.state === RUNNING) frameHandle = window.requestAnimationFrame(loopFrame);
}

function ensureLoop() {
  if (timer.state === RUNNING && !frameHandle) {
    frameHandle = window.requestAnimationFrame(loopFrame);
  }
}

function updateTitle() {
  if (ringing) {
    document.title = `时间到：${cap(alarmQueue[0]?.label)}`;
    return;
  }
  if (mode !== COUNTDOWN) {
    document.title = '计时器';
    return;
  }
  const items = countdowns.list().filter((item) => item.state !== CD_FIRED);
  document.title = items.length ? `${formatRemaining(items[0].remainingMs)} ${cap(items[0].label)}` : '倒计时';
}

/* ---------- 系统闹钟能力 ---------- */

async function acquireWakeLock() {
  if (wakeLock || document.hidden) return;
  if (!countdowns.activeCount) return;
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  try {
    await lock?.release();
  } catch {
    /* 已经释放 */
  }
}

/* ---------- 锁屏保活 ---------- */

function readKeepAliveSetting() {
  try {
    const raw = globalThis.localStorage?.getItem(KEEP_ALIVE_KEY);
    if (raw === 'off') return false;
    if (raw === 'on') return true;
  } catch {
    /* 读不到就用默认值 */
  }
  // 默认开：倒计时的意义就是到点有人叫你，熄屏不响等于没设。
  return true;
}

function writeKeepAliveSetting(value) {
  try {
    globalThis.localStorage?.setItem(KEEP_ALIVE_KEY, value ? 'on' : 'off');
  } catch {
    /* 记不住设定不影响本次使用 */
  }
}

/**
 * 有倒计时在跑（或正在响铃）时保持后台运行，让浏览器别在熄屏后被冻结。
 * 播放必须由手势启动，所以被拒绝时不做任何事，等下一次手势再试。
 */
function syncKeepAlive({ force = false } = {}) {
  const should = keepAliveOn && (countdowns.activeCount > 0 || ringing);
  if (!force && should === keepAliveShould) return;
  keepAliveShould = should;
  if (should) {
    keepAlive.start();
    // play() 是异步的，稍等一下再看它有没有真的播起来（被自动播放策略挡住时给个提示）。
    window.setTimeout(renderKeepAliveState, 400);
  } else {
    keepAlive.stop();
    renderKeepAliveState();
  }
}

/** 保活没跑起来时直说，并告诉用户点一下屏幕就能恢复。 */
function renderKeepAliveState() {
  const wanted = keepAliveOn && (countdowns.activeCount > 0 || ringing);
  els.keepAliveWarn.hidden = !(wanted && !keepAlive.playing);
}

function onKeepAliveChange() {
  keepAliveOn = IS_ANDROID && els.keepAlive.checked;
  writeKeepAliveSetting(els.keepAlive.checked);
  syncKeepAlive({ force: true });
  showToast(
    keepAliveOn
      ? '倒计时期间会保持后台运行，熄屏也尽量叫醒你。'
      : '已关闭锁屏保持，熄屏后可能不会响。'
  );
}

function setupKeepAlive() {
  els.keepAliveRow.hidden = !IS_ANDROID;
  els.keepAlive.checked = keepAliveOn;
  syncKeepAlive({ force: true });
}

/* ---------- 熄屏提醒（自建推送服务） ---------- */

const PUSH_SUPPORTED =
  typeof globalThis.PushManager === 'function' && 'serviceWorker' in navigator;

function renderPushState(state, note) {
  const labels = { off: '未开启', on: '已开启', busy: '处理中…', error: '有问题' };
  els.pushState.textContent = labels[state] ?? labels.off;
  els.pushState.dataset.state = state === 'on' ? 'on' : state === 'error' ? 'error' : 'off';
  if (note) {
    els.pushNote.textContent = note;
    els.pushNote.dataset.state = state === 'error' ? 'error' : '';
  }
  const ready = push.config().enabled;
  els.pushEnable.hidden = ready;
  els.pushTest.hidden = !ready;
  els.pushDisable.hidden = !ready;
  els.pushEnable.disabled = state === 'busy';
}

function setupPush() {
  if (!PUSH_SUPPORTED) {
    els.pushPanel.hidden = true;
    return;
  }
  const config = push.config();
  if (config.url) els.pushUrl.value = config.url;
  if (config.enabled) {
    renderPushState('on', `已开启。到点由 ${config.url} 发推送，锁屏也会响。`);
  } else {
    renderPushState('off');
  }
}

/** 把当前还在跑的倒计时全部登记到服务端，保证两边一致。 */
async function syncPushReminders() {
  if (!push.config().enabled) return { ok: true };
  const items = countdowns.list().filter((item) => item.state !== CD_FIRED);
  for (const item of items) {
    const result = await push.schedule({ id: item.id, at: item.endsAt, label: item.label });
    if (!result.ok && !result.skipped) return result;
  }
  return { ok: true };
}

async function pushSchedule(item) {
  if (!push.config().enabled || !item) return;
  const result = await push.schedule({ id: item.id, at: item.endsAt, label: item.label });
  if (!result.ok && !result.skipped) {
    renderPushState('error', `同步失败：${result.error}`);
  }
}

function pushCancel(id) {
  if (!push.config().enabled) return;
  void push.cancel(id);
}

async function onPushEnable() {
  renderPushState('busy', '正在向浏览器申请通知权限…');
  const result = await push.enable(els.pushUrl.value);
  if (!result.ok) {
    renderPushState('error', result.error);
    showToast(result.error);
    return;
  }

  els.pushUrl.value = result.url;
  renderPushState('busy', '正在把现有的倒计时交给服务端…');
  const sync = await syncPushReminders();
  if (!sync.ok) {
    renderPushState('error', `已开通，但同步失败：${sync.error}`);
    showToast('已开通熄屏提醒，但有一项没同步成功。');
    return;
  }

  renderPushState('on', `已开启。到点由 ${result.url} 发推送，锁屏也会响。`);
  showToast('已开启熄屏提醒，可以点「发测试提醒」验证一下。');
}

async function onPushDisable() {
  renderPushState('busy', '正在关闭…');
  await push.disable();
  renderPushState('off', '已关闭熄屏提醒，服务端不再保留你的订阅和提醒。');
  showToast('已关闭熄屏提醒。');
}

async function onPushTest() {
  els.pushTest.disabled = true;
  showToast('正在发送测试提醒…');
  const result = await push.test();
  els.pushTest.disabled = false;
  if (result.ok) {
    renderPushState('on', '测试提醒已发出。锁屏后应该会弹出通知。');
    showToast('已发送。把手机锁屏，几秒内应该会响。');
  } else {
    renderPushState('error', result.error);
    showToast(result.error);
  }
}

/** 图标上的小红点：系统层面再提醒一次「有事项到点了」。 */
function setAppBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count);
    else navigator.clearAppBadge?.();
  } catch {
    /* 不支持就跳过 */
  }
}

async function ensureNotificationPermission() {
  if (notificationAsked) return;
  notificationAsked = true;
  const result = await requestNotificationPermission();
  if (result === 'granted') showToast('到点时会响铃，并弹出系统通知。');
  else if (result === 'denied') showToast('通知被拒绝了，倒计时到点仍会在页面里响铃。');
}

async function notifySystem(item) {
  return showSystemNotification({
    title: `时间到：${cap(item.label)}`,
    body: `设定了 ${describeDuration(item.durationMs)} 的提醒，现在 ${formatClock(Date.now())}。`,
    tag: `countdown-${item.id}`,
    icon: ICON,
    badge: ICON,
    registration: swRegistration,
  });
}

/** 部分 Chromium 支持把通知交给系统在指定时刻投递，页面挂起也不会迟到。 */
function scheduleTrigger(item) {
  return scheduleSystemTrigger({
    title: `时间到：${cap(item.label)}`,
    body: `设定了 ${describeDuration(item.durationMs)} 的提醒。`,
    tag: `countdown-${item.id}`,
    at: item.endsAt,
    registration: swRegistration,
  });
}

/* ---------- 响铃 ---------- */

function renderAlarmCard() {
  const item = alarmQueue[0];
  if (!item) return;
  els.alarmLabel.textContent = cap(item.label);
  els.alarmMeta.textContent = `设定了 ${describeDuration(item.durationMs)}，现在 ${formatClock(
    Date.now()
  )}。`;
  const rest = alarmQueue.length - 1;
  els.alarmMore.hidden = rest <= 0;
  els.alarmMore.textContent = rest > 0 ? `另外还有 ${rest} 项到时间了，停止后会接着响。` : '';
}

function armAlarmTimeout() {
  window.clearTimeout(alarmTimer);
  alarmTimer = window.setTimeout(() => {
    alarmTimer = 0;
    stopRinging();
  }, ALARM_AUTO_STOP_MS);
}

function startRinging(focus) {
  if (!alarmQueue.length) return;
  ringing = true;
  document.body.classList.add('is-ringing');
  els.alarm.hidden = false;
  renderAlarmCard();
  armAlarmTimeout();
  siren.start();
  vibrator.start();
  setAppBadge(alarmQueue.length);
  if (focus) els.alarmStop.focus({ preventScroll: true });
  void acquireWakeLock();
  updateTitle();
}

function stopRinging() {
  siren.stop();
  vibrator.stop();
  window.clearTimeout(alarmTimer);
  alarmTimer = 0;
  ringing = false;
  alarmQueue = [];
  setAppBadge(0);
  document.body.classList.remove('is-ringing');
  els.alarm.hidden = true;
  void releaseWakeLock();
  syncKeepAlive();
  renderQueue();
  updateTitle();
}

function dismissAlarm() {
  const done = alarmQueue.shift();
  if (done) {
    void closeSystemNotifications({ tag: `countdown-${done.id}`, registration: swRegistration });
  }
  if (!alarmQueue.length) {
    stopRinging();
    return;
  }
  renderAlarmCard();
  armAlarmTimeout();
  setAppBadge(alarmQueue.length);
  void notifySystem(alarmQueue[0]);
  updateTitle();
}

function handleFired(fired) {
  let queued = false;
  for (const item of fired) {
    if (item.missed) {
      showToast(`错过了「${cap(item.label)}」，原定 ${formatClock(item.firedAt)} 提醒。`);
      continue;
    }
    alarmQueue.push(item);
    queued = true;
  }
  if (!queued) return;
  if (ringing) {
    renderAlarmCard();
    updateTitle();
    return;
  }
  startRinging(true);
  void notifySystem(alarmQueue[0]);
}

/** 结算到点的倒计时，并刷新读数。 */
function tickCountdowns() {
  const fired = countdowns.sync(Date.now());
  if (fired.length) {
    handleFired(fired);
    renderQueue();
  } else {
    refreshQueueReadouts();
  }
  syncKeepAlive();
  renderCarryover();
  updateTitle();
}

function ensureCountdownTimer() {
  if (countdownTimer) return;
  countdownTimer = window.setInterval(() => {
    if (mode !== COUNTDOWN && !countdowns.activeCount && !ringing) return;
    tickCountdowns();
  }, 250);
}

/* ---------- 交互：正计时 ---------- */

function clearResetTimer() {
  window.clearTimeout(resetTimer);
  resetTimer = 0;
}

function disarmReset() {
  clearResetTimer();
  if (resetGuard.cancel()) renderTimer();
}

function performReset() {
  disarmReset();
  timer.reset();
  history.clear();
  renderAll();
}

function onResetClick() {
  if (history.list().length === 0) {
    performReset();
    return;
  }

  if (resetGuard.request() === 'confirmed') {
    performReset();
    return;
  }

  renderTimer();
  clearResetTimer();
  resetTimer = window.setTimeout(() => {
    resetTimer = 0;
    if (resetGuard.expired()) renderTimer();
  }, RESET_CONFIRM_MS + 30);
}

function onMainClick() {
  disarmReset();
  const action = timer.toggle();
  if (action === 'paused') {
    history.add({ durationMs: timer.elapsedMs(), endedAt: Date.now() });
    renderHistory();
  }
  ensureLoop();
  renderAll();
}

/* ---------- 交互：倒计时 ---------- */

function readMinutes() {
  const value = Number.parseInt(els.minInput.value, 10);
  return Number.isFinite(value) ? Math.min(1440, Math.max(0, value)) : 0;
}

function readSeconds() {
  const value = Number.parseInt(els.secInput.value, 10);
  return Number.isFinite(value) ? Math.min(59, Math.max(0, value)) : 0;
}

function syncChips() {
  const minutes = readMinutes();
  const seconds = readSeconds();
  for (const chip of els.presets.querySelectorAll('.chip')) {
    const active = Number(chip.dataset.minutes) === minutes && seconds === 0;
    chip.setAttribute('aria-pressed', String(active));
  }
}

function onPresetClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const chip = target?.closest('.chip');
  if (!chip) return;
  els.minInput.value = chip.dataset.minutes;
  els.secInput.value = '0';
  syncChips();
}

function onCountdownSubmit(event) {
  event.preventDefault();

  const label = els.labelInput.value.trim();
  const durationMs = readMinutes() * 60_000 + readSeconds() * 1000;

  if (!label) {
    showToast('先写一句要提醒的事吧。');
    els.labelInput.focus();
    return;
  }
  if (durationMs < MIN_DURATION_MS) {
    showToast('时长至少 1 秒。');
    els.minInput.focus();
    return;
  }
  if (durationMs > MAX_DURATION_MS) {
    showToast('最长只能设 24 小时。');
    return;
  }

  const item = countdowns.add({ label, durationMs });
  if (!item) {
    showToast(`同时最多排 ${countdowns.limit} 项，先清掉几条吧。`);
    return;
  }

  siren.unlock();
  syncKeepAlive({ force: true });
  void ensureNotificationPermission();
  scheduleTrigger(item);
  void pushSchedule(item);
  void acquireWakeLock();

  els.labelInput.value = '';
  renderQueue();
  updateTitle();
  showToast(`已排入：${describeDuration(item.durationMs)}后提醒「${cap(item.label)}」。`);
  els.labelInput.focus();
}

function onQueueClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('button[data-action]');
  const row = button?.closest('li[data-id]');
  if (!button || !row) return;

  const id = row.dataset.id;
  const action = button.dataset.action;

  if (action === 'toggle') {
    const state = countdowns.toggle(id);
    const current = countdowns.list().find((item) => item.id === id);
    if (state === CD_RUNNING) {
      void acquireWakeLock();
      if (current) scheduleTrigger(current);
      void pushSchedule(current);
    } else if (state === CD_PAUSED) {
      pushCancel(id);
    }
  } else if (action === 'remove') {
    void closeSystemNotifications({ tag: `countdown-${id}`, registration: swRegistration });
    pushCancel(id);
    countdowns.remove(id);
  } else if (action === 'repeat') {
    const item = countdowns.repeat(id);
    if (!item) {
      showToast(`同时最多排 ${countdowns.limit} 项，先清掉几条吧。`);
    } else {
      scheduleTrigger(item);
      void pushSchedule(item);
      showToast(`已重新排入：${describeDuration(item.durationMs)}后提醒「${cap(item.label)}」。`);
    }
  }

  syncKeepAlive();
  renderQueue();
  renderCarryover();
  updateTitle();
}

function onQueueClear() {
  if (countdowns.clearFired()) {
    syncKeepAlive();
    renderQueue();
    showToast('已清掉响过的提醒。');
  }
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  els.mainBtn.addEventListener('click', onMainClick);
  els.resetBtn.addEventListener('click', onResetClick);
  els.form.addEventListener('submit', onCountdownSubmit);
  els.presets.addEventListener('click', onPresetClick);
  els.minInput.addEventListener('input', syncChips);
  els.secInput.addEventListener('input', syncChips);
  els.queue.addEventListener('click', onQueueClick);
  els.queueClear.addEventListener('click', onQueueClear);
  els.keepAlive.addEventListener('change', onKeepAliveChange);
  els.alarmStop.addEventListener('click', dismissAlarm);
  els.pushEnable.addEventListener('click', onPushEnable);
  els.pushTest.addEventListener('click', onPushTest);
  els.pushDisable.addEventListener('click', onPushDisable);

  for (const button of els.modeBtns) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  }

  els.carryoverBtn.addEventListener('click', () => setMode(STOPWATCH));

  els.list.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button[data-action="delete"]');
    const row = button?.closest('li[data-id]');
    if (!row) return;
    if (history.remove(row.dataset.id)) renderAll();
  });

  // 点击别处解除二次确认，避免按钮长时间停在「确认清空？」状态。
  document.addEventListener(
    'click',
    (event) => {
      if (!resetGuard.armed) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && els.resetBtn.contains(target)) return;
      disarmReset();
    },
    true
  );

  // 首次用户交互时唤醒音频通道，这样到点响铃才有声音。
  let audioUnlocked = false;
  const onUserGesture = () => {
    if (!audioUnlocked) {
      audioUnlocked = true;
      siren.unlock();
    }
    // 保活播放需要手势授权，每次手势都顺手确认一遍它还在跑。
    syncKeepAlive({ force: true });
  };
  document.addEventListener('pointerdown', onUserGesture, { passive: true });
  document.addEventListener('keydown', onUserGesture);

  // 回到前台时立刻用墙钟重算一次，读数不会因为后台节流而落后。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    tickCountdowns();
    renderAll();
    syncKeepAlive({ force: true });
    void acquireWakeLock();
  });

  window.addEventListener('pagehide', () => {
    // 页面被卸载或进入往返缓存时，把铃停掉，避免恢复后停在「响铃中」的假状态。
    stopRinging();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
      swRegistration = await navigator.serviceWorker.ready;
    } catch (error) {
      console.warn('[timer] Service Worker 注册失败：', error);
    }
  });
}

function init() {
  bindEvents();
  setMode(mode);
  syncChips();
  setupKeepAlive();
  setupPush();
  ensureLoop();
  ensureCountdownTimer();
  registerServiceWorker();
  // 打开时先结算一次：离线期间到点的倒计时会在这里被接住。
  tickCountdowns();
  // 服务端可能被重置过（重新部署、换了 Worker），开机时对一次表。
  void syncPushReminders();
  void acquireWakeLock();
}

init();

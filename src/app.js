import { createTimer, IDLE, PAUSED, RUNNING } from './timer.js';
import { createHistory } from './history.js';
import { formatDuration, formatEndedAt } from './format.js';
import { createResetGuard, RESET_CONFIRM_MS } from './reset-guard.js';

const els = {
  display: document.getElementById('display'),
  status: document.getElementById('status'),
  mainBtn: document.getElementById('main-btn'),
  resetBtn: document.getElementById('reset-btn'),
  list: document.getElementById('history-list'),
  empty: document.getElementById('history-empty'),
  count: document.getElementById('history-count'),
  toast: document.getElementById('toast'),
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

let storageWarningShown = false;
let toastTimer = 0;
let frameHandle = 0;
let resetTimer = 0;

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
  showToast('本机存储不可用，历史记录只在本次打开期间保留。');
}

const timer = createTimer();
const history = createHistory({ onStorageError });
const resetGuard = createResetGuard();

function renderTimer() {
  const text = formatDuration(timer.elapsedMs());
  if (els.display.textContent !== text) els.display.textContent = text;

  els.status.textContent = STATUS_TEXT[timer.state];
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

function renderAll() {
  renderTimer();
  renderHistory();
}

/* ---------- 计时循环 ---------- */

function tick() {
  renderTimer();
  frameHandle = timer.state === RUNNING ? window.requestAnimationFrame(tick) : 0;
}

function ensureLoop() {
  if (timer.state === RUNNING && !frameHandle) {
    frameHandle = window.requestAnimationFrame(tick);
  }
}

/* ---------- 交互 ---------- */

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

function bindEvents() {
  els.mainBtn.addEventListener('click', onMainClick);
  els.resetBtn.addEventListener('click', onResetClick);

  els.list.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button[data-action="delete"]');
    const row = button?.closest('li[data-id]');
    if (!row) return;
    if (history.remove(row.dataset.id)) {
      renderAll();
    }
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

  // 回到前台时立刻用墙钟重算一次，读数不会因为后台节流而落后。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderTimer();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('[timer] Service Worker 注册失败：', error);
    });
  });
}

function init() {
  bindEvents();
  renderAll();
  registerServiceWorker();
}

init();

/**
 * 倒计时队列（纯逻辑 + 持久化）。
 *
 * 与秒表一样按墙钟推算剩余时间，因此后台节流、锁屏、切标签页都不会让读数走偏。
 * 每一项独立计时，可以同时存在多条，每条都带自己的提醒事项。
 */

export const STORAGE_KEY = 'timer.countdowns.v1';
export const DEFAULT_LIMIT = 24;
export const MIN_DURATION_MS = 1000;
export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const MAX_LABEL_LENGTH = 60;
/** 超过这个时长才到期的项算「错过」，只在界面里提示，不再响铃。 */
export const MISSED_AFTER_MS = 60 * 60 * 1000;

export const RUNNING = 'running';
export const PAUSED = 'paused';
export const FIRED = 'fired';

const STATES = new Set([RUNNING, PAUSED, FIRED]);

/** 仅用于测试或存储不可用时的兜底。 */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** 事项文字：去掉首尾空白、折叠内部空白、截断到上限。 */
export function normalizeLabel(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
}

/**
 * 时长：非法或短于 1 秒返回 0（视为无效），超过 24 小时按 24 小时封顶。
 */
export function normalizeDuration(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return 0;
  const floored = Math.floor(ms);
  if (floored < MIN_DURATION_MS) return 0;
  return Math.min(floored, MAX_DURATION_MS);
}

function isValidEntry(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!STATES.has(value.state)) return false;
  if (normalizeDuration(value.durationMs) === 0) return false;
  if (value.state === RUNNING && !(Number.isFinite(value.endsAt) && value.endsAt > 0)) {
    return false;
  }
  if (value.state === PAUSED && !(Number.isFinite(value.remainingMs) && value.remainingMs > 0)) {
    return false;
  }
  if (value.state === FIRED && !(Number.isFinite(value.firedAt) && value.firedAt > 0)) {
    return false;
  }
  return true;
}

function normalizeEntry(value) {
  return {
    id: value.id,
    label: normalizeLabel(value.label),
    durationMs: normalizeDuration(value.durationMs),
    state: value.state,
    endsAt: value.state === RUNNING ? value.endsAt : 0,
    remainingMs:
      value.state === PAUSED ? Math.min(value.remainingMs, normalizeDuration(value.durationMs)) : 0,
    firedAt: value.state === FIRED ? value.firedAt : 0,
    missed: value.state === FIRED ? value.missed === true : false,
  };
}

/** 清洗外来数据：非法条目、重复 id 剔除，未到时间的排在前面。 */
export function sanitizeCountdowns(raw, limit = DEFAULT_LIMIT) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const entries = [];
  for (const item of raw) {
    if (!isValidEntry(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    entries.push(normalizeEntry(item));
  }
  entries.sort((a, b) => {
    const rank = rankOf(a) - rankOf(b);
    if (rank !== 0) return rank;
    if (a.state === FIRED) return b.firedAt - a.firedAt;
    // 这里没有「现在」可用，所以运行中的按绝对截止时刻、暂停中的按剩余时长各自排序。
    return a.state === RUNNING ? a.endsAt - b.endsAt : a.remainingMs - b.remainingMs;
  });
  return entries.slice(0, Math.max(0, limit));
}

/** 排序分组：还没响的在前，其次暂停中的，最后已经响过的。 */
function rankOf(entry) {
  if (entry.state === FIRED) return 2;
  return entry.state === RUNNING ? 0 : 1;
}

export function createCountdowns({
  storage,
  limit = DEFAULT_LIMIT,
  now = Date.now,
  missedAfterMs = MISSED_AFTER_MS,
  onStorageError,
} = {}) {
  const store =
    storage ??
    (typeof globalThis.localStorage !== 'undefined'
      ? globalThis.localStorage
      : createMemoryStorage());

  let errorReported = false;
  let seq = 0;
  let entries = [];

  function reportError(error) {
    if (errorReported) return;
    errorReported = true;
    if (typeof onStorageError === 'function') onStorageError(error);
  }

  function readNow(at) {
    const value = Number.isFinite(at) ? at : now();
    return Number.isFinite(value) ? value : Date.now();
  }

  function load() {
    let raw = null;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch (error) {
      reportError(error);
      return [];
    }
    if (!raw) return [];
    try {
      return sanitizeCountdowns(JSON.parse(raw), limit);
    } catch (error) {
      reportError(error);
      try {
        store.removeItem(STORAGE_KEY);
      } catch {
        /* 清理失败不影响使用 */
      }
      return [];
    }
  }

  function persist() {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (error) {
      reportError(error);
    }
  }

  function nextId(stamp) {
    seq += 1;
    let suffix = seq;
    let id = `${stamp.toString(36)}-${suffix.toString(36)}`;
    while (entries.some((entry) => entry.id === id)) {
      suffix += 1;
      id = `${stamp.toString(36)}-${suffix.toString(36)}`;
    }
    return id;
  }

  function find(id) {
    return entries.find((entry) => entry.id === id) ?? null;
  }

  /** 某一项在指定时刻还剩多少毫秒。 */
  function remainingOf(entry, at) {
    if (!entry) return 0;
    if (entry.state === PAUSED) return Math.max(0, entry.remainingMs);
    if (entry.state === FIRED) return 0;
    return Math.max(0, entry.endsAt - readNow(at));
  }

  function snapshot(entry, at) {
    const remainingMs = remainingOf(entry, at);
    const stamp = readNow(at);
    return {
      ...entry,
      remainingMs,
      // 运行中：按计划结束时刻；暂停中：按「此刻继续不间断地跑完」的时刻。
      endsAt: entry.state === RUNNING ? entry.endsAt : stamp + remainingMs,
    };
  }

  function sortEntries() {
    entries.sort((a, b) => {
      const aDone = a.state === FIRED;
      const bDone = b.state === FIRED;
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (aDone) return b.firedAt - a.firedAt;
      const aLeft = remainingOf(a);
      const bLeft = remainingOf(b);
      if (aLeft !== bLeft) return aLeft - bLeft;
      return b.durationMs - a.durationMs;
    });
  }

  /** 追加一项，返回新建的条目；事项为空允许、时长非法或队列已满返回 null。 */
  function add({ label, durationMs, at } = {}) {
    const duration = normalizeDuration(durationMs);
    if (duration === 0) return null;
    if (entries.length >= Math.max(1, limit)) return null;

    const stamp = readNow(at);
    const entry = {
      id: nextId(stamp),
      label: normalizeLabel(label),
      durationMs: duration,
      state: RUNNING,
      endsAt: stamp + duration,
      remainingMs: duration,
      firedAt: 0,
      missed: false,
    };
    entries.push(entry);
    sortEntries();
    persist();
    return snapshot(entry, stamp);
  }

  /** 暂停：剩余时间冻结。已到时间但还没结算的项不在这里处理，交给 sync。 */
  function pause(id, at) {
    const entry = find(id);
    if (!entry || entry.state !== RUNNING) return false;
    const left = remainingOf(entry, at);
    if (left <= 0) return false;
    entry.remainingMs = left;
    entry.endsAt = 0;
    entry.state = PAUSED;
    sortEntries();
    persist();
    return true;
  }

  /** 继续：用剩余时间重新推算截止时刻。 */
  function resume(id, at) {
    const entry = find(id);
    if (!entry || entry.state !== PAUSED) return false;
    const left = entry.remainingMs > 0 ? entry.remainingMs : entry.durationMs;
    entry.endsAt = readNow(at) + left;
    entry.remainingMs = left;
    entry.state = RUNNING;
    sortEntries();
    persist();
    return true;
  }

  function toggle(id, at) {
    const entry = find(id);
    if (!entry) return null;
    if (entry.state === RUNNING) return pause(id, at) ? PAUSED : null;
    if (entry.state === PAUSED) return resume(id, at) ? RUNNING : null;
    return null;
  }

  /** 用同样的时长和事项再排一项（「再来一次」）。 */
  function repeat(id, at) {
    const entry = find(id);
    if (!entry) return null;
    return add({ label: entry.label, durationMs: entry.durationMs, at });
  }

  function remove(id) {
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return false;
    entries = next;
    persist();
    return true;
  }

  function clear() {
    entries = [];
    persist();
  }

  /** 只清掉已经响过/错过的项。 */
  function clearFired() {
    const next = entries.filter((entry) => entry.state !== FIRED);
    if (next.length === entries.length) return false;
    entries = next;
    persist();
    return true;
  }

  /**
   * 结算到期的项：转为 fired 并返回它们，供界面响铃。
   * 超时太久（默认 1 小时）的项标记 missed，只提示不响铃。
   */
  function sync(at) {
    const stamp = readNow(at);
    const fired = [];
    let changed = false;
    for (const entry of entries) {
      if (entry.state !== RUNNING) continue;
      if (entry.endsAt - stamp > 0) continue;
      entry.state = FIRED;
      entry.firedAt = entry.endsAt;
      entry.remainingMs = 0;
      entry.missed = stamp - entry.endsAt > missedAfterMs;
      changed = true;
      fired.push(snapshot(entry, stamp));
    }
    if (changed) {
      sortEntries();
      persist();
    }
    return fired;
  }

  function reload() {
    entries = load();
    return list();
  }

  function list(at) {
    sortEntries();
    return entries.map((entry) => snapshot(entry, at));
  }

  entries = load();

  return {
    list,
    add,
    pause,
    resume,
    toggle,
    repeat,
    remove,
    clear,
    clearFired,
    sync,
    reload,
    remainingOf,
    get limit() {
      return limit;
    },
    get activeCount() {
      return entries.filter((entry) => entry.state !== FIRED).length;
    },
  };
}

export const STORAGE_KEY = 'timer.history.v1';
export const DEFAULT_LIMIT = 10;

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

function isEntry(value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    Number.isFinite(value.endedAt) &&
    value.endedAt > 0;
}

/**
 * 清洗外来数据：非法条目剔除、重复 id 剔除、按结束时刻倒序、截断到上限。
 */
export function sanitizeHistory(raw, limit = DEFAULT_LIMIT) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const entries = [];
  for (const item of raw) {
    if (!isEntry(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    entries.push({
      id: item.id,
      durationMs: Math.floor(item.durationMs),
      endedAt: item.endedAt,
    });
  }
  entries.sort((a, b) => b.endedAt - a.endedAt);
  return entries.slice(0, Math.max(0, limit));
}

export function createHistory({
  storage,
  limit = DEFAULT_LIMIT,
  now = Date.now,
  onStorageError,
} = {}) {
  const store =
    storage ?? (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : createMemoryStorage());

  let errorReported = false;
  let seq = 0;
  let entries = [];

  function reportError(error) {
    if (errorReported) return;
    errorReported = true;
    if (typeof onStorageError === 'function') onStorageError(error);
  }

  function readNow() {
    const value = now();
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
      return sanitizeHistory(JSON.parse(raw), limit);
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

  function nextId(endedAt) {
    seq += 1;
    let suffix = seq;
    let id = `${endedAt.toString(36)}-${suffix.toString(36)}`;
    while (entries.some((entry) => entry.id === id)) {
      suffix += 1;
      id = `${endedAt.toString(36)}-${suffix.toString(36)}`;
    }
    return id;
  }

  function add({ durationMs, endedAt } = {}) {
    const stamp = Number.isFinite(endedAt) ? endedAt : readNow();
    const entry = {
      id: nextId(stamp),
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 0,
      endedAt: stamp,
    };
    entries = [entry, ...entries].slice(0, Math.max(0, limit));
    persist();
    return { ...entry };
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

  function reload() {
    entries = load();
    return list();
  }

  function list() {
    return entries.map((entry) => ({ ...entry }));
  }

  entries = load();

  return {
    list,
    add,
    remove,
    clear,
    reload,
    get limit() {
      return limit;
    },
  };
}

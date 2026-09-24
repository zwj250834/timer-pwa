import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHistory,
  createMemoryStorage,
  sanitizeHistory,
  STORAGE_KEY,
  DEFAULT_LIMIT,
} from '../src/history.js';

const BASE = 1_700_000_000_000;

function entry(id, durationMs, endedAt) {
  return { id, durationMs, endedAt };
}

test('默认上限为 10 条', () => {
  assert.equal(DEFAULT_LIMIT, 10);
});

test('空存储时列表为空', () => {
  const history = createHistory({ storage: createMemoryStorage() });
  assert.deepEqual(history.list(), []);
  assert.equal(history.limit, 10);
});

test('add 后最新记录在最前并立即持久化', () => {
  const storage = createMemoryStorage();
  const history = createHistory({ storage, now: () => BASE });

  const first = history.add({ durationMs: 1500, endedAt: BASE });
  const second = history.add({ durationMs: 2500, endedAt: BASE + 1000 });

  const list = history.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id);
  assert.equal(list[1].id, first.id);
  assert.equal(list[0].durationMs, 2500);

  const restored = createHistory({ storage }).list();
  assert.deepEqual(restored, list);
});

test('超过 10 条时淘汰最旧的一条，长度恒为 10', () => {
  const history = createHistory({ storage: createMemoryStorage() });
  const ids = [];
  for (let i = 0; i < 11; i += 1) {
    ids.push(history.add({ durationMs: 1000 + i, endedAt: BASE + i * 1000 }).id);
  }

  const list = history.list();
  assert.equal(list.length, 10);
  assert.equal(list[0].id, ids[10]);
  assert.equal(list.at(-1).id, ids[1]);
  assert.equal(list.some((item) => item.id === ids[0]), false);
});

test('id 在同一毫秒内也不会重复', () => {
  const history = createHistory({ storage: createMemoryStorage() });
  const a = history.add({ durationMs: 100, endedAt: BASE });
  const b = history.add({ durationMs: 200, endedAt: BASE });
  const c = history.add({ durationMs: 300, endedAt: BASE });
  const ids = new Set([a.id, b.id, c.id]);
  assert.equal(ids.size, 3);
});

test('durationMs 非法或为负时归零，但不影响记录写入', () => {
  const history = createHistory({ storage: createMemoryStorage() });
  assert.equal(history.add({ durationMs: -5, endedAt: BASE }).durationMs, 0);
  assert.equal(history.add({ durationMs: Number.NaN, endedAt: BASE }).durationMs, 0);
  assert.equal(history.list().length, 2);
});

test('missing endedAt 时用注入的时钟兜底', () => {
  const history = createHistory({ storage: createMemoryStorage(), now: () => BASE });
  assert.equal(history.add({ durationMs: 10 }).endedAt, BASE);
});

test('单条删除只影响目标记录', () => {
  const storage = createMemoryStorage();
  const history = createHistory({ storage });
  const a = history.add({ durationMs: 100, endedAt: BASE });
  const b = history.add({ durationMs: 200, endedAt: BASE + 1 });

  assert.equal(history.remove('不存在的 id'), false);
  assert.equal(history.remove(a.id), true);

  const list = history.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, b.id);
  assert.deepEqual(createHistory({ storage }).list(), list);
});

test('clear 清空并持久化', () => {
  const storage = createMemoryStorage();
  const history = createHistory({ storage });
  history.add({ durationMs: 100, endedAt: BASE });
  history.clear();
  assert.deepEqual(history.list(), []);
  assert.deepEqual(createHistory({ storage }).list(), []);
});

test('脏 JSON 视为空列表并清理存储', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{不是 JSON' });
  const history = createHistory({ storage });
  assert.deepEqual(history.list(), []);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('非数组 JSON 视为空列表', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{"a":1}' });
  assert.deepEqual(createHistory({ storage }).list(), []);
});

test('非法字段的条目被丢弃', () => {
  const raw = [
    entry('ok-1', 1000, BASE + 5000),
    null,
    'string',
    { id: '', durationMs: 1, endedAt: BASE },
    { id: 'bad-duration', durationMs: 'x', endedAt: BASE },
    { id: 'negative', durationMs: -1, endedAt: BASE },
    { id: 'bad-time', durationMs: 1, endedAt: 0 },
    { id: 'missing' },
    entry('ok-2', 2000, BASE + 9000),
  ];
  const result = sanitizeHistory(raw);
  assert.deepEqual(
    result.map((item) => item.id),
    ['ok-2', 'ok-1']
  );
});

test('外来数据按结束时刻倒序并截断到上限', () => {
  const raw = Array.from({ length: 13 }, (_, i) => entry(`id-${i}`, 100 * i, BASE + i * 1000));
  const result = sanitizeHistory(raw);
  assert.equal(result.length, 10);
  assert.equal(result[0].id, 'id-12');
  assert.equal(result.at(-1).id, 'id-3');

  for (let i = 1; i < result.length; i += 1) {
    assert.ok(result[i - 1].endedAt >= result[i].endedAt);
  }
});

test('重复 id 只保留第一条', () => {
  const result = sanitizeHistory([
    entry('dup', 100, BASE + 1000),
    entry('dup', 999, BASE + 2000),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].durationMs, 100);
});

test('写入失败不抛出，只回调一次', () => {
  const errors = [];
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const history = createHistory({ storage, onStorageError: (error) => errors.push(error) });

  assert.doesNotThrow(() => history.add({ durationMs: 100, endedAt: BASE }));
  assert.doesNotThrow(() => history.add({ durationMs: 200, endedAt: BASE + 1 }));
  assert.equal(history.list().length, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Quota/);
});

test('读取失败不抛出，列表视为空', () => {
  const errors = [];
  const storage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {},
    removeItem: () => {},
  };
  const history = createHistory({ storage, onStorageError: (error) => errors.push(error) });
  assert.deepEqual(history.list(), []);
  assert.equal(errors.length, 1);
});

test('reload 重新读取外部写入的数据', () => {
  const storage = createMemoryStorage();
  const history = createHistory({ storage });
  assert.equal(history.list().length, 0);

  storage.setItem(
    STORAGE_KEY,
    JSON.stringify([entry('external', 4200, BASE + 1000)])
  );
  assert.equal(history.list().length, 0);
  const afterReload = history.reload();
  assert.equal(afterReload.length, 1);
  assert.equal(afterReload[0].id, 'external');
});

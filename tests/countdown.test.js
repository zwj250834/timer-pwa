import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCountdowns,
  createMemoryStorage,
  DEFAULT_LIMIT,
  FIRED,
  MAX_DURATION_MS,
  MAX_LABEL_LENGTH,
  normalizeDuration,
  normalizeLabel,
  PAUSED,
  RUNNING,
  sanitizeCountdowns,
  STORAGE_KEY,
} from '../src/countdown.js';

const BASE = 1_700_000_000_000;
const MINUTE = 60_000;

function fakeClock(start = BASE) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
    jumpTo(value) {
      current = value;
    },
  };
}

function setup(options = {}) {
  const clock = fakeClock();
  const storage = createMemoryStorage();
  const countdowns = createCountdowns({ storage, now: clock.now, ...options });
  return { clock, storage, countdowns };
}

function byId(list, id) {
  return list.find((item) => item.id === id);
}

test('默认上限为 24 项', () => {
  assert.equal(DEFAULT_LIMIT, 24);
});

test('normalizeLabel: 折叠空白并截断到 60 字', () => {
  assert.equal(normalizeLabel('  关火  '), '关火');
  assert.equal(normalizeLabel('关火\n  顺便关窗'), '关火 顺便关窗');
  assert.equal(normalizeLabel(undefined), '');
  assert.equal(normalizeLabel('x'.repeat(80)).length, MAX_LABEL_LENGTH);
});

test('normalizeDuration: 非法时长归零，超长封顶', () => {
  assert.equal(normalizeDuration(0), 0);
  assert.equal(normalizeDuration(-1), 0);
  assert.equal(normalizeDuration(999), 0);
  assert.equal(normalizeDuration(Number.NaN), 0);
  assert.equal(normalizeDuration(1000), 1000);
  assert.equal(normalizeDuration(1500.9), 1500);
  assert.equal(normalizeDuration(MAX_DURATION_MS * 3), MAX_DURATION_MS);
});

test('add: 新建项立刻进入倒计时并按剩余时间排序', () => {
  const { clock, countdowns } = setup();
  const long = countdowns.add({ label: '炖汤', durationMs: 30 * MINUTE });
  clock.advance(1000);
  const short = countdowns.add({ label: '关火', durationMs: 5 * MINUTE });

  const list = countdowns.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, short.id);
  assert.equal(list[1].id, long.id);
  assert.equal(byId(list, short.id).remainingMs, 5 * MINUTE);
  assert.equal(byId(list, short.id).state, RUNNING);
  assert.equal(byId(list, short.id).label, '关火');
  assert.equal(byId(list, short.id).endsAt, clock.now() + 5 * MINUTE);
});

test('add: 事项为空也接受，时长非法或队列已满则拒绝', () => {
  const { countdowns } = setup({ limit: 2 });
  assert.ok(countdowns.add({ label: '', durationMs: MINUTE }));
  assert.ok(countdowns.add({ label: '第二项', durationMs: MINUTE }));
  assert.equal(countdowns.add({ label: '第三项', durationMs: MINUTE }), null);
  assert.equal(countdowns.add({ label: '太短', durationMs: 200 }), null);
  assert.equal(countdowns.list().length, 2);
});

test('多条倒计时同时进行，各自按墙钟推算', () => {
  const { clock, countdowns } = setup();
  const a = countdowns.add({ label: '关火', durationMs: 5 * MINUTE });
  clock.advance(MINUTE);
  const b = countdowns.add({ label: '吃药', durationMs: 10 * MINUTE });

  clock.advance(2 * MINUTE);
  const list = countdowns.list();
  assert.equal(byId(list, a.id).remainingMs, 2 * MINUTE);
  assert.equal(byId(list, b.id).remainingMs, 8 * MINUTE);

  clock.advance(2 * MINUTE);
  assert.equal(byId(countdowns.list(), a.id).remainingMs, 0);
});

test('pause 冻结剩余时间，resume 后接着倒数', () => {
  const { clock, countdowns } = setup();
  const item = countdowns.add({ label: '关火', durationMs: 5 * MINUTE });
  clock.advance(2 * MINUTE);

  assert.equal(countdowns.pause(item.id), true);
  assert.equal(byId(countdowns.list(), item.id).state, PAUSED);
  assert.equal(byId(countdowns.list(), item.id).remainingMs, 3 * MINUTE);

  clock.advance(10 * MINUTE); // 暂停期间的空档不计入
  assert.equal(byId(countdowns.list(), item.id).remainingMs, 3 * MINUTE);

  assert.equal(countdowns.resume(item.id), true);
  assert.equal(byId(countdowns.list(), item.id).state, RUNNING);
  clock.advance(MINUTE);
  assert.equal(byId(countdowns.list(), item.id).remainingMs, 2 * MINUTE);
});

test('toggle 在运行与暂停之间切换，已响铃的项不再切换', () => {
  const { clock, countdowns } = setup();
  const item = countdowns.add({ label: '关火', durationMs: MINUTE });

  assert.equal(countdowns.toggle(item.id), PAUSED);
  assert.equal(countdowns.toggle(item.id), RUNNING);

  clock.advance(MINUTE);
  countdowns.sync();
  assert.equal(countdowns.toggle(item.id), null);
  assert.equal(byId(countdowns.list(), item.id).state, FIRED);
});

test('sync 结算到期的项，并且只返回一次', () => {
  const { clock, countdowns } = setup();
  const item = countdowns.add({ label: '关火', durationMs: 2 * MINUTE });

  clock.advance(2 * MINUTE - 1);
  assert.deepEqual(countdowns.sync(), []);

  clock.advance(1);
  const fired = countdowns.sync();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].id, item.id);
  assert.equal(fired[0].missed, false);
  assert.equal(fired[0].firedAt, BASE + 2 * MINUTE);
  assert.equal(byId(countdowns.list(), item.id).state, FIRED);

  clock.advance(5 * MINUTE);
  assert.deepEqual(countdowns.sync(), []);
});

test('过期太久（超过 1 小时）的项标记为 missed，只提示不响铃', () => {
  const { clock, countdowns } = setup();
  countdowns.add({ label: '关火', durationMs: MINUTE });

  clock.advance(3 * 60 * MINUTE);
  const fired = countdowns.sync();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].missed, true);
});

test('missedAfterMs 可调，用于放宽或收紧「错过」的判断', () => {
  const { clock, countdowns } = setup({ missedAfterMs: 1000 });
  countdowns.add({ label: '关火', durationMs: MINUTE });
  clock.advance(MINUTE + 1001);
  assert.equal(countdowns.sync()[0].missed, true);
});

test('已响铃的项排在运行中的项后面，并且各自保留原定时刻', () => {
  const { clock, countdowns } = setup();
  const first = countdowns.add({ label: '关火', durationMs: MINUTE });
  countdowns.add({ label: '炖汤', durationMs: 30 * MINUTE });

  clock.advance(MINUTE);
  countdowns.sync();

  const list = countdowns.list();
  assert.equal(list.at(-1).id, first.id);
  assert.equal(list.at(-1).firedAt, BASE + MINUTE);
});

test('sync 之前的系统时间回拨不会产生负剩余', () => {
  const { clock, countdowns } = setup();
  const item = countdowns.add({ label: '关火', durationMs: 5 * MINUTE });
  clock.advance(MINUTE);
  clock.jumpTo(clock.now() - 10 * MINUTE);
  assert.ok(byId(countdowns.list(), item.id).remainingMs >= 0);
});

test('repeat 用同样的事项和时长再排一项', () => {
  const { clock, countdowns } = setup();
  const item = countdowns.add({ label: '泡茶', durationMs: 5 * MINUTE });
  clock.advance(5 * MINUTE);
  countdowns.sync();

  const again = countdowns.repeat(item.id);
  assert.notEqual(again.id, item.id);
  assert.equal(again.label, '泡茶');
  assert.equal(again.durationMs, 5 * MINUTE);
  assert.equal(again.state, RUNNING);
  assert.equal(again.remainingMs, 5 * MINUTE);
});

test('remove 与 clear 只影响目标项并写入存储', () => {
  const { storage, countdowns } = setup();
  const a = countdowns.add({ label: 'A', durationMs: MINUTE });
  const b = countdowns.add({ label: 'B', durationMs: MINUTE });

  assert.equal(countdowns.remove('不存在'), false);
  assert.equal(countdowns.remove(a.id), true);
  assert.deepEqual(
    countdowns.list().map((item) => item.id),
    [b.id]
  );
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).length, 1);

  countdowns.clear();
  assert.deepEqual(countdowns.list(), []);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), []);
});

test('clearFired 只清掉已经响过的项', () => {
  const { clock, countdowns } = setup();
  const a = countdowns.add({ label: 'A', durationMs: MINUTE });
  const b = countdowns.add({ label: 'B', durationMs: 10 * MINUTE });

  clock.advance(MINUTE);
  countdowns.sync();

  assert.equal(countdowns.clearFired(), true);
  assert.deepEqual(
    countdowns.list().map((item) => item.id),
    [b.id]
  );
  assert.equal(countdowns.clearFired(), false);
});

test('activeCount 只统计还没响的项', () => {
  const { clock, countdowns } = setup();
  countdowns.add({ label: 'A', durationMs: MINUTE });
  countdowns.add({ label: 'B', durationMs: 10 * MINUTE });
  assert.equal(countdowns.activeCount, 2);
  clock.advance(MINUTE);
  countdowns.sync();
  assert.equal(countdowns.activeCount, 1);
});

test('重启后仍在倒计时：离线期间到点的会在下一次 sync 结算', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage();
  const first = createCountdowns({ storage, now: clock.now });
  const item = first.add({ label: '关火', durationMs: 5 * MINUTE });

  clock.advance(6 * MINUTE);
  const second = createCountdowns({ storage, now: clock.now });
  const restored = byId(second.list(), item.id);
  assert.equal(restored.label, '关火');
  assert.equal(restored.state, RUNNING);

  const fired = second.sync();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].id, item.id);
  assert.equal(fired[0].missed, false);
});

test('重启后暂停中的项保持暂停，剩余时间不变', () => {
  const clock = fakeClock();
  const storage = createMemoryStorage();
  const first = createCountdowns({ storage, now: clock.now });
  const item = first.add({ label: '关火', durationMs: 5 * MINUTE });
  clock.advance(2 * MINUTE);
  first.pause(item.id);

  clock.advance(30 * MINUTE);
  const second = createCountdowns({ storage, now: clock.now });
  const restored = byId(second.list(), item.id);
  assert.equal(restored.state, PAUSED);
  assert.equal(restored.remainingMs, 3 * MINUTE);

  second.resume(item.id);
  assert.equal(byId(second.list(), item.id).remainingMs, 3 * MINUTE);
});

test('脏 JSON 视为空列表并清理存储', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{不是 JSON' });
  const countdowns = createCountdowns({ storage });
  assert.deepEqual(countdowns.list(), []);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('非数组 JSON 视为空列表', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{"a":1}' });
  assert.deepEqual(createCountdowns({ storage }).list(), []);
});

test('非法条目被丢弃，合法条目保留', () => {
  const raw = [
    { id: 'ok', label: '关火', durationMs: MINUTE, state: RUNNING, endsAt: BASE + MINUTE },
    null,
    'string',
    { id: '', label: 'x', durationMs: MINUTE, state: RUNNING, endsAt: BASE + MINUTE },
    { id: 'bad-state', label: 'x', durationMs: MINUTE, state: 'sleeping', endsAt: BASE },
    { id: 'bad-duration', label: 'x', durationMs: 10, state: RUNNING, endsAt: BASE + 10 },
    { id: 'no-ends-at', label: 'x', durationMs: MINUTE, state: RUNNING },
    { id: 'paused-ok', label: '泡茶', durationMs: MINUTE, state: PAUSED, remainingMs: 30_000 },
    { id: 'paused-bad', label: 'x', durationMs: MINUTE, state: PAUSED, remainingMs: 0 },
    { id: 'fired-ok', label: '吃药', durationMs: MINUTE, state: FIRED, firedAt: BASE },
    { id: 'fired-bad', label: 'x', durationMs: MINUTE, state: FIRED },
  ];

  const result = sanitizeCountdowns(raw);
  assert.deepEqual(
    result.map((item) => item.id),
    ['ok', 'paused-ok', 'fired-ok']
  );
  assert.equal(result[0].endsAt, BASE + MINUTE);
  assert.equal(result[1].remainingMs, 30_000);
  assert.equal(result[2].endsAt, 0, '已响铃的项不再保留 endsAt');
});

test('重复 id 只保留第一条，超出上限截断', () => {
  const duplicated = sanitizeCountdowns([
    { id: 'dup', label: '第一条', durationMs: MINUTE, state: RUNNING, endsAt: BASE + 1000 },
    { id: 'dup', label: '第二条', durationMs: MINUTE, state: RUNNING, endsAt: BASE + 2000 },
  ]);
  assert.equal(duplicated.length, 1);
  assert.equal(duplicated[0].label, '第一条');

  const many = Array.from({ length: 30 }, (_, index) => ({
    id: `id-${index}`,
    label: `第 ${index} 项`,
    durationMs: MINUTE,
    state: RUNNING,
    endsAt: BASE + index * 1000,
  }));
  assert.equal(sanitizeCountdowns(many).length, DEFAULT_LIMIT);
});

test('sanitizeCountdowns: 已响铃的项排在最后', () => {
  const sorted = sanitizeCountdowns([
    { id: 'fired', label: '早响的', durationMs: MINUTE, state: FIRED, firedAt: BASE },
    { id: 'later', label: '晚点的', durationMs: MINUTE, state: RUNNING, endsAt: BASE + 60_000 },
    { id: 'sooner', label: '早点的', durationMs: MINUTE, state: RUNNING, endsAt: BASE + 30_000 },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['sooner', 'later', 'fired']
  );
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
  const countdowns = createCountdowns({
    storage,
    now: () => BASE,
    onStorageError: (error) => errors.push(error),
  });

  assert.doesNotThrow(() => countdowns.add({ label: '关火', durationMs: MINUTE }));
  assert.doesNotThrow(() => countdowns.add({ label: '吃药', durationMs: MINUTE }));
  assert.equal(countdowns.list().length, 2);
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
  const countdowns = createCountdowns({ storage, onStorageError: (error) => errors.push(error) });
  assert.deepEqual(countdowns.list(), []);
  assert.equal(errors.length, 1);
});

test('reload 重新读取外部写入的数据', () => {
  const storage = createMemoryStorage();
  const countdowns = createCountdowns({ storage });
  assert.equal(countdowns.list().length, 0);

  storage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      { id: 'external', label: '外部写入', durationMs: MINUTE, state: RUNNING, endsAt: BASE + 5000 },
    ])
  );
  assert.equal(countdowns.list().length, 0);
  assert.equal(countdowns.reload().length, 1);
  assert.equal(countdowns.list()[0].label, '外部写入');
});

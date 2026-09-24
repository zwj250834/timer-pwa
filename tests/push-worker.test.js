import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  Reminders,
  buildPushPayload,
  MAX_REMINDERS_PER_SUBSCRIPTION,
  normalizeReminder,
  normalizeSubscription,
} from '../worker/src/index.js';

const NOW = 1_700_000_000_000;
const P256DH =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: P256DH, auth: AUTH },
};

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    alarm: null,
    async get(key) {
      return map.get(key);
    },
    async put(key, value) {
      map.set(key, value);
    },
    async setAlarm(time) {
      this.alarm = time;
    },
    async deleteAlarm() {
      this.alarm = null;
    },
    snapshot(key = 'state') {
      return map.get(key);
    },
  };
}

function createDo({ now = () => NOW, fetchImpl } = {}) {
  const storage = fakeStorage();
  const reminders = new Reminders({ storage }, { now, fetchImpl });
  return { reminders, storage };
}

async function post(reminders, path, body) {
  const response = await reminders.fetch(
    new Request(`https://do${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  return { status: response.status, body: await response.json() };
}

test('normalizeSubscription: 只接受结构正确的订阅', () => {
  assert.deepEqual(normalizeSubscription(SUBSCRIPTION), SUBSCRIPTION);
  assert.equal(normalizeSubscription(null), null);
  assert.equal(normalizeSubscription({ endpoint: 'http://insecure', keys: {} }), null);
  assert.equal(normalizeSubscription({ endpoint: 'https://a', keys: { p256dh: 'short', auth: AUTH } }), null);
  assert.equal(
    normalizeSubscription({ endpoint: 'https://a', keys: { p256dh: P256DH, auth: 'tooshort' } }),
    null
  );
});

test('normalizeReminder: 校验 id、时刻范围与事项长度', () => {
  assert.deepEqual(normalizeReminder({ id: 'a1', at: NOW + 1000, label: ' 关火 ' }, NOW), {
    id: 'a1',
    at: NOW + 1000,
    label: '关火',
  });
  assert.equal(normalizeReminder({ id: '', at: NOW + 1000 }, NOW), null);
  assert.equal(normalizeReminder({ id: 'a', at: Number.NaN }, NOW), null);
  assert.equal(normalizeReminder({ id: 'a', at: NOW - 10 * 60 * 1000 }, NOW), null, '太早的过去时间');
  assert.equal(normalizeReminder({ id: 'a', at: NOW + 30 * 60 * 60 * 1000 }, NOW), null, '超过 25 小时');
  assert.equal(
    normalizeReminder({ id: 'a', at: NOW + 1000, label: 'x'.repeat(100) }, NOW).label.length,
    60
  );
});

test('buildPushPayload: 通知的标题带事项，正文带当前时间', () => {
  const payload = JSON.parse(buildPushPayload({ id: 'a1', label: '关火', at: NOW }, NOW));
  assert.equal(payload.title, '时间到：关火');
  assert.match(payload.body, /\d{2}:\d{2}/);
  assert.equal(payload.tag, 'countdown-a1');
});

test('GET /config 会生成并复用一对 VAPID 密钥', async () => {
  const { reminders, storage } = createDo();
  const first = await (await reminders.fetch(new Request('https://do/config'))).json();
  const second = await (await reminders.fetch(new Request('https://do/config'))).json();

  assert.equal(first.ok, true);
  assert.equal(typeof first.publicKey, 'string');
  assert.ok(first.publicKey.length > 60);
  assert.equal(first.publicKey, second.publicKey, '第二次不再重新生成');
  assert.equal(storage.snapshot().vapid.publicKey, first.publicKey);
});

test('POST /schedule 存下提醒并排好 alarm', async () => {
  const { reminders, storage } = createDo();
  const later = await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'later', at: NOW + 120_000, label: '炖汤' },
  });
  assert.equal(later.status, 200);
  assert.equal(storage.alarm, NOW + 120_000);

  const sooner = await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'sooner', at: NOW + 60_000, label: '关火' },
  });
  assert.equal(sooner.status, 200);
  assert.equal(storage.alarm, NOW + 60_000, 'alarm 应该改到更早的那条');

  const state = storage.snapshot();
  assert.equal(Object.keys(state.reminders).length, 2);
  assert.equal(state.reminders.sooner.label, '关火');
});

test('POST /schedule 拒绝不合法输入与超限的提醒', async () => {
  const { reminders } = createDo();
  assert.equal((await post(reminders, '/schedule', { subscription: null })).status, 400);
  assert.equal(
    (await post(reminders, '/schedule', { subscription: SUBSCRIPTION, reminder: { id: 'x', at: 1 } }))
      .status,
    400
  );

  for (let i = 0; i < MAX_REMINDERS_PER_SUBSCRIPTION; i += 1) {
    await post(reminders, '/schedule', {
      subscription: SUBSCRIPTION,
      reminder: { id: `id-${i}`, at: NOW + 60_000 + i, label: 'x' },
    });
  }
  const overflow = await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'overflow', at: NOW + 60_000, label: 'x' },
  });
  assert.equal(overflow.status, 429);
});

test('POST /cancel 只删指定的一条', async () => {
  const { reminders, storage } = createDo();
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'a', at: NOW + 60_000, label: 'A' },
  });
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'b', at: NOW + 120_000, label: 'B' },
  });

  const result = await post(reminders, '/cancel', { id: 'a' });
  assert.equal(result.body.ok, true);
  assert.deepEqual(Object.keys(storage.snapshot().reminders), ['b']);
  assert.equal(storage.alarm, NOW + 120_000);

  assert.equal((await post(reminders, '/cancel', {})).status, 400);
});

test('POST /cancel-all 连订阅一起清掉', async () => {
  const { reminders, storage } = createDo();
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'a', at: NOW + 60_000, label: 'A' },
  });
  const result = await post(reminders, '/cancel-all', { endpoint: SUBSCRIPTION.endpoint });

  assert.equal(result.body.removed, 1);
  assert.deepEqual(storage.snapshot().reminders, {});
  assert.deepEqual(storage.snapshot().subscriptions, {});
  assert.equal(storage.alarm, null);
});

test('alarm 到期后发推送、删掉提醒、排下一次', async () => {
  const calls = [];
  let clock = NOW;
  const { reminders, storage } = createDo({
    now: () => clock,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 201, ok: true };
    },
  });

  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'reminder-1', at: NOW + 60_000, label: '关火' },
  });
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'reminder-2', at: NOW + 300_000, label: '吃药' },
  });

  clock = NOW + 60_000;
  await reminders.alarm();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SUBSCRIPTION.endpoint);
  assert.equal(calls[0].init.headers.urgency, 'high');
  assert.equal(calls[0].init.headers['content-encoding'], 'aes128gcm');
  assert.match(calls[0].init.headers.authorization, /^vapid t=/);

  const state = storage.snapshot();
  assert.deepEqual(Object.keys(state.reminders), ['reminder-2']);
  assert.equal(storage.alarm, NOW + 300_000, '下一次 alarm 指向剩下的那条');
});

test('推送服务返回 410 时，订阅和它的提醒一起清掉', async () => {
  let clock = NOW;
  const { reminders, storage } = createDo({
    now: () => clock,
    fetchImpl: async () => ({ status: 410, ok: false }),
  });
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'a', at: NOW + 1000, label: 'A' },
  });
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'b', at: NOW + 60_000, label: 'B' },
  });

  clock = NOW + 1000;
  await reminders.alarm();

  assert.deepEqual(storage.snapshot().subscriptions, {});
  assert.deepEqual(storage.snapshot().reminders, {}, '同一订阅的其它提醒也一并清掉');
});

test('POST /sweep 是幂等的兜底扫描', async () => {
  let clock = NOW;
  const calls = [];
  const { reminders } = createDo({
    now: () => clock,
    fetchImpl: async () => {
      calls.push(1);
      return { status: 201, ok: true };
    },
  });
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'a', at: NOW + 1000, label: 'A' },
  });

  clock = NOW + 2000;
  assert.deepEqual((await post(reminders, '/sweep', {})).body.sent, 1);
  assert.deepEqual((await post(reminders, '/sweep', {})).body.sent, 0, '第二次没有可发的了');
  assert.equal(calls.length, 1);
});

test('POST /test 立即发一条测试提醒', async () => {
  const calls = [];
  const { reminders, storage } = createDo({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 201, ok: true };
    },
  });

  const result = await post(reminders, '/test', { subscription: SUBSCRIPTION });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(Object.keys(storage.snapshot().subscriptions).length, 1, '测试时也会记下订阅');
});

test('过期很久的提醒不会补发，也不会留在存储里', async () => {
  let clock = NOW;
  const calls = [];
  const { reminders, storage } = createDo({
    now: () => clock,
    fetchImpl: async () => {
      calls.push(1);
      return { status: 201, ok: true };
    },
  });
  await post(reminders, '/schedule', {
    subscription: SUBSCRIPTION,
    reminder: { id: 'a', at: NOW + 1000, label: 'A' },
  });

  clock = NOW + 1000 + 7 * 60 * 60 * 1000;
  const stats = (await post(reminders, '/sweep', {})).body;
  assert.equal(stats.sent, 0);
  assert.equal(calls.length, 0, '迟到太多的推送干脆不发');
  assert.deepEqual(storage.snapshot().reminders, {}, '清扫时把过期项删掉');
});

test('Worker 入口：CORS 只放行自己的站点与本地开发', async () => {
  const env = {
    REMINDERS: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) }),
    },
  };

  const allowed = await worker.fetch(
    new Request('https://timer-push.example.workers.dev/config', {
      headers: { origin: 'https://zwj250834.github.io' },
    }),
    env
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://zwj250834.github.io');
  assert.equal((await allowed.json()).ok, true);

  const dev = await worker.fetch(
    new Request('https://timer-push.example.workers.dev/config', {
      headers: { origin: 'http://localhost:8080' },
    }),
    env
  );
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:8080');

  const blocked = await worker.fetch(
    new Request('https://timer-push.example.workers.dev/config', {
      headers: { origin: 'https://evil.example.com' },
    }),
    env
  );
  assert.equal(blocked.status, 403);
});

test('Worker 入口：OPTIONS 预检与根路径说明', async () => {
  const env = {
    REMINDERS: { idFromName: (name) => name, get: () => ({ fetch: async () => new Response('{}') }) },
  };
  const preflight = await worker.fetch(
    new Request('https://timer-push.example.workers.dev/schedule', {
      method: 'OPTIONS',
      headers: { origin: 'https://zwj250834.github.io' },
    }),
    env
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');

  const root = await worker.fetch(new Request('https://timer-push.example.workers.dev/'), env);
  const body = await root.json();
  assert.equal(body.service, 'timer-push');
  assert.ok(body.routes.includes('POST /schedule'));
});

test('Worker 入口：cron 兜底会去调 DO', async () => {
  const seen = [];
  const env = {
    REMINDERS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (input) => {
          seen.push(String(input));
          return new Response('{}');
        },
      }),
    },
  };
  await worker.scheduled({}, env, { waitUntil: (task) => seen.push(task) });
  assert.equal(seen[0], 'https://do/sweep');
});

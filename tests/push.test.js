import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduleBody,
  createPushClient,
  normalizeWorkerUrl,
  PUSH_KEY,
} from '../src/push.js';

const PUBLIC_KEY =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    raw: map,
  };
}

function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => true,
  };
}

function fakeRegistration(subscription = null) {
  return {
    pushManager: {
      subscribe: async () => subscription ?? fakeSubscription(),
      getSubscription: async () => subscription,
    },
  };
}

const granted = async () => 'granted';

test('normalizeWorkerUrl: 补全协议、去尾斜杠、挡住不合法地址', () => {
  assert.equal(normalizeWorkerUrl('timer-push.abc.workers.dev'), 'https://timer-push.abc.workers.dev');
  assert.equal(normalizeWorkerUrl('  https://x.workers.dev/  '), 'https://x.workers.dev');
  assert.equal(normalizeWorkerUrl('https://x.workers.dev/api/'), 'https://x.workers.dev/api');
  assert.equal(normalizeWorkerUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeWorkerUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(normalizeWorkerUrl('http://x.workers.dev'), '', '远端只能用 https');
  assert.equal(normalizeWorkerUrl('   '), '');
  assert.equal(normalizeWorkerUrl('http://['), '');
});

test('buildScheduleBody: 只带服务端需要的字段', () => {
  const body = buildScheduleBody(
    { endpoint: 'https://push', keys: { p256dh: 'p', auth: 'a' } },
    { id: 'abc', at: 1_700_000_000_123.7, label: '关火', extra: '忽略' }
  );
  assert.deepEqual(body.reminder, { id: 'abc', at: 1_700_000_000_123, label: '关火' });
  assert.equal(body.subscription.endpoint, 'https://push');
});

test('enable: 顺利时拿公钥 → 订阅 → 存配置', async () => {
  const storage = memoryStorage();
  const calls = [];
  const client = createPushClient({
    storage,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, publicKey: PUBLIC_KEY }) };
    },
    getRegistration: async () => fakeRegistration(),
    requestPermission: granted,
  });

  const result = await client.enable('timer-push.abc.workers.dev');
  assert.deepEqual(result, { ok: true, url: 'https://timer-push.abc.workers.dev' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://timer-push.abc.workers.dev/config');
  assert.equal(calls[0].init.method, 'GET');
  assert.deepEqual(client.config(), { url: 'https://timer-push.abc.workers.dev', enabled: true });
  assert.equal(storage.getItem(PUSH_KEY).includes('enabled'), true);
});

test('enable: 地址不合法 / 通知被拒 / 连不上，都给出可读的原因', async () => {
  const storage = memoryStorage();
  const base = {
    storage,
    getRegistration: async () => fakeRegistration(),
  };

  const badUrl = createPushClient({ ...base, requestPermission: granted });
  assert.match((await badUrl.enable('ftp://nope')).error, /地址/);

  const okKey = {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ publicKey: PUBLIC_KEY }) }),
  };

  const denied = createPushClient({
    ...base,
    ...okKey,
    requestPermission: async () => 'denied',
  });
  assert.match((await denied.enable('x.workers.dev')).error, /通知权限/);

  const noNotify = createPushClient({
    ...base,
    ...okKey,
    requestPermission: async () => 'unsupported',
  });
  assert.match((await noNotify.enable('x.workers.dev')).error, /不支持通知/);

  // 地址不可达时不该弹权限框：requestPermission 根本不会被调用
  let asked = 0;
  const unreachable = createPushClient({
    ...base,
    requestPermission: async () => {
      asked += 1;
      return 'granted';
    },
    fetchImpl: async () => {
      throw new Error('network');
    },
  });
  assert.match((await unreachable.enable('x.workers.dev')).error, /连不上/);
  assert.equal(asked, 0, '先确认地址可用，再去要权限');

  const offline = createPushClient({
    ...base,
    requestPermission: granted,
    fetchImpl: async () => {
      throw new Error('network');
    },
  });
  assert.match((await offline.enable('x.workers.dev')).error, /连不上/);

  const noKey = createPushClient({
    ...base,
    requestPermission: granted,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  assert.match((await noKey.enable('x.workers.dev')).error, /公钥/);

  assert.equal(client_enabled(storage), false, '失败时不应该写入已开启');
});

function client_enabled(storage) {
  const raw = storage.getItem(PUSH_KEY);
  return raw ? JSON.parse(raw).enabled === true : false;
}

test('schedule: 把订阅和提醒一起发给服务端', async () => {
  const storage = memoryStorage({
    [PUSH_KEY]: JSON.stringify({ url: 'https://push.workers.dev', enabled: true }),
  });
  const calls = [];
  const client = createPushClient({
    storage,
    getRegistration: async () => fakeRegistration(fakeSubscription()),
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });

  const result = await client.schedule({ id: 'cd-1', at: 1_700_000_060_000, label: '关火' });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://push.workers.dev/schedule');
  assert.equal(calls[0].body.reminder.id, 'cd-1');
  assert.equal(calls[0].body.reminder.label, '关火');
  assert.equal(calls[0].body.subscription.endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
});

test('schedule/cancel: 没开启时直接跳过，不打扰用户', async () => {
  let called = 0;
  const client = createPushClient({
    storage: memoryStorage(),
    fetchImpl: async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.deepEqual(await client.schedule({ id: 'a', at: 1, label: 'x' }), {
    ok: false,
    skipped: true,
  });
  assert.deepEqual(await client.cancel('a'), { ok: false, skipped: true });
  assert.equal(called, 0);
});

test('cancel: 回传 id，服务端报错时把原因带回来', async () => {
  const storage = memoryStorage({
    [PUSH_KEY]: JSON.stringify({ url: 'https://push.workers.dev', enabled: true }),
  });
  const calls = [];
  const okClient = createPushClient({
    storage,
    getRegistration: async () => fakeRegistration(fakeSubscription()),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  assert.equal((await okClient.cancel('cd-9')).ok, true);
  assert.equal(calls[0].url, 'https://push.workers.dev/cancel');
  assert.deepEqual(calls[0].body, { id: 'cd-9' });

  const failing = createPushClient({
    storage,
    getRegistration: async () => fakeRegistration(fakeSubscription()),
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  assert.match((await failing.cancel('cd-9')).error, /500/);
});

test('test: 用当前订阅发一条测试提醒', async () => {
  const storage = memoryStorage({
    [PUSH_KEY]: JSON.stringify({ url: 'https://push.workers.dev', enabled: true }),
  });
  const calls = [];
  const client = createPushClient({
    storage,
    getRegistration: async () => fakeRegistration(fakeSubscription()),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, status: 201 }) };
    },
  });

  assert.equal((await client.test()).ok, true);
  assert.equal(calls[0].url, 'https://push.workers.dev/test');
  assert.ok(calls[0].body.subscription.endpoint);
});

test('disable: 通知服务端清掉订阅，并退订本地订阅', async () => {
  const storage = memoryStorage({
    [PUSH_KEY]: JSON.stringify({ url: 'https://push.workers.dev', enabled: true }),
  });
  const subscription = fakeSubscription();
  let unsubscribed = 0;
  subscription.unsubscribe = async () => {
    unsubscribed += 1;
    return true;
  };
  const calls = [];
  const client = createPushClient({
    storage,
    getRegistration: async () => fakeRegistration(subscription),
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, removed: 2 }) };
    },
  });

  await client.disable();
  assert.equal(calls[0].url, 'https://push.workers.dev/cancel-all');
  assert.equal(calls[0].body.endpoint, subscription.endpoint);
  assert.equal(unsubscribed, 1);
  assert.deepEqual(client.config(), { url: 'https://push.workers.dev', enabled: false });
});

test('disable: 服务端不可达也要能关掉本地开关', async () => {
  const storage = memoryStorage({
    [PUSH_KEY]: JSON.stringify({ url: 'https://push.workers.dev', enabled: true }),
  });
  const client = createPushClient({
    storage,
    getRegistration: async () => fakeRegistration(fakeSubscription()),
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal((await client.disable()).ok, true);
  assert.equal(client.config().enabled, false);
});

test('配置损坏时按未开启处理', () => {
  const storage = memoryStorage({ [PUSH_KEY]: '{坏掉的 JSON' });
  const client = createPushClient({ storage });
  assert.deepEqual(client.config(), { url: '', enabled: false });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeSystemNotifications,
  createSiren,
  createVibrator,
  requestNotificationPermission,
  scheduleSystemTrigger,
  showSystemNotification,
  VIBRATE_PATTERN,
} from '../src/alarm.js';

function fakeAudioContext({ state = 'running' } = {}) {
  const context = {
    state,
    currentTime: 0,
    destination: { name: 'destination' },
    oscillators: [],
    resumes: 0,
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: { setValueAtTime() {} },
        connect: (node) => node,
        start(at) {
          osc.startedAt = at;
        },
        stop(at) {
          osc.stoppedAt = at;
        },
      };
      context.oscillators.push(osc);
      return osc;
    },
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect: (node) => node,
      };
    },
    resume() {
      context.resumes += 1;
      context.state = 'running';
      return Promise.resolve();
    },
  };
  return context;
}

function fakeTimers() {
  const timers = new Map();
  let seq = 0;
  return {
    setInterval(fn, ms) {
      seq += 1;
      timers.set(seq, { fn, ms });
      return seq;
    },
    clearInterval(handle) {
      timers.delete(handle);
    },
    count: () => timers.size,
    fireAll() {
      for (const { fn } of [...timers.values()]) fn();
    },
  };
}

test('siren: start 播放一个脉冲，重复调用不会叠加', () => {
  const context = fakeAudioContext();
  const timers = fakeTimers();
  const siren = createSiren({ createContext: () => context, ...timers });

  assert.equal(siren.start(), true);
  assert.equal(siren.playing, true);
  assert.equal(context.oscillators.length, 4);
  assert.equal(timers.count(), 1);

  assert.equal(siren.start(), false);
  assert.equal(context.oscillators.length, 4);
});

test('siren: 循环触发脉冲，stop 之后不再出声', () => {
  const context = fakeAudioContext();
  const timers = fakeTimers();
  const siren = createSiren({ createContext: () => context, ...timers });

  siren.start();
  timers.fireAll();
  assert.equal(context.oscillators.length, 8);

  assert.equal(siren.stop(), true);
  assert.equal(siren.playing, false);
  assert.equal(timers.count(), 0);
  assert.equal(siren.stop(), false);
  assert.equal(context.oscillators.length, 8);
});

test('siren: 没有 AudioContext 时 start 安全失败', () => {
  const siren = createSiren({ createContext: () => null, ...fakeTimers() });
  assert.equal(siren.start(), false);
  assert.equal(siren.playing, false);
});

test('siren: unlock 唤醒通道并只放一次听不见的脉冲', () => {
  const context = fakeAudioContext({ state: 'suspended' });
  const siren = createSiren({ createContext: () => context, ...fakeTimers() });

  assert.equal(siren.unlock(), true);
  assert.equal(context.resumes, 1);
  assert.equal(context.oscillators.length, 4);
  assert.equal(siren.playing, false, 'unlock 不应进入响铃状态');

  siren.unlock();
  assert.equal(context.oscillators.length, 4);
});

test('vibrator: 按节奏震动，stop 时归零', () => {
  const calls = [];
  const timers = fakeTimers();
  const vibrator = createVibrator({ vibrate: (pattern) => calls.push(pattern), ...timers });

  assert.equal(vibrator.start(), true);
  assert.deepEqual(calls, [VIBRATE_PATTERN]);
  assert.equal(timers.count(), 1);
  assert.equal(vibrator.start(), false);

  timers.fireAll();
  assert.equal(calls.length, 2);

  assert.equal(vibrator.stop(), true);
  assert.equal(calls.at(-1), 0);
  assert.equal(timers.count(), 0);
  assert.equal(vibrator.stop(), false);
});

test('showSystemNotification: 优先用 Service Worker 注册对象', async () => {
  const shown = [];
  const result = await showSystemNotification({
    title: '时间到：关火',
    body: '设定了 5 分钟',
    tag: 'countdown-1',
    registration: {
      showNotification: (title, options) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    NotificationCtor: class {
      static permission = 'granted';
      constructor() {
        throw new Error('不应该走到页面通知');
      }
    },
  });

  assert.equal(result, 'service-worker');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, '时间到：关火');
  assert.equal(shown[0].options.tag, 'countdown-1');
  assert.equal(shown[0].options.requireInteraction, true);
  assert.deepEqual(shown[0].options.vibrate, VIBRATE_PATTERN);
});

test('showSystemNotification: 没有 Service Worker 时退回页面通知', async () => {
  const created = [];
  class FakeNotification {
    static permission = 'granted';
    constructor(title, options) {
      created.push({ title, options });
    }
  }

  const result = await showSystemNotification({
    title: '时间到',
    body: '吃药',
    tag: 'countdown-2',
    NotificationCtor: FakeNotification,
  });

  assert.equal(result, 'window');
  assert.equal(created.length, 1);
  assert.equal(created[0].options.body, '吃药');
});

test('showSystemNotification: 权限不足或构造失败时返回 unsupported', async () => {
  class Denied {
    static permission = 'denied';
    constructor() {
      throw new Error('不应该被构造');
    }
  }
  assert.equal(await showSystemNotification({ title: 'x', NotificationCtor: Denied }), 'unsupported');
  assert.equal(await showSystemNotification({ title: 'x', NotificationCtor: undefined }), 'unsupported');
  assert.equal(
    await showSystemNotification({ title: 'x', NotificationCtor: class {} , registration: { showNotification() { throw new Error('boom'); } } }),
    'unsupported'
  );
});

test('requestNotificationPermission: 已授权直接返回，未支持返回 unsupported', async () => {
  assert.equal(await requestNotificationPermission({ NotificationCtor: undefined }), 'unsupported');
  assert.equal(
    await requestNotificationPermission({
      NotificationCtor: class {
        static permission = 'granted';
      },
    }),
    'granted'
  );

  let asked = 0;
  const result = await requestNotificationPermission({
    NotificationCtor: class {
      static permission = 'default';
      static requestPermission() {
        asked += 1;
        return Promise.resolve('denied');
      }
    },
  });
  assert.equal(result, 'denied');
  assert.equal(asked, 1);
});

test('requestNotificationPermission: 抛错时返回 unsupported', async () => {
  const result = await requestNotificationPermission({
    NotificationCtor: class {
      static permission = 'default';
      static requestPermission() {
        throw new Error('NotAllowedError');
      }
    },
  });
  assert.equal(result, 'unsupported');
});

test('scheduleSystemTrigger: 有 TimestampTrigger 时交给系统定时投递', () => {
  const shown = [];
  const ok = scheduleSystemTrigger({
    title: '时间到：关火',
    body: '设定了 5 分钟',
    tag: 'countdown-3',
    at: 1_700_000_300_000,
    registration: {
      showNotification: (title, options) => shown.push({ title, options }),
    },
    TimestampTriggerCtor: class {
      constructor(timestamp) {
        this.timestamp = timestamp;
      }
    },
  });

  assert.equal(ok, true);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.showTrigger.timestamp, 1_700_000_300_000);
  assert.equal(shown[0].options.showTrigger instanceof Object, true);
});

test('scheduleSystemTrigger: 环境不支持时安静地返回 false', () => {
  assert.equal(
    scheduleSystemTrigger({ title: 'x', at: 1, TimestampTriggerCtor: undefined }),
    false
  );
  assert.equal(
    scheduleSystemTrigger({
      title: 'x',
      at: Number.NaN,
      registration: { showNotification() {} },
      TimestampTriggerCtor: class {},
    }),
    false
  );
  assert.equal(
    scheduleSystemTrigger({
      title: 'x',
      at: 1,
      registration: null,
      TimestampTriggerCtor: class {},
    }),
    false
  );
});

test('closeSystemNotifications: 关掉同 tag 的通知', async () => {
  const closed = [];
  const count = await closeSystemNotifications({
    tag: 'countdown-4',
    registration: {
      getNotifications: () => Promise.resolve([{ close: () => closed.push(1) }, { close: () => closed.push(2) }]),
    },
  });
  assert.equal(count, 2);
  assert.equal(closed.length, 2);
  assert.equal(await closeSystemNotifications({ tag: '', registration: {} }), 0);
  assert.equal(await closeSystemNotifications({ tag: 'x', registration: null }), 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSetAlarmIntent,
  isFailedHandoff,
  openSystemAlarm,
  SET_ALARM_ACTION,
  FALLBACK_WARN_WINDOW_MS,
  supportsSystemAlarm,
} from '../src/system-alarm.js';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const ANDROID_FIREFOX =
  'Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0';
const ANDROID_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S9110) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

test('supportsSystemAlarm: 只在 Android 的 Chromium 系浏览器上返回 true', () => {
  assert.equal(supportsSystemAlarm(ANDROID_CHROME), true);
  assert.equal(supportsSystemAlarm(ANDROID_SAMSUNG), true);
  assert.equal(supportsSystemAlarm(ANDROID_FIREFOX), false, 'Firefox for Android 不支持 intent://');
  assert.equal(supportsSystemAlarm(IOS_SAFARI), false);
  assert.equal(supportsSystemAlarm(DESKTOP_CHROME), false);
  assert.equal(supportsSystemAlarm(''), false);
  assert.equal(supportsSystemAlarm(undefined), false, '取不到 UA 时按不支持处理');
});

test('buildSetAlarmIntent: 24 小时制的时刻与 SKIP_UI', () => {
  const at = new Date(2026, 8, 24, 9, 5, 30).getTime();
  const url = buildSetAlarmIntent({ at, label: '关火' });

  assert.ok(url.startsWith('intent://#Intent;'));
  assert.ok(url.endsWith(';end'));
  assert.ok(url.includes(`action=${SET_ALARM_ACTION}`));
  assert.ok(url.includes('i.android.intent.extra.alarm.HOUR=9'));
  assert.ok(url.includes('i.android.intent.extra.alarm.MINUTES=5'));
  assert.ok(url.includes('b.android.intent.extra.alarm.SKIP_UI=true'));
});

test('buildSetAlarmIntent: 下午用 24 小时制，零点也正确', () => {
  const afternoon = buildSetAlarmIntent({ at: new Date(2026, 8, 24, 14, 32).getTime() });
  assert.ok(afternoon.includes('i.android.intent.extra.alarm.HOUR=14'));
  assert.ok(afternoon.includes('i.android.intent.extra.alarm.MINUTES=32'));

  const midnight = buildSetAlarmIntent({ at: new Date(2026, 8, 25, 0, 3).getTime() });
  assert.ok(midnight.includes('i.android.intent.extra.alarm.HOUR=0'));
  assert.ok(midnight.includes('i.android.intent.extra.alarm.MINUTES=3'));
});

test('buildSetAlarmIntent: 提醒事项做 URL 编码，空白折叠并截断', () => {
  const url = buildSetAlarmIntent({
    at: new Date(2026, 8, 24, 9, 5).getTime(),
    label: '  关火\n顺便关窗  ',
  });
  assert.ok(
    url.includes(`S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent('关火 顺便关窗')}`)
  );
  assert.ok(!url.includes('\n'));

  const long = buildSetAlarmIntent({ at: Date.now(), label: 'x'.repeat(200) });
  assert.ok(long.includes(`MESSAGE=${'x'.repeat(60)}`));
});

test('buildSetAlarmIntent: 没写事项时不带 MESSAGE，也可以关掉 SKIP_UI', () => {
  const at = new Date(2026, 8, 24, 9, 5).getTime();
  assert.ok(!buildSetAlarmIntent({ at, label: '   ' }).includes('MESSAGE'));

  const withUi = buildSetAlarmIntent({ at, label: '关火', skipUi: false });
  assert.ok(!withUi.includes('SKIP_UI'));
});

test('buildSetAlarmIntent: fallbackUrl 也做编码', () => {
  const url = buildSetAlarmIntent({
    at: Date.now(),
    label: '关火',
    fallbackUrl: 'https://example.com/timer/',
  });
  assert.ok(
    url.includes(`S.browser_fallback_url=${encodeURIComponent('https://example.com/timer/')}`)
  );
});

test('buildSetAlarmIntent: at 非法时退化成「现在」', () => {
  const url = buildSetAlarmIntent({ at: Number.NaN });
  const now = new Date();
  assert.ok(url.includes(`HOUR=${now.getHours()}`));
  assert.ok(url.includes(`MINUTES=${now.getMinutes()}`));
});

test('openSystemAlarm: 立即跳转，并在没跳走时回调一次', () => {
  const navigated = [];
  const timers = [];
  const at = new Date(2026, 8, 24, 9, 5).getTime();

  openSystemAlarm({
    at,
    label: '关火',
    navigate: (url) => navigated.push(url),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    isStillHere: () => true,
    onBlocked: () => navigated.push('blocked'),
  });

  assert.equal(navigated.length, 1);
  assert.ok(navigated[0].startsWith('intent://#Intent;'));
  assert.equal(timers.length, 1);

  timers[0].fn();
  assert.deepEqual(navigated.slice(1), ['blocked'], '页面还在前台才认为没跳走');
});

test('openSystemAlarm: 真的跳到时钟 App 时不再提示', () => {
  const events = [];
  openSystemAlarm({
    at: Date.now(),
    navigate: (url) => events.push(url),
    setTimer: (fn) => fn(),
    isStillHere: () => false,
    onBlocked: () => events.push('blocked'),
  });
  assert.equal(events.length, 1);
});

test('openSystemAlarm: 没有 navigate 时返回 null，不抛错', () => {
  assert.equal(openSystemAlarm({ at: Date.now() }), null);
  assert.doesNotThrow(() => openSystemAlarm({ at: Date.now(), navigate: () => {}, graceMs: 0 }));
});

test('isFailedHandoff: 只有「刚请求过又立刻回到页面」才算跳转失败', () => {
  const now = 1_700_000_000_000;
  assert.equal(isFailedHandoff({ ts: now - 1000 }, now), true);
  assert.equal(isFailedHandoff({ ts: now }, now), true);
  assert.equal(
    isFailedHandoff({ ts: now - FALLBACK_WARN_WINDOW_MS }, now),
    true,
    '窗口边界内仍算失败'
  );
  assert.equal(
    isFailedHandoff({ ts: now - FALLBACK_WARN_WINDOW_MS - 1 }, now),
    false,
    '窗口之外视为用户自己重新打开'
  );
  assert.equal(isFailedHandoff({ ts: now + 5000 }, now), false, '时间戳在未来不算');
});

test('isFailedHandoff: 脏数据一律返回 false', () => {
  assert.equal(isFailedHandoff(null), false);
  assert.equal(isFailedHandoff(undefined), false);
  assert.equal(isFailedHandoff('record'), false);
  assert.equal(isFailedHandoff({}), false);
  assert.equal(isFailedHandoff({ ts: 'yesterday' }), false);
  assert.equal(isFailedHandoff({ at: 1, ts: Number.NaN }), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createResetGuard, RESET_CONFIRM_MS } from '../src/reset-guard.js';

function fakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

test('默认确认窗口为 3 秒', () => {
  assert.equal(RESET_CONFIRM_MS, 3000);
});

test('首次点击进入待确认，窗口内再次点击才确认', () => {
  const clock = fakeClock();
  const guard = createResetGuard({ now: clock.now });

  assert.equal(guard.armed, false);
  assert.equal(guard.request(), 'armed');
  assert.equal(guard.armed, true);

  clock.advance(1200);
  assert.equal(guard.request(), 'confirmed');
  assert.equal(guard.armed, false);
});

test('窗口边界内仍然有效', () => {
  const clock = fakeClock();
  const guard = createResetGuard({ now: clock.now });
  guard.request();
  clock.advance(RESET_CONFIRM_MS);
  assert.equal(guard.request(), 'confirmed');
});

test('超时后再次点击是重新进入待确认，而不是确认', () => {
  const clock = fakeClock();
  const guard = createResetGuard({ now: clock.now });
  guard.request();
  clock.advance(RESET_CONFIRM_MS + 1);
  assert.equal(guard.request(), 'armed');
  assert.equal(guard.armed, true);
});

test('expired 在超时后解除待确认', () => {
  const clock = fakeClock();
  const guard = createResetGuard({ now: clock.now });

  assert.equal(guard.expired(), false);
  guard.request();

  clock.advance(RESET_CONFIRM_MS);
  assert.equal(guard.expired(), false);
  assert.equal(guard.armed, true);

  clock.advance(1);
  assert.equal(guard.expired(), true);
  assert.equal(guard.armed, false);
  assert.equal(guard.expired(), false);
});

test('cancel 解除待确认并返回此前状态', () => {
  const clock = fakeClock();
  const guard = createResetGuard({ now: clock.now });

  assert.equal(guard.cancel(), false);
  guard.request();
  assert.equal(guard.cancel(), true);
  assert.equal(guard.armed, false);
  assert.equal(guard.request(), 'armed');
});

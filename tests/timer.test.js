import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimer, IDLE, PAUSED, RUNNING } from '../src/timer.js';

function fakeClock(start = 1_700_000_000_000) {
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

function setup() {
  const clock = fakeClock();
  return { clock, timer: createTimer({ now: clock.now }) };
}

test('初始状态为 idle 且读数为 0', () => {
  const { timer } = setup();
  assert.equal(timer.state, IDLE);
  assert.equal(timer.elapsedMs(), 0);
});

test('start 后读数随时间增长（基于墙钟）', () => {
  const { timer, clock } = setup();
  assert.equal(timer.start(), 'started');
  assert.equal(timer.state, RUNNING);
  clock.advance(1500);
  assert.equal(timer.elapsedMs(), 1500);
  clock.advance(250);
  assert.equal(timer.elapsedMs(), 1750);
});

test('pause 冻结读数，之后时间流逝不再累加', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(2000);
  assert.equal(timer.pause(), true);
  assert.equal(timer.state, PAUSED);
  assert.equal(timer.elapsedMs(), 2000);
  clock.advance(5000);
  assert.equal(timer.elapsedMs(), 2000);
});

test('resume 后继续累加，且不重复计时', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(2000);
  timer.pause();
  clock.advance(10_000); // 暂停期间的空档不计入
  assert.equal(timer.resume(), 'resumed');
  assert.equal(timer.state, RUNNING);
  clock.advance(500);
  assert.equal(timer.elapsedMs(), 2500);
});

test('多次暂停/继续得到累计用时', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(5000);
  timer.pause();
  assert.equal(timer.elapsedMs(), 5000);

  timer.resume();
  clock.advance(7000);
  timer.pause();
  assert.equal(timer.elapsedMs(), 12000);

  timer.resume();
  clock.advance(1000);
  assert.equal(timer.elapsedMs(), 13000);
});

test('toggle 的三种语义', () => {
  const { timer, clock } = setup();
  assert.equal(timer.toggle(), 'started');
  assert.equal(timer.state, RUNNING);

  clock.advance(1000);
  assert.equal(timer.toggle(), 'paused');
  assert.equal(timer.state, PAUSED);
  assert.equal(timer.elapsedMs(), 1000);

  clock.advance(1000);
  assert.equal(timer.toggle(), 'resumed');
  assert.equal(timer.state, RUNNING);
  clock.advance(500);
  assert.equal(timer.elapsedMs(), 1500);
});

test('运行中重复 start 不会清零读数', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(1000);
  assert.equal(timer.start(), 'running');
  clock.advance(1000);
  assert.equal(timer.elapsedMs(), 2000);
});

test('非运行状态下 pause 是空操作', () => {
  const { timer, clock } = setup();
  assert.equal(timer.pause(), false);
  assert.equal(timer.state, IDLE);

  timer.start();
  clock.advance(300);
  timer.pause();
  clock.advance(300);
  assert.equal(timer.pause(), false);
  assert.equal(timer.state, PAUSED);
  assert.equal(timer.elapsedMs(), 300);
});

test('reset 停止并归零', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(4000);
  timer.reset();
  assert.equal(timer.state, IDLE);
  assert.equal(timer.elapsedMs(), 0);

  clock.advance(1000);
  assert.equal(timer.elapsedMs(), 0);

  timer.start();
  clock.advance(200);
  assert.equal(timer.elapsedMs(), 200);
});

test('reset 在暂停状态下同样归零', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(900);
  timer.pause();
  timer.reset();
  assert.equal(timer.state, IDLE);
  assert.equal(timer.elapsedMs(), 0);
});

test('系统时间回拨不会产生负读数，也不会吃掉已累计的时间', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(1000);
  timer.pause();
  clock.jumpTo(clock.now() - 60_000);
  assert.equal(timer.elapsedMs(), 1000);

  timer.resume();
  clock.advance(500);
  assert.equal(timer.elapsedMs(), 1500);
});

test('运行中系统时间回拨时读数不为负', () => {
  const { timer, clock } = setup();
  timer.start();
  clock.advance(1000);
  clock.jumpTo(clock.now() - 60_000);
  assert.ok(timer.elapsedMs() >= 0);
});

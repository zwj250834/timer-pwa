import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDuration, formatEndedAt } from '../src/format.js';

test('formatDuration: 零值与非法输入', () => {
  assert.equal(formatDuration(0), '00:00:00.00');
  assert.equal(formatDuration(-500), '00:00:00.00');
  assert.equal(formatDuration(Number.NaN), '00:00:00.00');
  assert.equal(formatDuration(undefined), '00:00:00.00');
});

test('formatDuration: 常规读数', () => {
  assert.equal(formatDuration(1), '00:00:00.00');
  assert.equal(formatDuration(9), '00:00:00.00');
  assert.equal(formatDuration(10), '00:00:00.01');
  assert.equal(formatDuration(1230), '00:00:01.23');
  assert.equal(formatDuration(59999), '00:00:59.99');
  assert.equal(formatDuration(60000), '00:01:00.00');
  assert.equal(formatDuration(3661230), '01:01:01.23');
});

test('formatDuration: 小时超过 99 时自然扩展位数', () => {
  assert.equal(formatDuration(99 * 3600 * 1000), '99:00:00.00');
  assert.equal(formatDuration(100 * 3600 * 1000), '100:00:00.00');
  assert.equal(formatDuration(1234 * 3600 * 1000), '1234:00:00.00');
  assert.equal(formatDuration(1234 * 3600 * 1000 + 450), '1234:00:00.45');
});

test('formatEndedAt: 当天显示「今天」', () => {
  const ts = new Date(2026, 8, 24, 14, 32, 5).getTime();
  const now = new Date(2026, 8, 24, 23, 59, 59).getTime();
  assert.equal(formatEndedAt(ts, now), '今天 14:32:05');
});

test('formatEndedAt: 跨天显示「昨天」', () => {
  const ts = new Date(2026, 8, 23, 8, 10, 0).getTime();
  const now = new Date(2026, 8, 24, 1, 0, 0).getTime();
  assert.equal(formatEndedAt(ts, now), '昨天 08:10:00');
});

test('formatEndedAt: 同年更早显示 MM-DD HH:MM', () => {
  const ts = new Date(2026, 8, 21, 8, 10, 0).getTime();
  const now = new Date(2026, 8, 24, 12, 0, 0).getTime();
  assert.equal(formatEndedAt(ts, now), '09-21 08:10');
});

test('formatEndedAt: 跨年补上年份', () => {
  const ts = new Date(2025, 11, 31, 23, 59, 0).getTime();
  const now = new Date(2026, 0, 2, 9, 0, 0).getTime();
  assert.equal(formatEndedAt(ts, now), '2025-12-31 23:59');
});

test('formatEndedAt: 非法输入返回空串', () => {
  assert.equal(formatEndedAt(0), '');
  assert.equal(formatEndedAt(Number.NaN), '');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKeepAliveWav,
  createKeepAlive,
  isAndroid,
  SAMPLE_RATE,
  TONE_AMPLITUDE,
} from '../src/keep-alive.js';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; ANY-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/17E148 Safari/604.1';

function decodeWav(dataUri) {
  assert.ok(dataUri.startsWith('data:audio/wav;base64,'));
  const bytes = Uint8Array.from(
    globalThis.atob(dataUri.slice('data:audio/wav;base64,'.length)),
    (char) => char.charCodeAt(0)
  );
  const view = new DataView(bytes.buffer);
  const ascii = (offset, length) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  return { bytes, view, ascii };
}

test('isAndroid: 认出 Android，排除 iOS 和桌面', () => {
  assert.equal(isAndroid(ANDROID_UA), true);
  assert.equal(isAndroid(IPHONE_UA), false);
  assert.equal(isAndroid('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0'), false);
  assert.equal(isAndroid(undefined), false);
});

test('buildKeepAliveWav: 生成合法的单声道 16 位 WAV', () => {
  const { bytes, view, ascii } = decodeWav(buildKeepAliveWav({ seconds: 0.5 }));

  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(ascii(12, 4), 'fmt ');
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, '单声道');
  assert.equal(view.getUint32(24, true), SAMPLE_RATE);
  assert.equal(view.getUint16(34, true), 16, '16 位');
  assert.equal(ascii(36, 4), 'data');

  const dataBytes = view.getUint32(40, true);
  assert.equal(dataBytes, 0.5 * SAMPLE_RATE * 2);
  assert.equal(bytes.length, 44 + dataBytes);
  assert.equal(view.getUint32(4, true), bytes.length - 8, 'RIFF 大小与实际长度一致');
});

test('buildKeepAliveWav: 电平极低但有信号（不是纯静音，避免被当成没在播放）', () => {
  const { view } = decodeWav(buildKeepAliveWav());
  const samples = view.getUint32(40, true) / 2;

  let max = 0;
  let nonZero = 0;
  for (let i = 0; i < samples; i += 1) {
    const value = Math.abs(view.getInt16(44 + i * 2, true));
    if (value > 0) nonZero += 1;
    if (value > max) max = value;
  }

  assert.equal(max, TONE_AMPLITUDE, `振幅不超过 ±${TONE_AMPLITUDE}`);
  assert.ok(nonZero > samples / 2, '大部分采样点非零，说明确实是一段波形');
});

test('buildKeepAliveWav: 时长与采样率可调', () => {
  const { view } = decodeWav(buildKeepAliveWav({ seconds: 1, sampleRate: 4000 }));
  assert.equal(view.getUint32(24, true), 4000);
  assert.equal(view.getUint32(40, true), 8000);
});

function fakeAudio({ playFails = false } = {}) {
  return {
    paused: true,
    played: 0,
    pausedCount: 0,
    play() {
      this.played += 1;
      if (playFails) return Promise.reject(new Error('NotAllowedError'));
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.pausedCount += 1;
      this.paused = true;
    },
  };
}

test('createKeepAlive: start 幂等，stop 会暂停播放', () => {
  const audio = fakeAudio();
  const keepAlive = createKeepAlive({ createAudio: () => audio });

  assert.equal(keepAlive.start(), true);
  assert.equal(audio.played, 1);
  assert.equal(keepAlive.playing, true);

  keepAlive.start();
  assert.equal(audio.played, 1, '已在播放时不再重复 play()');

  assert.equal(keepAlive.stop(), true);
  assert.equal(audio.pausedCount, 1);
  assert.equal(keepAlive.playing, false);
  assert.equal(keepAlive.wanted, false);
});

test('createKeepAlive: 没有音频元素时安全失败', () => {
  const keepAlive = createKeepAlive({ createAudio: () => null });
  assert.equal(keepAlive.start(), false);
  assert.equal(keepAlive.playing, false);
});

test('createKeepAlive: 被自动播放策略拒绝后回到未启动状态，可以再试', async () => {
  const audio = fakeAudio({ playFails: true });
  const keepAlive = createKeepAlive({ createAudio: () => audio });

  assert.equal(keepAlive.start(), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(keepAlive.wanted, false, '被拒绝后不假装还在保活');

  keepAlive.start();
  assert.equal(audio.played, 2, '下次手势还能再试一次');
});

/**
 * 让页面在熄屏后别被系统冻住。
 *
 * 熄屏不响的根因是：Chrome 会冻结后台标签页，Android 进入 Doze 后连定时器都停摆，
 * 于是「到点该响」的那一刻没人执行。这条规则有一个例外——**正在播放音频的标签页
 * 不会被冻结**，Android 也会因为音频流继续持有唤醒，所以这里循环播放一段
 * -90 dB 左右、正常音量下听不见的音频，把页面维持在「正在播放」的状态。
 *
 * 说清楚它的边界：
 *   - 只在 Android 的 Chromium 系浏览器上有意义，iOS 会在后台挂起 JS，帮不上忙；
 *   - 播放必须由用户手势启动（浏览器自动播放策略），所以是在点「开始倒计时」时开始播；
 *   - 它让页面有机会活着，但不保证一定能对抗各家厂商的省电策略。
 */

export const SAMPLE_RATE = 8000;
/** 16 位采样里 ±1 ≈ -90 dBFS：远远低于任何扬声器的本底噪声。 */
export const TONE_AMPLITUDE = 1;
export const TONE_HZ = 440;

export function isAndroid(userAgent = globalThis.navigator?.userAgent ?? '') {
  return /android/i.test(String(userAgent));
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return globalThis.btoa(binary);
}

/**
 * 生成一段极低电平的单声道 WAV（data URI），省掉一个音频资源文件。
 * 默认 0.5 秒 440 Hz——440 × 0.5 正好是整数个周期，循环处不会有衔接杂音。
 */
export function buildKeepAliveWav({
  seconds = 0.5,
  sampleRate = SAMPLE_RATE,
  amplitude = TONE_AMPLITUDE,
  frequency = TONE_HZ,
} = {}) {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk 大小
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeAscii(36, 'data');
  view.setUint32(40, samples * 2, true);

  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
    view.setInt16(44 + i * 2, value, true);
  }

  return `data:audio/wav;base64,${toBase64(bytes)}`;
}

function defaultCreateAudio(doc) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  const audio = doc.createElement('audio');
  audio.src = buildKeepAliveWav();
  audio.loop = true;
  audio.preload = 'auto';
  audio.setAttribute('aria-hidden', 'true');
  audio.setAttribute('playsinline', '');
  audio.style.display = 'none';
  doc.body?.append(audio);
  return audio;
}

/**
 * 保活播放器。start() 幂等：已经播着就什么都不做，被浏览器拒绝就安静地回到未启动状态，
 * 等下一次用户手势再试。
 */
export function createKeepAlive({ createAudio, document: doc } = {}) {
  let audio = null;
  let wanted = false;

  function element() {
    if (audio) return audio;
    audio = createAudio
      ? createAudio()
      : defaultCreateAudio(doc ?? globalThis.document);
    return audio;
  }

  function start() {
    wanted = true;
    const el = element();
    if (!el || typeof el.play !== 'function') return false;
    if (el.paused === false) return true;
    try {
      const result = el.play();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          wanted = false;
        });
      }
    } catch {
      wanted = false;
      return false;
    }
    return true;
  }

  function stop() {
    wanted = false;
    if (audio && typeof audio.pause === 'function') audio.pause();
    return true;
  }

  return {
    start,
    stop,
    get wanted() {
      return wanted;
    },
    get playing() {
      return Boolean(audio && audio.paused === false);
    },
  };
}

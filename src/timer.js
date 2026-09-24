/**
 * 正计时秒表状态机。
 *
 * 读数完全基于墙钟（now()）推算，而不是累加 tick，因此页面被后台节流、
 * 锁屏或切到其它标签页时都不会丢时间。
 */

export const IDLE = 'idle';
export const RUNNING = 'running';
export const PAUSED = 'paused';

const STATES = new Set([IDLE, RUNNING, PAUSED]);

export function createTimer({ now = Date.now } = {}) {
  let state = IDLE;
  let accumulated = 0;
  let startedAt = 0;

  function readNow() {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
  }

  function elapsedMs() {
    if (state !== RUNNING) return accumulated;
    return accumulated + Math.max(0, readNow() - startedAt);
  }

  /** 从 idle 启动，或从 paused 继续；已在运行时为空操作。 */
  function start() {
    if (state === RUNNING) return 'running';
    const resume = state === PAUSED;
    if (!resume) accumulated = 0;
    startedAt = readNow();
    state = RUNNING;
    return resume ? 'resumed' : 'started';
  }

  function resume() {
    return start();
  }

  /** 仅在运行中有效；返回是否真的发生了暂停。 */
  function pause() {
    if (state !== RUNNING) return false;
    accumulated = elapsedMs();
    startedAt = 0;
    state = PAUSED;
    return true;
  }

  /** 返回 'started' | 'resumed' | 'paused'。 */
  function toggle() {
    if (state === RUNNING) {
      pause();
      return 'paused';
    }
    return start();
  }

  function reset() {
    state = IDLE;
    accumulated = 0;
    startedAt = 0;
  }

  return {
    get state() {
      return state;
    },
    get isKnownState() {
      return STATES.has(state);
    },
    elapsedMs,
    start,
    pause,
    resume,
    toggle,
    reset,
  };
}

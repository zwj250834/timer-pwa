export const RESET_CONFIRM_MS = 3000;

/**
 * 「重置」的二次确认守卫：第一次调用进入待确认，超时窗口内再次调用才返回
 * 'confirmed'。超时或点击别处用 cancel()/expired() 还原。
 */
export function createResetGuard({ timeoutMs = RESET_CONFIRM_MS, now = Date.now } = {}) {
  let armedAt = null;

  function readNow() {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
  }

  return {
    get armed() {
      return armedAt !== null;
    },
    /** 返回 'armed'（进入待确认）或 'confirmed'（确认执行）。 */
    request() {
      const stamp = readNow();
      if (armedAt !== null && stamp - armedAt <= timeoutMs) {
        armedAt = null;
        return 'confirmed';
      }
      armedAt = stamp;
      return 'armed';
    },
    /** 超时则解除待确认并返回 true。 */
    expired() {
      if (armedAt === null) return false;
      if (readNow() - armedAt > timeoutMs) {
        armedAt = null;
        return true;
      }
      return false;
    },
    /** 主动解除，返回此前是否处于待确认。 */
    cancel() {
      const wasArmed = armedAt !== null;
      armedAt = null;
      return wasArmed;
    },
  };
}

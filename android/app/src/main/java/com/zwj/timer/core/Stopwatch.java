package com.zwj.timer.core;

/**
 * 正计时状态机（纯逻辑）。
 * 读数完全由墙钟推算，所以应用被切到后台、锁屏都不会丢时间。
 */
public class Stopwatch {
  public static final String IDLE = "idle";
  public static final String RUNNING = "running";
  public static final String PAUSED = "paused";

  private String state = IDLE;
  private long accumulated;
  private long startedAt;

  public String state() {
    return state;
  }

  public long elapsedMs(long now) {
    if (!RUNNING.equals(state)) return accumulated;
    return accumulated + Math.max(0, now - startedAt);
  }

  /** 返回 started / resumed / running。 */
  public String start(long now) {
    if (RUNNING.equals(state)) return "running";
    boolean resume = PAUSED.equals(state);
    if (!resume) accumulated = 0;
    startedAt = now;
    state = RUNNING;
    return resume ? "resumed" : "started";
  }

  public String resume(long now) {
    return start(now);
  }

  /** 只有运行中才真的暂停。 */
  public boolean pause(long now) {
    if (!RUNNING.equals(state)) return false;
    accumulated = elapsedMs(now);
    startedAt = 0;
    state = PAUSED;
    return true;
  }

  /** 返回 started / resumed / paused。 */
  public String toggle(long now) {
    if (RUNNING.equals(state)) {
      pause(now);
      return "paused";
    }
    return start(now);
  }

  public void reset() {
    state = IDLE;
    accumulated = 0;
    startedAt = 0;
  }
}

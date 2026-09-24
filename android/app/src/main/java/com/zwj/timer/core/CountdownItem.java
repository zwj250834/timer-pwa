package com.zwj.timer.core;

/** 一条倒计时。字段含义与网页版一一对应，方便两边行为一致。 */
public class CountdownItem {
  public static final String RUNNING = "running";
  public static final String PAUSED = "paused";
  public static final String FIRED = "fired";

  public String id = "";
  public String label = "";
  public long durationMs;
  public String state = RUNNING;
  /** 运行中：计划结束的绝对时刻。 */
  public long endsAt;
  /** 暂停中：冻结的剩余时间。 */
  public long remainingMs;
  /** 已响铃：原定的结束时刻。 */
  public long firedAt;
  /** 超过宽限期才被发现，算「错过」，只提示不响铃。 */
  public boolean missed;

  public CountdownItem copy() {
    CountdownItem item = new CountdownItem();
    item.id = id;
    item.label = label;
    item.durationMs = durationMs;
    item.state = state;
    item.endsAt = endsAt;
    item.remainingMs = remainingMs;
    item.firedAt = firedAt;
    item.missed = missed;
    return item;
  }

  public boolean isFired() {
    return FIRED.equals(state);
  }

  /** 某一时刻的剩余毫秒数。 */
  public long remainingAt(long now) {
    if (PAUSED.equals(state)) return Math.max(0, remainingMs);
    if (FIRED.equals(state)) return 0;
    return Math.max(0, endsAt - now);
  }

  public String serialize() {
    java.util.List<String> fields = new java.util.ArrayList<>();
    fields.add(id);
    fields.add(state);
    fields.add(label);
    fields.add(Long.toString(durationMs));
    fields.add(Long.toString(endsAt));
    fields.add(Long.toString(remainingMs));
    fields.add(Long.toString(firedAt));
    fields.add(missed ? "1" : "0");
    return LineStore.join(fields);
  }

  public static CountdownItem deserialize(String line) {
    java.util.List<String> fields = LineStore.split(line);
    if (fields.size() < 8) return null;
    CountdownItem item = new CountdownItem();
    item.id = fields.get(0);
    item.state = fields.get(1);
    item.label = fields.get(2);
    item.durationMs = parseLong(fields.get(3), 0);
    item.endsAt = parseLong(fields.get(4), 0);
    item.remainingMs = parseLong(fields.get(5), 0);
    item.firedAt = parseLong(fields.get(6), 0);
    item.missed = "1".equals(fields.get(7));
    if (!isValid(item)) return null;
    return item;
  }

  private static boolean isValid(CountdownItem item) {
    if (item.id.isEmpty()) return false;
    if (item.durationMs < 1000) return false;
    if (RUNNING.equals(item.state) && item.endsAt <= 0) return false;
    if (PAUSED.equals(item.state) && item.remainingMs < 1000) return false;
    if (FIRED.equals(item.state) && item.firedAt <= 0) return false;
    return RUNNING.equals(item.state) || PAUSED.equals(item.state) || FIRED.equals(item.state);
  }

  private static long parseLong(String text, long fallback) {
    try {
      return Long.parseLong(text.trim());
    } catch (NumberFormatException error) {
      return fallback;
    }
  }
}

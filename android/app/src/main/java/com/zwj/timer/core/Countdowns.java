package com.zwj.timer.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * 倒计时队列的状态机（纯逻辑，不碰 Android API）。
 * 与网页版 src/countdown.js 保持一致：按墙钟推算、可暂停、到点结算一次。
 */
public class Countdowns {
  public static final int DEFAULT_LIMIT = 24;
  public static final long MIN_DURATION_MS = 1000;
  public static final long MAX_DURATION_MS = 24L * 60 * 60 * 1000;
  public static final int MAX_LABEL_LENGTH = 60;
  /** 超过这个时间才被发现到点，算「错过」，只提示不响铃。 */
  public static final long MISSED_AFTER_MS = 60L * 60 * 1000;

  private final int limit;
  private long missedAfterMs = MISSED_AFTER_MS;
  private final List<CountdownItem> items = new ArrayList<>();
  private long seq;

  public Countdowns() {
    this(DEFAULT_LIMIT);
  }

  public Countdowns(int limit) {
    this.limit = Math.max(1, limit);
  }

  public void setMissedAfterMs(long value) {
    this.missedAfterMs = value;
  }

  public int limit() {
    return limit;
  }

  public static String normalizeLabel(String raw) {
    if (raw == null) return "";
    String collapsed = raw.trim().replaceAll("\\s+", " ");
    return collapsed.length() > MAX_LABEL_LENGTH
        ? collapsed.substring(0, MAX_LABEL_LENGTH)
        : collapsed;
  }

  public static long normalizeDuration(long value) {
    if (value < MIN_DURATION_MS) return 0;
    return Math.min(value, MAX_DURATION_MS);
  }

  /** 新增一项；时长非法或队列已满返回 null。 */
  public CountdownItem add(String label, long durationMs, long now) {
    long duration = normalizeDuration(durationMs);
    if (duration == 0) return null;
    if (items.size() >= limit) return null;

    CountdownItem item = new CountdownItem();
    item.id = nextId(now);
    item.label = normalizeLabel(label);
    item.durationMs = duration;
    item.state = CountdownItem.RUNNING;
    item.endsAt = now + duration;
    item.remainingMs = duration;
    item.firedAt = 0;
    item.missed = false;
    items.add(item);
    sort(now);
    return item.copy();
  }

  /** 用同样的事项和时长再排一项。 */
  public CountdownItem repeat(String id, long now) {
    CountdownItem item = find(id);
    if (item == null) return null;
    return add(item.label, item.durationMs, now);
  }

  public boolean pause(String id, long now) {
    CountdownItem item = find(id);
    if (item == null || !CountdownItem.RUNNING.equals(item.state)) return false;
    long left = item.remainingAt(now);
    if (left <= 0) return false;
    item.remainingMs = left;
    item.endsAt = 0;
    item.state = CountdownItem.PAUSED;
    sort(now);
    return true;
  }

  public boolean resume(String id, long now) {
    CountdownItem item = find(id);
    if (item == null || !CountdownItem.PAUSED.equals(item.state)) return false;
    long left = item.remainingMs > 0 ? item.remainingMs : item.durationMs;
    item.endsAt = now + left;
    item.remainingMs = left;
    item.state = CountdownItem.RUNNING;
    sort(now);
    return true;
  }

  /** 返回切换后的状态，或 null 表示这项不该切换（已响铃/不存在）。 */
  public String toggle(String id, long now) {
    CountdownItem item = find(id);
    if (item == null) return null;
    if (CountdownItem.RUNNING.equals(item.state)) {
      return pause(id, now) ? CountdownItem.PAUSED : null;
    }
    if (CountdownItem.PAUSED.equals(item.state)) {
      return resume(id, now) ? CountdownItem.RUNNING : null;
    }
    return null;
  }

  public boolean remove(String id) {
    for (int i = 0; i < items.size(); i++) {
      if (items.get(i).id.equals(id)) {
        items.remove(i);
        return true;
      }
    }
    return false;
  }

  public void clear() {
    items.clear();
  }

  public boolean clearFired() {
    int before = items.size();
    for (int i = items.size() - 1; i >= 0; i--) {
      if (items.get(i).isFired()) items.remove(i);
    }
    return items.size() != before;
  }

  /** 到点结算：返回这一轮刚刚转为「已响铃」的项。 */
  public List<CountdownItem> sync(long now) {
    List<CountdownItem> fired = new ArrayList<>();
    for (CountdownItem item : items) {
      if (!CountdownItem.RUNNING.equals(item.state)) continue;
      if (item.endsAt > now) continue;
      item.state = CountdownItem.FIRED;
      item.firedAt = item.endsAt;
      item.remainingMs = 0;
      item.missed = now - item.endsAt > missedAfterMs;
      fired.add(item.copy());
    }
    if (!fired.isEmpty()) sort(now);
    return fired;
  }

  public CountdownItem find(String id) {
    for (CountdownItem item : items) {
      if (item.id.equals(id)) return item;
    }
    return null;
  }

  public int activeCount() {
    int count = 0;
    for (CountdownItem item : items) {
      if (!item.isFired()) count++;
    }
    return count;
  }

  public int size() {
    return items.size();
  }

  /** 当前队列快照，已按「最近的在前、响过的在后」排好。 */
  public List<CountdownItem> list(long now) {
    sort(now);
    List<CountdownItem> copies = new ArrayList<>();
    for (CountdownItem item : items) copies.add(item.copy());
    return copies;
  }

  /** 下一次该到点的绝对时刻，没有则返回 0。 */
  public long nextDueAt(long now) {
    long earliest = 0;
    for (CountdownItem item : items) {
      if (!CountdownItem.RUNNING.equals(item.state)) continue;
      if (earliest == 0 || item.endsAt < earliest) earliest = item.endsAt;
    }
    return earliest;
  }

  public void loadFrom(List<String> lines) {
    items.clear();
    for (String line : lines) {
      CountdownItem item = CountdownItem.deserialize(line);
      if (item == null) continue;
      boolean duplicated = false;
      for (CountdownItem existing : items) {
        if (existing.id.equals(item.id)) duplicated = true;
      }
      if (!duplicated) items.add(item);
    }
    sort(System.currentTimeMillis());
    while (items.size() > limit) items.remove(items.size() - 1);
  }

  public List<String> serializeLines() {
    List<String> lines = new ArrayList<>();
    for (CountdownItem item : items) lines.add(item.serialize());
    return lines;
  }

  private void sort(final long now) {
    Collections.sort(
        items,
        new Comparator<CountdownItem>() {
          @Override
          public int compare(CountdownItem a, CountdownItem b) {
            if (a.isFired() != b.isFired()) return a.isFired() ? 1 : -1;
            if (a.isFired()) return Long.compare(b.firedAt, a.firedAt);
            return Long.compare(a.remainingAt(now), b.remainingAt(now));
          }
        });
  }

  private String nextId(long now) {
    seq++;
    String id = Long.toString(now, 36) + "-" + Long.toString(seq, 36);
    while (find(id) != null) {
      seq++;
      id = Long.toString(now, 36) + "-" + Long.toString(seq, 36);
    }
    return id;
  }
}

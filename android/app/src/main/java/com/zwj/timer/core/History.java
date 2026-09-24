package com.zwj.timer.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** 正计时的历史记录：最多保留最近 10 条，最新的在最前面。 */
public class History {
  public static final int DEFAULT_LIMIT = 10;

  public static class Entry {
    public String id = "";
    public long durationMs;
    public long endedAt;

    public String serialize() {
      List<String> fields = new ArrayList<>();
      fields.add(id);
      fields.add(Long.toString(durationMs));
      fields.add(Long.toString(endedAt));
      return LineStore.join(fields);
    }

    public static Entry deserialize(String line) {
      List<String> fields = LineStore.split(line);
      if (fields.size() < 3) return null;
      Entry entry = new Entry();
      entry.id = fields.get(0);
      try {
        entry.durationMs = Long.parseLong(fields.get(1));
        entry.endedAt = Long.parseLong(fields.get(2));
      } catch (NumberFormatException error) {
        return null;
      }
      if (entry.id.isEmpty() || entry.endedAt <= 0) return null;
      return entry;
    }
  }

  private final int limit;
  private final List<Entry> entries = new ArrayList<>();
  private long seq;

  public History() {
    this(DEFAULT_LIMIT);
  }

  public History(int limit) {
    this.limit = Math.max(0, limit);
  }

  public Entry add(long durationMs, long endedAt) {
    Entry entry = new Entry();
    seq++;
    entry.id = Long.toString(endedAt, 36) + "-" + Long.toString(seq, 36);
    entry.durationMs = Math.max(0, durationMs);
    entry.endedAt = endedAt;
    entries.add(0, entry);
    while (entries.size() > limit) entries.remove(entries.size() - 1);
    return entry;
  }

  public boolean remove(String id) {
    for (int i = 0; i < entries.size(); i++) {
      if (entries.get(i).id.equals(id)) {
        entries.remove(i);
        return true;
      }
    }
    return false;
  }

  public void clear() {
    entries.clear();
  }

  public List<Entry> list() {
    return new ArrayList<>(entries);
  }

  public int size() {
    return entries.size();
  }

  public int limit() {
    return limit;
  }

  public void loadFrom(List<String> lines) {
    entries.clear();
    for (String line : lines) {
      Entry entry = Entry.deserialize(line);
      if (entry == null) continue;
      entries.add(entry);
    }
    Collections.sort(
        entries,
        new Comparator<Entry>() {
          @Override
          public int compare(Entry a, Entry b) {
            return Long.compare(b.endedAt, a.endedAt);
          }
        });
    while (entries.size() > limit) entries.remove(entries.size() - 1);
  }

  public List<String> serializeLines() {
    List<String> lines = new ArrayList<>();
    for (Entry entry : entries) lines.add(entry.serialize());
    return lines;
  }
}

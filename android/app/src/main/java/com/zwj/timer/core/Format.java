package com.zwj.timer.core;

/** 时间格式化。全部是纯函数，方便单独用 JDK 跑测试。 */
public final class Format {
  private Format() {}

  private static String pad(long value, int width) {
    String text = Long.toString(value);
    StringBuilder builder = new StringBuilder();
    for (int i = text.length(); i < width; i++) builder.append('0');
    return builder.append(text).toString();
  }

  /** 正计时读数：HH:MM:SS.cc。 */
  public static String duration(long ms) {
    long safe = ms > 0 ? ms : 0;
    long centis = (safe / 10) % 100;
    long totalSeconds = safe / 1000;
    long seconds = totalSeconds % 60;
    long minutes = (totalSeconds / 60) % 60;
    long hours = totalSeconds / 3600;
    return pad(hours, 2) + ":" + pad(minutes, 2) + ":" + pad(seconds, 2) + "." + pad(centis, 2);
  }

  /** 倒计时读数：向上取整到秒，不足 1 小时用 MM:SS。 */
  public static String remaining(long ms) {
    long total = ms > 0 ? (ms + 999) / 1000 : 0;
    long seconds = total % 60;
    long minutes = (total / 60) % 60;
    long hours = total / 3600;
    return hours > 0
        ? hours + ":" + pad(minutes, 2) + ":" + pad(seconds, 2)
        : pad(minutes, 2) + ":" + pad(seconds, 2);
  }

  /** 时刻：HH:MM。 */
  public static String clock(long timestamp) {
    if (timestamp <= 0) return "";
    java.util.Calendar calendar = java.util.Calendar.getInstance();
    calendar.setTimeInMillis(timestamp);
    return pad(calendar.get(java.util.Calendar.HOUR_OF_DAY), 2)
        + ":"
        + pad(calendar.get(java.util.Calendar.MINUTE), 2);
  }

  /** 时长的口语说法：90 分钟 → 1 小时 30 分钟。 */
  public static String describeDuration(long ms) {
    long totalSeconds = ms > 0 ? Math.round(ms / 1000.0) : 0;
    long seconds = totalSeconds % 60;
    long minutes = (totalSeconds / 60) % 60;
    long hours = totalSeconds / 3600;

    StringBuilder text = new StringBuilder();
    if (hours > 0) text.append(hours).append(" 小时");
    if (minutes > 0) {
      if (text.length() > 0) text.append(' ');
      text.append(minutes).append(" 分钟");
    }
    if (seconds > 0 || text.length() == 0) {
      if (text.length() > 0) text.append(' ');
      text.append(seconds).append(" 秒");
    }
    return text.toString();
  }

  /** 结束时刻文案：今天带秒，昨天带「昨天」，更早显示 MM-DD HH:MM。 */
  public static String endedAt(long timestamp, long now) {
    if (timestamp <= 0) return "";
    java.util.Calendar target = java.util.Calendar.getInstance();
    target.setTimeInMillis(timestamp);
    java.util.Calendar reference = java.util.Calendar.getInstance();
    reference.setTimeInMillis(now);

    long diffDays =
        startOfDay(reference.getTimeInMillis()) / 86400000L
            - startOfDay(target.getTimeInMillis()) / 86400000L;
    String clock = clock(timestamp);
    String withSeconds =
        clock + ":" + pad(target.get(java.util.Calendar.SECOND), 2);

    if (diffDays == 0) return "今天 " + withSeconds;
    if (diffDays == 1) return "昨天 " + withSeconds;
    String monthDay =
        pad(target.get(java.util.Calendar.MONTH) + 1, 2)
            + "-"
            + pad(target.get(java.util.Calendar.DAY_OF_MONTH), 2)
            + " "
            + clock;
    return target.get(java.util.Calendar.YEAR) == reference.get(java.util.Calendar.YEAR)
        ? monthDay
        : target.get(java.util.Calendar.YEAR) + "-" + monthDay;
  }

  private static long startOfDay(long timestamp) {
    java.util.Calendar calendar = java.util.Calendar.getInstance();
    calendar.setTimeInMillis(timestamp);
    calendar.set(java.util.Calendar.HOUR_OF_DAY, 0);
    calendar.set(java.util.Calendar.MINUTE, 0);
    calendar.set(java.util.Calendar.SECOND, 0);
    calendar.set(java.util.Calendar.MILLISECOND, 0);
    return calendar.getTimeInMillis();
  }
}

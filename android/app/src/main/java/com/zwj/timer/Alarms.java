package com.zwj.timer;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.zwj.timer.core.CountdownItem;

import java.util.List;

/**
 * 原生闹钟调度。
 *
 * 用 AlarmManager.setAlarmClock()：这是系统给闹钟类应用留的接口，精确到点、
 * Doze 期间照样唤醒设备，还会在状态栏显示闹钟图标——网页永远做不到这件事，
 * 这也是改用原生实现的根本原因。
 */
public final class Alarms {
  public static final String ACTION_RING = "com.zwj.timer.action.RING";
  public static final String EXTRA_ID = "com.zwj.timer.extra.ID";
  public static final String EXTRA_LABEL = "com.zwj.timer.extra.LABEL";

  private Alarms() {}

  private static int requestCode(String id) {
    return 5000 + (id.hashCode() & 0x0FFFFFFF) % 100000;
  }

  private static PendingIntent ringIntent(Context context, String id) {
    Intent intent =
        new Intent(context, AlarmReceiver.class)
            .setAction(ACTION_RING)
            .setData(Uri.parse("timer://ring/" + id))
            .putExtra(EXTRA_ID, id);
    return PendingIntent.getBroadcast(
        context,
        requestCode(id),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  /** Android 12 起需要用户授予「闹钟与提醒」权限才能用精确闹钟。 */
  public static boolean canScheduleExact(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
    AlarmManager manager = context.getSystemService(AlarmManager.class);
    return manager != null && manager.canScheduleExactAlarms();
  }

  public static void schedule(Context context, CountdownItem item) {
    if (item == null || !CountdownItem.RUNNING.equals(item.state)) return;
    AlarmManager manager = context.getSystemService(AlarmManager.class);
    if (manager == null) return;

    PendingIntent showIntent =
        PendingIntent.getActivity(
            context,
            requestCode(item.id),
            new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    try {
      manager.setAlarmClock(
          new AlarmManager.AlarmClockInfo(item.endsAt, showIntent), ringIntent(context, item.id));
    } catch (SecurityException error) {
      // 没有精确闹钟权限时退一步：仍会在息屏下唤醒，只是可能有几分钟误差
      manager.setAndAllowWhileIdle(
          AlarmManager.RTC_WAKEUP, item.endsAt, ringIntent(context, item.id));
    }
  }

  public static void cancel(Context context, String id) {
    AlarmManager manager = context.getSystemService(AlarmManager.class);
    if (manager != null) manager.cancel(ringIntent(context, id));
  }

  /** 应用启动或开机后重新登记所有还在跑的倒计时。 */
  public static void rescheduleAll(Context context, List<CountdownItem> items) {
    for (CountdownItem item : items) {
      if (CountdownItem.RUNNING.equals(item.state)) schedule(context, item);
    }
  }
}

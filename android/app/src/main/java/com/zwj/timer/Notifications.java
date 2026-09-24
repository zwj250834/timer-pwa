package com.zwj.timer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import com.zwj.timer.core.Format;

/** 通知渠道与到点通知：走系统闹钟通道，锁屏也会响铃震动。 */
public final class Notifications {
  public static final String CHANNEL_ID = "alarm";
  public static final String ACTION_STOP = "com.zwj.timer.action.STOP";
  private static final long[] VIBRATE = {600, 350, 600, 350, 600, 1200};

  private Notifications() {}

  public static void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

    NotificationChannel channel =
        new NotificationChannel(CHANNEL_ID, "到点提醒", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("倒计时到点时响铃提醒，锁屏也会弹出");
    channel.enableVibration(true);
    channel.setVibrationPattern(VIBRATE);
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

    Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
    if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    if (sound != null) {
      AudioAttributes attributes =
          new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build();
      channel.setSound(sound, attributes);
    }
    manager.createNotificationChannel(channel);
  }

  /** 到点通知。带全屏 intent，锁屏时会直接把响铃界面顶到最前面。 */
  public static Notification build(Context context, String id, String label, long at) {
    Intent fullScreen =
        new Intent(context, AlarmActivity.class)
            .putExtra(Alarms.EXTRA_ID, id)
            .putExtra(Alarms.EXTRA_LABEL, label)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent screenIntent =
        PendingIntent.getActivity(
            context,
            ("screen:" + id).hashCode(),
            fullScreen,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    PendingIntent stopIntent =
        PendingIntent.getBroadcast(
            context,
            ("stop:" + id).hashCode(),
            new Intent(context, AlarmReceiver.class)
                .setAction(ACTION_STOP)
                .setData(Uri.parse("timer://stop/" + id))
                .putExtra(Alarms.EXTRA_ID, id),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

    Notification.Builder builder =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, CHANNEL_ID)
            : new Notification.Builder(context);

    return builder
        .setSmallIcon(R.drawable.ic_alarm)
        .setContentTitle("时间到：" + (label.isEmpty() ? "未填写事项" : label))
        .setContentText("现在 " + Format.clock(at) + "，这条提醒到点了。")
        .setCategory(Notification.CATEGORY_ALARM)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setPriority(Notification.PRIORITY_MAX)
        .setAutoCancel(false)
        .setOngoing(true)
        .setFullScreenIntent(screenIntent, true)
        .setContentIntent(screenIntent)
        .addAction(0, "停止响铃", stopIntent)
        .build();
  }

  public static int notificationId(String id) {
    return 7000 + (id.hashCode() & 0x0FFFFFFF) % 100000;
  }
}

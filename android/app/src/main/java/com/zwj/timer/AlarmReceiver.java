package com.zwj.timer;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.zwj.timer.core.CountdownItem;
import com.zwj.timer.core.Countdowns;

/**
 * 到点的接收器：由 AlarmManager 精确唤醒，即使手机在息屏、Doze 里也会准时进来。
 * 这里负责把倒计时标记为已响铃、弹出通知（带全屏 intent）、登记待确认队列。
 */
public class AlarmReceiver extends BroadcastReceiver {

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    String id = intent.getStringExtra(Alarms.EXTRA_ID);
    if (id == null) return;

    if (Notifications.ACTION_STOP.equals(action)) {
      stop(context, id);
      return;
    }

    Store store = new Store(context);
    Countdowns items = store.loadCountdowns();
    CountdownItem item = items.find(id);

    long now = System.currentTimeMillis();
    String label = intent.getStringExtra(Alarms.EXTRA_LABEL);
    long at = now;
    if (item != null) {
      label = item.label;
      at = item.endsAt > 0 ? item.endsAt : now;
      if (CountdownItem.RUNNING.equals(item.state)) {
        item.state = CountdownItem.FIRED;
        item.firedAt = at;
        item.remainingMs = 0;
        item.missed = false;
        store.saveCountdowns(items);
      }
    }
    if (label == null) label = "";

    Notifications.ensureChannel(context);
    store.addPendingAlarm(id);

    NotificationManager manager = context.getSystemService(NotificationManager.class);
    if (manager != null) {
      manager.notify(Notifications.notificationId(id), Notifications.build(context, id, label, at));
    }

    // 通知里的全屏 intent 是系统把响铃界面顶到前台的正规途径；
    // 这里再直接尝试拉起一次，作为部分机型不弹全屏 intent 的兜底。
    try {
      Intent ring =
          new Intent(context, AlarmActivity.class)
              .putExtra(Alarms.EXTRA_ID, id)
              .putExtra(Alarms.EXTRA_LABEL, label)
              .setFlags(
                  Intent.FLAG_ACTIVITY_NEW_TASK
                      | Intent.FLAG_ACTIVITY_CLEAR_TOP
                      | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
      context.startActivity(ring);
    } catch (Exception ignored) {
      // Android 10 起后台启动 Activity 受限，失败就依赖通知与全屏 intent
    }
  }

  /** 停止响铃：撤掉通知、清掉待确认记录。 */
  public static void stop(Context context, String id) {
    Store store = new Store(context);
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    if (manager != null) manager.cancel(Notifications.notificationId(id));
    store.removePendingAlarm(id);
  }

  /** 判断系统是否允许弹全屏提醒（Android 14 起需要单独授权）。 */
  public static boolean canUseFullScreenIntent(Context context) {
    if (Build.VERSION.SDK_INT < 34) return true;
    NotificationManager manager = context.getSystemService(NotificationManager.class);
    return manager != null && manager.canUseFullScreenIntent();
  }
}

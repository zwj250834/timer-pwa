package com.zwj.timer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.zwj.timer.core.CountdownItem;
import com.zwj.timer.core.Countdowns;

import java.util.List;

/**
 * 开机/更新后重新登记闹钟：AlarmManager 里的闹钟在重启后会丢失，
 * 不补这一刀的话「晚上设的提醒，早上开机就没了」。
 */
public class BootReceiver extends BroadcastReceiver {

  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (action == null) return;
    if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
        && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
      return;
    }

    Store store = new Store(context);
    Countdowns items = store.loadCountdowns();
    long now = System.currentTimeMillis();

    // 重启期间到点的：标记为已响铃（超过宽限期算错过），不再补响
    List<CountdownItem> expired = items.sync(now);
    if (!expired.isEmpty()) store.saveCountdowns(items);

    Notifications.ensureChannel(context);
    Alarms.rescheduleAll(context, items.list(now));
  }
}

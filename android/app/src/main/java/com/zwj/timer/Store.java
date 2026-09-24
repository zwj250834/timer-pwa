package com.zwj.timer;

import android.content.Context;
import android.content.SharedPreferences;

import com.zwj.timer.core.Countdowns;
import com.zwj.timer.core.History;
import com.zwj.timer.core.LineStore;

import java.util.ArrayList;
import java.util.List;

/** 本地存储：倒计时队列、历史记录、模式、待确认的到点提醒。 */
public class Store {
  private static final String PREFS = "timer";
  private static final String KEY_COUNTDOWNS = "countdowns";
  private static final String KEY_HISTORY = "history";
  private static final String KEY_MODE = "mode";
  private static final String KEY_PENDING = "pendingAlarms";

  private final SharedPreferences prefs;

  public Store(Context context) {
    this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public Countdowns loadCountdowns() {
    Countdowns countdowns = new Countdowns();
    countdowns.loadFrom(LineStore.lines(prefs.getString(KEY_COUNTDOWNS, "")));
    return countdowns;
  }

  /** 用 commit 保证在 BroadcastReceiver 结束前一定落盘。 */
  public void saveCountdowns(Countdowns countdowns) {
    prefs.edit()
        .putString(KEY_COUNTDOWNS, String.join("\n", countdowns.serializeLines()))
        .commit();
  }

  public History loadHistory() {
    History history = new History();
    history.loadFrom(LineStore.lines(prefs.getString(KEY_HISTORY, "")));
    return history;
  }

  public void saveHistory(History history) {
    prefs.edit().putString(KEY_HISTORY, String.join("\n", history.serializeLines())).apply();
  }

  public String mode() {
    return prefs.getString(KEY_MODE, "stopwatch");
  }

  public void setMode(String mode) {
    prefs.edit().putString(KEY_MODE, mode).apply();
  }

  /** 已经到点、但用户还没点「停止响铃」的提醒，用于多项同时到点时排队。 */
  public List<String> pendingAlarms() {
    return new ArrayList<>(LineStore.lines(prefs.getString(KEY_PENDING, "")));
  }

  public void addPendingAlarm(String id) {
    List<String> pending = pendingAlarms();
    if (!pending.contains(id)) pending.add(id);
    prefs.edit().putString(KEY_PENDING, String.join("\n", pending)).commit();
  }

  public void removePendingAlarm(String id) {
    List<String> pending = pendingAlarms();
    pending.remove(id);
    prefs.edit().putString(KEY_PENDING, String.join("\n", pending)).commit();
  }

  public void clearPendingAlarms() {
    prefs.edit().remove(KEY_PENDING).commit();
  }
}

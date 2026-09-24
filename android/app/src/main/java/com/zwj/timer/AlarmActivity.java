package com.zwj.timer;

import android.app.Activity;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.zwj.timer.core.CountdownItem;
import com.zwj.timer.core.Countdowns;
import com.zwj.timer.core.Format;

import java.util.List;

/**
 * 响铃界面：锁屏也会直接顶到最前面，全屏显示提醒事项并一直响到用户点「停止响铃」。
 * 多项同时到点时排队，停掉一项接着显示下一项。
 */
public class AlarmActivity extends Activity {
  /** 没人管的响铃最长响这么久，避免一直吵。 */
  private static final long AUTO_STOP_MS = 60_000;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private MediaPlayer player;
  private Vibrator vibrator;
  private TextView labelView;
  private TextView metaView;
  private TextView moreView;
  private String currentId;
  private boolean ringing;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    showOverLockScreen();
    setContentView(buildLayout());
    currentId = getIntent().getStringExtra(Alarms.EXTRA_ID);
    showNext();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    currentId = intent.getStringExtra(Alarms.EXTRA_ID);
    showNext();
  }

  @SuppressWarnings("deprecation")
  private void showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    } else {
      getWindow()
          .addFlags(
              WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                  | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  private LinearLayout buildLayout() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER);
    root.setBackgroundColor(Ui.INK);
    int pad = Ui.dp(this, 24);
    root.setPadding(pad, pad, pad, pad);

    LinearLayout card = Ui.card(this);
    card.setGravity(Gravity.CENTER_HORIZONTAL);

    TextView kicker = Ui.text(this, "时间到", 15f, Ui.FLARE, true);
    kicker.setBackground(Ui.pill(0x00000000, Ui.FLARE, this));
    int kpad = Ui.dp(this, 12);
    kicker.setPadding(kpad, Ui.dp(this, 6), kpad, Ui.dp(this, 6));
    card.addView(kicker);

    labelView = Ui.text(this, "", 30f, Ui.FG, true);
    labelView.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams labelParams = Ui.wrap();
    labelParams.topMargin = Ui.dp(this, 18);
    card.addView(labelView, labelParams);

    metaView = Ui.text(this, "", 15f, Ui.FG_DIM, false);
    metaView.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams metaParams = Ui.wrap();
    metaParams.topMargin = Ui.dp(this, 10);
    card.addView(metaView, metaParams);

    moreView = Ui.text(this, "", 14f, Ui.FLARE, true);
    moreView.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams moreParams = Ui.wrap();
    moreParams.topMargin = Ui.dp(this, 8);
    moreView.setVisibility(TextView.GONE);
    card.addView(moreView, moreParams);

    TextView stop = Ui.button(this, "停止响铃", 18f, Ui.FLARE, Ui.FLARE_INK);
    LinearLayout.LayoutParams stopParams = Ui.matchWidth(this, 56);
    stopParams.topMargin = Ui.dp(this, 22);
    stop.setOnClickListener(view -> dismissCurrent());
    card.addView(stop, stopParams);

    root.addView(card, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    return root;
  }

  /** 显示待确认队列里的下一条；没有就结束。 */
  private void showNext() {
    Store store = new Store(this);
    List<String> pending = store.pendingAlarms();
    if (currentId != null && !pending.contains(currentId)) pending.add(0, currentId);
    if (pending.isEmpty()) {
      stopRinging();
      finish();
      return;
    }

    currentId = pending.get(0);
    Countdowns items = store.loadCountdowns();
    CountdownItem item = items.find(currentId);
    String label = item != null && !item.label.isEmpty() ? item.label : "未填写事项";
    long at = item != null && item.firedAt > 0 ? item.firedAt : System.currentTimeMillis();

    labelView.setText(label);
    metaView.setText("现在 " + Format.clock(System.currentTimeMillis()) + "，这条提醒到点了。");
    int rest = pending.size() - 1;
    moreView.setVisibility(rest > 0 ? TextView.VISIBLE : TextView.GONE);
    if (rest > 0) moreView.setText("还有 " + rest + " 项也到时间了，停止后会接着响。");

    startRinging(at);
  }

  private void startRinging(long at) {
    if (!ringing) {
      ringing = true;
      startSound();
      startVibration();
      handler.postDelayed(this::autoStop, AUTO_STOP_MS);
    }
  }

  private void startSound() {
    try {
      Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
      if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
      if (sound == null) return;
      player = new MediaPlayer();
      player.setDataSource(this, sound);
      player.setAudioAttributes(
          new AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ALARM)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build());
      player.setLooping(true);
      player.prepare();
      player.start();
    } catch (Exception error) {
      player = null;
    }
  }

  private void startVibration() {
    try {
      vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
      if (vibrator == null || !vibrator.hasVibrator()) return;
      long[] pattern = {0, 600, 350, 600, 350, 600, 1200};
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
      } else {
        vibrator.vibrate(pattern, 0);
      }
    } catch (Exception ignored) {
      vibrator = null;
    }
  }

  private void stopRinging() {
    ringing = false;
    handler.removeCallbacksAndMessages(null);
    if (player != null) {
      try {
        player.stop();
      } catch (Exception ignored) {
        // 已经停了
      }
      player.release();
      player = null;
    }
    if (vibrator != null) {
      vibrator.cancel();
      vibrator = null;
    }
  }

  /** 自动停止：只停声音，界面留着，让用户还知道是哪条提醒。 */
  private void autoStop() {
    if (currentId != null) {
      // 超过一分钟没人管，撤掉通知但把「还有几项」的信息留在界面上
      AlarmReceiver.stop(this, currentId);
    }
    ringing = false;
    if (player != null) {
      try {
        player.stop();
        player.release();
      } catch (Exception ignored) {
        // 忽略
      }
      player = null;
    }
    if (vibrator != null) {
      vibrator.cancel();
      vibrator = null;
    }
  }

  private void dismissCurrent() {
    if (currentId != null) AlarmReceiver.stop(this, currentId);
    Store store = new Store(this);
    currentId = null;

    List<String> pending = store.pendingAlarms();
    if (pending.isEmpty()) {
      stopRinging();
      finish();
      return;
    }
    showNext();
  }

  @Override
  protected void onDestroy() {
    stopRinging();
    super.onDestroy();
  }
}

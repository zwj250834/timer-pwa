package com.zwj.timer;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.zwj.timer.core.CountdownItem;
import com.zwj.timer.core.Countdowns;
import com.zwj.timer.core.Format;
import com.zwj.timer.core.History;
import com.zwj.timer.core.Stopwatch;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 主界面：正计时 / 倒计时两个模式。
 *
 * 倒计时交给系统的 AlarmManager（见 Alarms），所以关掉屏幕、锁屏、甚至杀掉应用，
 * 到点都由系统把提醒顶到前台——这是网页做不到的部分。
 */
public class MainActivity extends Activity {
  private static final int REQUEST_NOTIFICATIONS = 1001;
  private static final long TICK_MS = 200;
  private static final long URGENT_MS = 30_000;
  private static final int[] PRESET_MINUTES = {1, 3, 5, 10, 15, 30};

  private Store store;
  private Countdowns countdowns;
  private History history;
  private final Stopwatch stopwatch = new Stopwatch();
  private String mode = "stopwatch";

  private TextView modeStopwatch;
  private TextView modeCountdown;
  private LinearLayout stopwatchPanel;
  private LinearLayout countdownPanel;
  private LinearLayout permissionsBox;
  private LinearLayout rowsBox;
  private TextView statusView;
  private TextView displayView;
  private TextView mainButton;
  private TextView resetButton;
  private TextView carryoverView;
  private TextView listTitle;
  private TextView listCount;
  private TextView emptyView;
  private TextView clearFiredButton;
  private EditText labelInput;
  private EditText minutesInput;
  private EditText secondsInput;
  private TextView[] chipViews;
  private final Map<String, TextView> timeViews = new HashMap<>();
  private final Map<String, View> railFills = new HashMap<>();

  private boolean resetArmed;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable ticker =
      new Runnable() {
        @Override
        public void run() {
          tick();
          handler.postDelayed(this, TICK_MS);
        }
      };

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    store = new Store(this);
    countdowns = store.loadCountdowns();
    history = store.loadHistory();
    mode = store.mode();
    buildUi();
    applyMode();
    renderAll();
    askNotificationPermission();
  }

  @Override
  protected void onResume() {
    super.onResume();
    Notifications.ensureChannel(this);
    // 重新登记一遍：权限可能刚被打开，或者系统重启后闹钟丢了
    Alarms.rescheduleAll(this, countdowns.list(System.currentTimeMillis()));
    renderAll();
    handler.removeCallbacks(ticker);
    handler.post(ticker);
  }

  @Override
  protected void onPause() {
    handler.removeCallbacks(ticker);
    super.onPause();
  }

  /* ---------- 界面搭建 ---------- */

  private void buildUi() {
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(Ui.INK);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    int pad = Ui.dp(this, 16);
    root.setPadding(pad, pad, pad, pad);
    scroll.addView(root);

    root.addView(buildModeSwitch());
    root.addView(buildStopwatchPanel());
    root.addView(buildCountdownPanel());
    root.addView(buildListPanel());

    permissionsBox = new LinearLayout(this);
    permissionsBox.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams boxParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    boxParams.topMargin = Ui.dp(this, 12);
    root.addView(permissionsBox, boxParams);

    setContentView(scroll);
  }

  private View buildModeSwitch() {
    LinearLayout bar = Ui.row(this);
    bar.setBackground(Ui.background(Ui.SURFACE_2, 999f, Ui.LINE, this));
    int pad = Ui.dp(this, 4);
    bar.setPadding(pad, pad, pad, pad);

    modeStopwatch = switchButton("正计时");
    modeCountdown = switchButton("倒计时");
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f);
    bar.addView(modeStopwatch, params);
    bar.addView(modeCountdown, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));

    modeStopwatch.setOnClickListener(
        view -> {
          mode = "stopwatch";
          store.setMode(mode);
          applyMode();
          renderAll();
        });
    modeCountdown.setOnClickListener(
        view -> {
          mode = "countdown";
          store.setMode(mode);
          applyMode();
          renderAll();
        });
    return bar;
  }

  private TextView switchButton(String label) {
    TextView view = Ui.text(this, label, 16f, Ui.FG_DIM, true);
    view.setGravity(Gravity.CENTER);
    view.setBackground(Ui.pill(Color.TRANSPARENT, 0, this));
    view.setClickable(true);
    return view;
  }

  private View buildStopwatchPanel() {
    stopwatchPanel = Ui.card(this);
    stopwatchPanel.setGravity(Gravity.CENTER_HORIZONTAL);

    statusView = Ui.text(this, "就绪", 13f, Ui.FG_DIM, true);
    statusView.setGravity(Gravity.CENTER);
    statusView.setBackground(Ui.pill(Color.TRANSPARENT, Ui.LINE, this));
    int padH = Ui.dp(this, 14);
    statusView.setPadding(padH, Ui.dp(this, 6), padH, Ui.dp(this, 6));
    // 垂直 LinearLayout 的默认子布局是 MATCH_PARENT，直接 addView 会把胶囊拉成整行宽
    stopwatchPanel.addView(statusView, Ui.wrap());

    displayView = Ui.numerals(this, 42f, Ui.FG);
    displayView.setText("00:00:00.00");
    LinearLayout.LayoutParams displayParams = Ui.wrap();
    displayParams.topMargin = Ui.dp(this, 14);
    stopwatchPanel.addView(displayView, displayParams);

    LinearLayout actions = Ui.row(this);
    LinearLayout.LayoutParams actionsParams = Ui.matchWidth(this, 54);
    actionsParams.topMargin = Ui.dp(this, 16);

    mainButton = Ui.button(this, "开始", 17f, Ui.MINT, Ui.MINT_INK);
    mainButton.setOnClickListener(view -> onMainClick());
    actions.addView(mainButton, new LinearLayout.LayoutParams(0, Ui.dp(this, 54), 1.35f));

    resetButton = Ui.outline(this, "重置", 17f, Ui.FG, Ui.LINE);
    resetButton.setOnClickListener(view -> onResetClick());
    LinearLayout.LayoutParams resetParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 54), 1f);
    resetParams.leftMargin = Ui.dp(this, 10);
    actions.addView(resetButton, resetParams);

    stopwatchPanel.addView(actions, actionsParams);
    return stopwatchPanel;
  }

  private View buildCountdownPanel() {
    countdownPanel = Ui.card(this);

    countdownPanel.addView(Ui.text(this, "要提醒我什么", 13f, Ui.FG_DIM, true));

    labelInput = new EditText(this);
    labelInput.setHint("关火、吃药、开会……");
    labelInput.setHintTextColor(Ui.FG_DIM);
    labelInput.setTextColor(Ui.FG);
    labelInput.setTextSize(16f);
    labelInput.setBackground(Ui.background(Ui.SURFACE_2, 14f, Ui.LINE, this));
    labelInput.setPadding(Ui.dp(this, 14), Ui.dp(this, 12), Ui.dp(this, 14), Ui.dp(this, 12));
    labelInput.setSingleLine(true);
    LinearLayout.LayoutParams labelParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    labelParams.topMargin = Ui.dp(this, 8);
    countdownPanel.addView(labelInput, labelParams);

    TextView durationLabel = Ui.text(this, "多久后提醒", 13f, Ui.FG_DIM, true);
    LinearLayout.LayoutParams durationParams = Ui.wrap();
    durationParams.topMargin = Ui.dp(this, 16);
    countdownPanel.addView(durationLabel, durationParams);

    countdownPanel.addView(buildChips());

    LinearLayout custom = Ui.row(this);
    custom.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    minutesInput = numberField("5");
    secondsInput = numberField("0");
    LinearLayout minGroup = unitField(minutesInput, "分");
    LinearLayout secGroup = unitField(secondsInput, "秒");
    LinearLayout.LayoutParams minParams = new LinearLayout.LayoutParams(0, heightWrap(), 1f);
    minParams.topMargin = Ui.dp(this, 10);
    minParams.rightMargin = Ui.dp(this, 5);
    custom.addView(minGroup, minParams);
    LinearLayout.LayoutParams secParams = new LinearLayout.LayoutParams(0, heightWrap(), 1f);
    secParams.topMargin = Ui.dp(this, 10);
    secParams.leftMargin = Ui.dp(this, 5);
    custom.addView(secGroup, secParams);
    countdownPanel.addView(custom);

    carryoverView = Ui.text(this, "", 13f, Ui.FG_DIM, false);
    carryoverView.setVisibility(View.GONE);
    LinearLayout.LayoutParams carryParams = Ui.wrap();
    carryParams.topMargin = Ui.dp(this, 10);
    countdownPanel.addView(carryoverView, carryParams);

    TextView submit = Ui.button(this, "开始倒计时", 17f, Ui.AMBER, Ui.AMBER_INK);
    submit.setOnClickListener(view -> onSubmit());
    LinearLayout.LayoutParams submitParams = Ui.matchWidth(this, 54);
    submitParams.topMargin = Ui.dp(this, 14);
    countdownPanel.addView(submit, submitParams);

    return countdownPanel;
  }

  private int heightWrap() {
    return LinearLayout.LayoutParams.WRAP_CONTENT;
  }

  /**
   * 预设时长。横向 LinearLayout 不会换行，六个胶囊排不下就会溢出到外面，
   * 所以手动排成两行、每行三个等宽胶囊。
   */
  private View buildChips() {
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setLayoutParams(
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

    chipViews = new TextView[PRESET_MINUTES.length];
    int perRow = 3;
    for (int row = 0; row < (PRESET_MINUTES.length + perRow - 1) / perRow; row++) {
      LinearLayout line = Ui.row(this);
      line.setLayoutParams(
          new LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
      for (int column = 0; column < perRow; column++) {
        int index = row * perRow + column;
        if (index >= PRESET_MINUTES.length) break;
        final int minutes = PRESET_MINUTES[index];
        final TextView chip = Ui.outline(this, minutes + " 分钟", 14f, Ui.FG, Ui.LINE);
        chip.setSingleLine(true);
        chip.setGravity(Gravity.CENTER);
        chip.setOnClickListener(view -> {
          minutesInput.setText(String.valueOf(minutes));
          secondsInput.setText("0");
          highlightChips();
        });
        chipViews[index] = chip;

        LinearLayout.LayoutParams chipParams =
            new LinearLayout.LayoutParams(0, Ui.dp(this, 44), 1f);
        chipParams.topMargin = Ui.dp(this, 8);
        if (column < perRow - 1) chipParams.rightMargin = Ui.dp(this, 8);
        line.addView(chip, chipParams);
      }
      box.addView(line);
    }
    return box;
  }

  /** 输入框 + 单位：单位单独放一个 TextView，值填了也看得见单位。 */
  private LinearLayout unitField(EditText input, String unit) {
    LinearLayout group = Ui.row(this);
    group.setBackground(Ui.background(Ui.SURFACE_2, 14f, Ui.LINE, this));
    int padH = Ui.dp(this, 12);
    int padV = Ui.dp(this, 10);
    group.setPadding(padH, padV, padH, padV);
    input.setBackground(null);
    group.addView(
        input,
        new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
    group.addView(Ui.text(this, unit, 14f, Ui.FG_DIM, true));
    return group;
  }

  private EditText numberField(String value) {
    EditText field = new EditText(this);
    field.setInputType(InputType.TYPE_CLASS_NUMBER);
    field.setText(value);
    field.setTextColor(Ui.FG);
    field.setTextSize(16f);
    field.setGravity(Gravity.CENTER);
    field.setPadding(0, 0, 0, 0);
    field.setMinimumWidth(0);
    field.setMinWidth(0);
    return field;
  }

  private View buildListPanel() {
    LinearLayout panel = new LinearLayout(this);
    panel.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams panelParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    panelParams.topMargin = Ui.dp(this, 18);

    LinearLayout header = Ui.row(this);
    listTitle = Ui.text(this, "历史记录", 17f, Ui.FG, true);
    listCount = Ui.text(this, "0/10", 13f, Ui.FG_DIM, false);
    header.addView(listTitle, new LinearLayout.LayoutParams(0, Ui.dp(this, 24), 1f));
    header.addView(listCount);
    panel.addView(header, panelParams);

    emptyView = Ui.text(this, "", 14f, Ui.FG_DIM, false);
    emptyView.setPadding(Ui.dp(this, 16), Ui.dp(this, 18), Ui.dp(this, 16), Ui.dp(this, 18));
    emptyView.setGravity(Gravity.CENTER);
    emptyView.setBackground(Ui.background(Color.TRANSPARENT, 14f, Ui.LINE, this));
    LinearLayout.LayoutParams emptyParams = Ui.matchWidth(this, 72);
    emptyParams.topMargin = Ui.dp(this, 10);
    panel.addView(emptyView, emptyParams);

    rowsBox = new LinearLayout(this);
    rowsBox.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams rowsParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    rowsParams.topMargin = Ui.dp(this, 8);
    panel.addView(rowsBox, rowsParams);

    clearFiredButton = Ui.outline(this, "清除已响铃", 14f, Ui.FG_DIM, Ui.LINE);
    clearFiredButton.setVisibility(View.GONE);
    clearFiredButton.setOnClickListener(view -> {
      if (countdowns.clearFired()) {
        store.saveCountdowns(countdowns);
        renderAll();
        toast("已清掉响过的提醒。");
      }
    });
    LinearLayout.LayoutParams clearParams = Ui.wrap();
    clearParams.topMargin = Ui.dp(this, 12);
    clearParams.gravity = Gravity.CENTER_HORIZONTAL;
    panel.addView(clearFiredButton, clearParams);

    return panel;
  }

  /* ---------- 渲染 ---------- */

  private void applyMode() {
    boolean counting = "countdown".equals(mode);
    stopwatchPanel.setVisibility(counting ? View.GONE : View.VISIBLE);
    countdownPanel.setVisibility(counting ? View.VISIBLE : View.GONE);
    listTitle.setText(counting ? "待提醒" : "历史记录");

    styleSwitch(modeStopwatch, !counting);
    styleSwitch(modeCountdown, counting);
    highlightChips();
  }

  private void styleSwitch(TextView view, boolean active) {
    if (active) {
      view.setTextColor("countdown".equals(mode) ? Ui.AMBER_INK : Ui.MINT_INK);
      view.setBackground(
          Ui.pill("countdown".equals(mode) ? Ui.AMBER : Ui.MINT, 0, this));
    } else {
      view.setTextColor(Ui.FG_DIM);
      view.setBackground(Ui.pill(Color.TRANSPARENT, 0, this));
    }
  }

  private void highlightChips() {
    if (chipViews == null) return;
    int minutes = readInt(minutesInput, 0);
    int seconds = readInt(secondsInput, 0);
    for (int i = 0; i < chipViews.length; i++) {
      TextView chip = chipViews[i];
      if (chip == null) continue;
      boolean active = seconds == 0 && PRESET_MINUTES[i] == minutes;
      chip.setTextColor(active ? Ui.AMBER_TEXT : Ui.FG);
      chip.setBackground(
          Ui.pill(active ? 0x22F2A63C : Color.TRANSPARENT, active ? Ui.AMBER_TEXT : Ui.LINE, this));
    }
  }

  private void renderAll() {
    renderStopwatch();
    renderList();
    renderPermissions();
    renderCarryover();
  }

  private void renderStopwatch() {
    long now = System.currentTimeMillis();
    displayView.setText(Format.duration(stopwatch.elapsedMs(now)));
    String state = stopwatch.state();
    statusView.setText(
        Stopwatch.RUNNING.equals(state) ? "计时中" : Stopwatch.PAUSED.equals(state) ? "已暂停" : "就绪");
    statusView.setTextColor(Stopwatch.RUNNING.equals(state) ? Ui.MINT_TEXT : Ui.FG_DIM);
    statusView.setBackground(
        Ui.pill(Color.TRANSPARENT, Stopwatch.RUNNING.equals(state) ? Ui.MINT_TEXT : Ui.LINE, this));
    mainButton.setText(
        Stopwatch.RUNNING.equals(state) ? "暂停" : Stopwatch.PAUSED.equals(state) ? "继续" : "开始");
    resetButton.setText(resetArmed ? "确认清空？" : "重置");
    resetButton.setTextColor(resetArmed ? Ui.FLARE : Ui.FG);
    resetButton.setBackground(
        Ui.background(Color.TRANSPARENT, 999f, resetArmed ? Ui.FLARE : Ui.LINE, this));
  }

  private void renderList() {
    rowsBox.removeAllViews();
    timeViews.clear();
    railFills.clear();
    long now = System.currentTimeMillis();

    if ("countdown".equals(mode)) {
      List<CountdownItem> items = countdowns.list(now);
      listCount.setText(items.size() + " 项");
      emptyView.setVisibility(items.isEmpty() ? View.VISIBLE : View.GONE);
      emptyView.setText("还没有倒计时。写下要提醒的事，选好时长，到点会响铃叫你。");
      boolean hasFired = false;
      String nextId = null;
      long best = Long.MAX_VALUE;
      for (CountdownItem item : items) {
        if (item.isFired()) {
          hasFired = true;
          continue;
        }
        long left = item.remainingAt(now);
        if (left < best) {
          best = left;
          nextId = item.id;
        }
      }
      clearFiredButton.setVisibility(hasFired ? View.VISIBLE : View.GONE);
      for (CountdownItem item : items) {
        rowsBox.addView(buildCountdownRow(item, item.id.equals(nextId), now));
      }
      return;
    }

    List<History.Entry> entries = history.list();
    listCount.setText(entries.size() + "/" + history.limit());
    emptyView.setVisibility(entries.isEmpty() ? View.VISIBLE : View.GONE);
    emptyView.setText("暂无记录。每次暂停计时，都会在这里留下一条。");
    clearFiredButton.setVisibility(View.GONE);
    for (int i = 0; i < entries.size(); i++) {
      rowsBox.addView(buildHistoryRow(entries.get(i), i));
    }
  }

  private View buildCountdownRow(CountdownItem item, boolean isNext, long now) {
    LinearLayout card = new LinearLayout(this);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setBackground(Ui.background(Ui.SURFACE_2, 14f, Ui.LINE, this));
    int pad = Ui.dp(this, 14);
    card.setPadding(pad, pad, pad, Ui.dp(this, 10));
    LinearLayout.LayoutParams cardParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    cardParams.topMargin = Ui.dp(this, 8);
    card.setLayoutParams(cardParams);

    LinearLayout head = Ui.row(this);
    head.setGravity(Gravity.BOTTOM);
    if (item.isFired()) {
      TextView flag = Ui.text(this, item.missed ? "已错过" : "已响铃", 13f, Ui.FG_DIM, true);
      flag.setBackground(Ui.pill(Color.TRANSPARENT, Ui.LINE, this));
      int fpad = Ui.dp(this, 10);
      flag.setPadding(fpad, Ui.dp(this, 4), fpad, Ui.dp(this, 4));
      head.addView(flag);
    } else {
      TextView time = Ui.numerals(this, isNext ? 34f : 26f, rowAccent(item, now));
      time.setText(Format.remaining(item.remainingAt(now)));
      head.addView(time);
      timeViews.put(item.id, time);
    }

    TextView label = Ui.text(this, item.label.isEmpty() ? "未填写事项" : item.label, 16f, Ui.FG, false);
    LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 36), 1f);
    labelParams.leftMargin = Ui.dp(this, 12);
    label.setGravity(Gravity.BOTTOM);
    head.addView(label, labelParams);
    card.addView(head);

    if (!item.isFired()) {
      LinearLayout track = Ui.row(this);
      track.setBackground(Ui.background(0x22E2F0E8, 999f, 0, this));
      LinearLayout.LayoutParams trackParams = Ui.matchWidth(this, 4);
      trackParams.topMargin = Ui.dp(this, 12);
      View fill = new View(this);
      fill.setBackground(Ui.background(rowAccent(item, now), 999f, 0, this));
      View spacer = new View(this);
      track.addView(fill, new LinearLayout.LayoutParams(0, Ui.dp(this, 4), railWeight(item, now)));
      track.addView(
          spacer, new LinearLayout.LayoutParams(0, Ui.dp(this, 4), 1f - railWeight(item, now)));
      railFills.put(item.id, fill);
      card.addView(track, trackParams);
    }

    LinearLayout foot = Ui.row(this);
    LinearLayout.LayoutParams footParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    footParams.topMargin = Ui.dp(this, 10);
    TextView meta = Ui.text(this, metaOf(item, now), 12f, Ui.FG_DIM, false);
    foot.addView(meta, new LinearLayout.LayoutParams(0, Ui.dp(this, 36), 1f));

    if (item.isFired()) {
      TextView again = Ui.outline(this, "再来一次", 13f, Ui.FG_DIM, Ui.LINE);
      again.setOnClickListener(view -> onRepeat(item.id));
      TextView remove = Ui.outline(this, "删除", 13f, Ui.FG_DIM, Ui.LINE);
      remove.setOnClickListener(view -> onRemove(item.id));
      foot.addView(again, withLeftMargin(Ui.wrap(), 8));
      foot.addView(remove, withLeftMargin(Ui.wrap(), 8));
    } else {
      TextView toggle =
          Ui.outline(
              this,
              CountdownItem.PAUSED.equals(item.state) ? "继续" : "暂停",
              13f,
              Ui.FG_DIM,
              Ui.LINE);
      toggle.setOnClickListener(view -> onToggle(item.id));
      TextView remove = Ui.outline(this, "取消", 13f, Ui.FG_DIM, Ui.LINE);
      remove.setOnClickListener(view -> onRemove(item.id));
      foot.addView(toggle, withLeftMargin(Ui.wrap(), 8));
      foot.addView(remove, withLeftMargin(Ui.wrap(), 8));
    }

    card.addView(foot, footParams);
    return card;
  }

  private LinearLayout.LayoutParams withLeftMargin(LinearLayout.LayoutParams params, int dp) {
    params.leftMargin = Ui.dp(this, dp);
    return params;
  }

  private int rowAccent(CountdownItem item, long now) {
    if (CountdownItem.PAUSED.equals(item.state)) return Ui.FG_DIM;
    if (item.remainingAt(now) <= URGENT_MS) return Ui.FLARE;
    return Ui.AMBER_TEXT;
  }

  private float railWeight(CountdownItem item, long now) {
    if (item.durationMs <= 0) return 0f;
    float fraction = (float) item.remainingAt(now) / (float) item.durationMs;
    return Math.max(0f, Math.min(1f, fraction));
  }

  private String metaOf(CountdownItem item, long now) {
    if (item.isFired()) return "原定 " + Format.clock(item.firedAt) + " 提醒";
    if (CountdownItem.PAUSED.equals(item.state)) return "已暂停";
    return Format.clock(item.endsAt) + " 提醒";
  }

  private View buildHistoryRow(History.Entry entry, int index) {
    LinearLayout row = Ui.row(this);
    row.setBackground(Ui.background(Ui.SURFACE_2, 14f, Ui.LINE, this));
    int pad = Ui.dp(this, 14);
    row.setPadding(pad, Ui.dp(this, 10), Ui.dp(this, 6), Ui.dp(this, 10));
    LinearLayout.LayoutParams rowParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    rowParams.topMargin = Ui.dp(this, 8);
    row.setLayoutParams(rowParams);

    row.addView(Ui.text(this, "#" + (index + 1), 13f, Ui.FG_DIM, false));
    TextView duration = Ui.numerals(this, 18f, Ui.FG);
    duration.setText(Format.duration(entry.durationMs));
    LinearLayout.LayoutParams durationParams = Ui.wrap();
    durationParams.leftMargin = Ui.dp(this, 12);
    row.addView(duration, durationParams);

    TextView ended = Ui.text(this, Format.endedAt(entry.endedAt, System.currentTimeMillis()), 12f, Ui.FG_DIM, false);
    ended.setGravity(Gravity.RIGHT);
    LinearLayout.LayoutParams endedParams = new LinearLayout.LayoutParams(0, Ui.dp(this, 36), 1f);
    row.addView(ended, endedParams);

    TextView remove = Ui.outline(this, "✕", 14f, Ui.FG_DIM, Ui.LINE);
    remove.setOnClickListener(
        view -> {
          if (history.remove(entry.id)) {
            store.saveHistory(history);
            renderAll();
          }
        });
    row.addView(remove);
    return row;
  }

  private void renderCarryover() {
    boolean visible = "countdown".equals(mode) && !Stopwatch.IDLE.equals(stopwatch.state());
    carryoverView.setVisibility(visible ? View.VISIBLE : View.GONE);
    if (!visible) return;
    carryoverView.setText(
        (Stopwatch.RUNNING.equals(stopwatch.state()) ? "正计时还在跑：" : "正计时已暂停：")
            + Format.duration(stopwatch.elapsedMs(System.currentTimeMillis())));
  }

  /** 缺权限时直接给出「去开启」的入口，不用用户自己找。 */
  private void renderPermissions() {
    permissionsBox.removeAllViews();
    addPermissionRow(
        "精确闹钟",
        "没有它系统只能粗略唤醒，提醒可能晚几分钟。",
        !Alarms.canScheduleExact(this),
        () -> openExactAlarmSettings());
    addPermissionRow(
        "通知",
        "没有通知权限，到点不会弹出提醒（包括锁屏）。",
        !hasNotificationPermission(),
        () -> askNotificationPermission());
    addPermissionRow(
        "锁屏全屏提醒",
        "打开后锁屏时会直接把响铃界面顶到最前。",
        !AlarmReceiver.canUseFullScreenIntent(this),
        () -> openFullScreenIntentSettings());
    addPermissionRow(
        "后台不受限",
        "荣耀/华为机型建议在「应用启动管理」里允许后台活动，并把本应用加入电池优化白名单。",
        isBatteryOptimized(),
        () -> openBatterySettings());
  }

  private void addPermissionRow(String title, String hint, boolean show, Runnable action) {
    if (!show) return;
    LinearLayout row = Ui.row(this);
    // 用琥珀色而不是警示红：这是「还差一步」的提示，不是错误
    row.setBackground(Ui.background(Ui.SURFACE_2, 14f, 0x66F2A63C, this));
    int pad = Ui.dp(this, 14);
    row.setPadding(pad, Ui.dp(this, 12), pad, Ui.dp(this, 12));
    LinearLayout.LayoutParams rowParams =
        new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    rowParams.topMargin = Ui.dp(this, 8);
    row.setLayoutParams(rowParams);

    LinearLayout texts = new LinearLayout(this);
    texts.setOrientation(LinearLayout.VERTICAL);
    texts.addView(Ui.text(this, title, 14f, Ui.AMBER_TEXT, true));
    TextView hintView = Ui.text(this, hint, 12f, Ui.FG_DIM, false);
    hintView.setPadding(0, Ui.dp(this, 2), 0, 0);
    texts.addView(hintView);
    row.addView(texts, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

    TextView go = Ui.outline(this, "去开启", 13f, Ui.FG, Ui.LINE);
    go.setOnClickListener(view -> action.run());
    LinearLayout.LayoutParams goParams = Ui.wrap();
    goParams.leftMargin = Ui.dp(this, 10);
    row.addView(go, goParams);
    permissionsBox.addView(row);
  }

  /* ---------- 交互 ---------- */

  private void onMainClick() {
    long now = System.currentTimeMillis();
    String action = stopwatch.toggle(now);
    if ("paused".equals(action)) {
      history.add(stopwatch.elapsedMs(now), now);
      store.saveHistory(history);
    }
    renderAll();
  }

  private void onResetClick() {
    if (history.size() == 0) {
      performReset();
      return;
    }
    if (resetArmed) {
      performReset();
      return;
    }
    resetArmed = true;
    renderStopwatch();
    handler.postDelayed(
        () -> {
          resetArmed = false;
          renderStopwatch();
        },
        3000);
  }

  private void performReset() {
    resetArmed = false;
    stopwatch.reset();
    history.clear();
    store.saveHistory(history);
    renderAll();
  }

  private void onSubmit() {
    long now = System.currentTimeMillis();
    String label = labelInput.getText().toString().trim();
    if (label.isEmpty()) {
      toast("先写一句要提醒的事吧。");
      labelInput.requestFocus();
      return;
    }
    long durationMs = readInt(minutesInput, 0) * 60_000L + readInt(secondsInput, 0) * 1000L;
    if (durationMs < Countdowns.MIN_DURATION_MS) {
      toast("时长至少 1 秒。");
      return;
    }
    if (durationMs > Countdowns.MAX_DURATION_MS) {
      toast("最长只能设 24 小时。");
      return;
    }

    CountdownItem item = countdowns.add(label, durationMs, now);
    if (item == null) {
      toast("同时最多排 " + countdowns.limit() + " 项，先清掉几条吧。");
      return;
    }

    store.saveCountdowns(countdowns);
    Alarms.schedule(this, item);
    labelInput.setText("");
    renderAll();
    toast("已排入：" + Format.describeDuration(durationMs) + "后提醒「" + label + "」。");
  }

  private void onToggle(String id) {
    long now = System.currentTimeMillis();
    String state = countdowns.toggle(id, now);
    if (state == null) return;
    store.saveCountdowns(countdowns);
    if (CountdownItem.RUNNING.equals(state)) {
      CountdownItem item = countdowns.find(id);
      if (item != null) Alarms.schedule(this, item);
    } else {
      Alarms.cancel(this, id);
    }
    renderAll();
  }

  private void onRemove(String id) {
    Alarms.cancel(this, id);
    AlarmReceiver.stop(this, id);
    if (countdowns.remove(id)) {
      store.saveCountdowns(countdowns);
      renderAll();
    }
  }

  private void onRepeat(String id) {
    long now = System.currentTimeMillis();
    CountdownItem item = countdowns.repeat(id, now);
    if (item == null) {
      toast("同时最多排 " + countdowns.limit() + " 项，先清掉几条吧。");
      return;
    }
    store.saveCountdowns(countdowns);
    Alarms.schedule(this, item);
    renderAll();
    toast("已重新排入：" + Format.describeDuration(item.durationMs) + "后提醒。");
  }

  private int readInt(EditText field, int fallback) {
    try {
      return Integer.parseInt(field.getText().toString().trim());
    } catch (Exception error) {
      return fallback;
    }
  }

  /* ---------- 每 200 毫秒的对表 ---------- */

  private void tick() {
    long now = System.currentTimeMillis();
    if (!Stopwatch.IDLE.equals(stopwatch.state())) displayView.setText(Format.duration(stopwatch.elapsedMs(now)));
    renderCarryover();

    List<CountdownItem> fired = countdowns.sync(now);
    if (!fired.isEmpty()) {
      store.saveCountdowns(countdowns);
      CountdownItem first = null;
      for (CountdownItem item : fired) {
        if (!item.missed && first == null) first = item;
        if (item.missed) toast("错过了「" + item.label + "」，原定 " + Format.clock(item.firedAt) + " 提醒。");
      }
      renderAll();
      // 闹钟被系统丢掉时（比如刚开机）这里兜底响一次
      if (first != null && !isRinging()) {
        startActivity(
            new Intent(this, AlarmActivity.class)
                .putExtra(Alarms.EXTRA_ID, first.id)
                .putExtra(Alarms.EXTRA_LABEL, first.label));
      }
      return;
    }

    if (!"countdown".equals(mode)) return;
    for (Map.Entry<String, TextView> entry : timeViews.entrySet()) {
      CountdownItem item = countdowns.find(entry.getKey());
      if (item == null) continue;
      entry.getValue().setText(Format.remaining(item.remainingAt(now)));
      entry.getValue().setTextColor(rowAccent(item, now));
    }
    for (Map.Entry<String, View> entry : railFills.entrySet()) {
      CountdownItem item = countdowns.find(entry.getKey());
      if (item == null) continue;
      float weight = railWeight(item, now);
      LinearLayout parent = (LinearLayout) entry.getValue().getParent();
      if (parent == null || parent.getChildCount() < 2) continue;
      ((LinearLayout.LayoutParams) parent.getChildAt(0).getLayoutParams()).weight = weight;
      parent.getChildAt(0).getLayoutParams().width = 0;
      ((LinearLayout.LayoutParams) parent.getChildAt(1).getLayoutParams()).weight = 1f - weight;
      parent.getChildAt(1).getLayoutParams().width = 0;
      parent.requestLayout();
    }
  }

  private boolean isRinging() {
    return !new Store(this).pendingAlarms().isEmpty();
  }

  private boolean hasNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return true;
    return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
        == PackageManager.PERMISSION_GRANTED;
  }

  private void askNotificationPermission() {
    if (Build.VERSION.SDK_INT >= 33 && !hasNotificationPermission()) {
      requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
    }
  }

  @Override
  public void onRequestPermissionsResult(
      int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    renderPermissions();
  }

  private boolean isBatteryOptimized() {
    PowerManager manager = getSystemService(PowerManager.class);
    return manager == null || !manager.isIgnoringBatteryOptimizations(getPackageName());
  }

  private void openExactAlarmSettings() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        startActivity(
            new Intent(
                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:" + getPackageName())));
        return;
      } catch (Exception ignored) {
        // 落到应用详情页
      }
    }
    openAppDetails();
  }

  private void openFullScreenIntentSettings() {
    if (Build.VERSION.SDK_INT >= 34) {
      try {
        startActivity(
            new Intent(
                Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                Uri.parse("package:" + getPackageName())));
        return;
      } catch (Exception ignored) {
        // 落到应用详情页
      }
    }
    openAppDetails();
  }

  private void openBatterySettings() {
    try {
      startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
      toast("找到本应用并选择「不优化」，再到「应用启动管理」允许后台活动。");
    } catch (Exception error) {
      openAppDetails();
    }
  }

  private void openAppDetails() {
    try {
      startActivity(
          new Intent(
              Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
              Uri.parse("package:" + getPackageName())));
    } catch (Exception error) {
      toast("请到系统设置里手动开启。");
    }
  }

  private void toast(String message) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
  }
}

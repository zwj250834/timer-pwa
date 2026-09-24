package com.zwj.timer;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 颜色、圆角背景和小控件，统一在这里，界面代码就不必到处写样式。 */
public final class Ui {
  public static final int INK = Color.parseColor("#0D1A19");
  public static final int SURFACE = Color.parseColor("#152724");
  public static final int SURFACE_2 = Color.parseColor("#1D322E");
  public static final int FG = Color.parseColor("#EDF3ED");
  public static final int FG_DIM = Color.parseColor("#9AAFAA");
  public static final int LINE = Color.parseColor("#33E2F0E8");
  public static final int MINT = Color.parseColor("#63D8A8");
  public static final int MINT_INK = Color.parseColor("#06231A");
  public static final int AMBER = Color.parseColor("#F2A63C");
  public static final int AMBER_INK = Color.parseColor("#2B1704");
  public static final int AMBER_TEXT = Color.parseColor("#F2A63C");
  public static final int MINT_TEXT = Color.parseColor("#63D8A8");
  public static final int FLARE = Color.parseColor("#FF6F5C");
  public static final int FLARE_INK = Color.parseColor("#2B0D06");

  private Ui() {}

  public static int dp(Context context, float value) {
    return (int) TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics());
  }

  public static GradientDrawable background(int color, float radiusDp, int strokeColor, Context ctx) {
    GradientDrawable drawable = new GradientDrawable();
    drawable.setColor(color);
    drawable.setCornerRadius(dp(ctx, radiusDp));
    if (strokeColor != 0) drawable.setStroke(Math.max(1, dp(ctx, 1)), strokeColor);
    return drawable;
  }

  public static GradientDrawable pill(int color, int strokeColor, Context ctx) {
    GradientDrawable drawable = background(color, 999f, strokeColor, ctx);
    return drawable;
  }

  /** 一行文字：sizeSp 是字号，color 是字色，bold 决定字重。 */
  public static TextView text(Context context, String value, float sizeSp, int color, boolean bold) {
    TextView view = new TextView(context);
    view.setText(value);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
    view.setTextColor(color);
    if (bold) view.setTypeface(Typeface.SANS_SERIF, Typeface.BOLD);
    return view;
  }

  /** 大数字读数：等宽数字 + 轻微收紧的字距，跟网页版一致。 */
  public static TextView numerals(Context context, float sizeSp, int color) {
    TextView view = text(context, "", sizeSp, color, true);
    view.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
    view.setLetterSpacing(-0.02f);
    view.setFontFeatureSettings("tnum");
    view.setIncludeFontPadding(false);
    return view;
  }

  /** 主按钮：实心圆角。 */
  public static TextView button(Context context, String label, float sizeSp, int bg, int fg) {
    TextView view = text(context, label, sizeSp, fg, true);
    view.setGravity(Gravity.CENTER);
    view.setBackground(background(bg, 14f, 0, context));
    int padH = dp(context, 18);
    int padV = dp(context, 14);
    view.setPadding(padH, padV, padH, padV);
    view.setClickable(true);
    view.setFocusable(true);
    return view;
  }

  /** 次要按钮 / 小胶囊按钮。 */
  public static TextView outline(Context context, String label, float sizeSp, int fg, int stroke) {
    TextView view = text(context, label, sizeSp, fg, true);
    view.setGravity(Gravity.CENTER);
    view.setBackground(background(Color.TRANSPARENT, 999f, stroke, context));
    int padH = dp(context, 12);
    int padV = dp(context, 8);
    view.setPadding(padH, padV, padH, padV);
    view.setClickable(true);
    view.setFocusable(true);
    return view;
  }

  /** 卡片容器。 */
  public static LinearLayout card(Context context) {
    LinearLayout layout = new LinearLayout(context);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setBackground(background(SURFACE, 20f, LINE, context));
    int pad = dp(context, 16);
    layout.setPadding(pad, pad, pad, pad);
    return layout;
  }

  public static LinearLayout row(Context context) {
    LinearLayout layout = new LinearLayout(context);
    layout.setOrientation(LinearLayout.HORIZONTAL);
    layout.setGravity(Gravity.CENTER_VERTICAL);
    return layout;
  }

  public static void spacer(View view, int heightDp, Context context) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(context, heightDp));
    view.setLayoutParams(params);
  }

  public static LinearLayout.LayoutParams lp(int width, int height) {
    return new LinearLayout.LayoutParams(width, height);
  }

  public static LinearLayout.LayoutParams wrap() {
    return new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
  }

  public static LinearLayout.LayoutParams matchWidth(Context context, int heightDp) {
    return new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, dp(context, heightDp));
  }
}

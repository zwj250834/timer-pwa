# 计时器 Android 版

原生 Android 应用：正计时 + 多路倒计时提醒，**倒计时交给系统的 `AlarmManager.setAlarmClock()`**，
所以锁屏、息屏、Doze 状态下都会准点响铃——这是网页版永远做不到的部分（浏览器会被系统冻结，
推送又依赖网络，在部分网络下还收不到）。

## 它和网页版的关系

- 网页版（仓库根目录）继续保留，桌面浏览器和其它手机都能用。
- Android 版是独立实现：同样的交互和视觉，但底层换成原生闹钟 + 全屏响铃界面。
- 两边数据不互通（网页版存在 `localStorage`，Android 版存在 `SharedPreferences`）。

## 构建

不依赖 AndroidX / Compose，只需要 JDK 17 + Android SDK（compileSdk 34）。

```bash
cd android

# 1) 纯逻辑自测（只用 JDK，不需要 Android SDK，几秒出结果）
mkdir -p out
javac -encoding UTF-8 -d out app/src/main/java/com/zwj/timer/core/*.java tools/LogicTests.java
java -cp out LogicTests

# 2) 构建 APK（需要 Android SDK，或直接在 GitHub Actions 里构建）
gradle assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

本机没有 Android SDK 也没关系：推送到 `main` 后，
`.github/workflows/android.yml` 会在 GitHub 的机器上跑逻辑自测、构建 APK，
并把产物传到 Actions 的 Artifacts，同时更新一个固定地址的 Release：

```
https://github.com/zwj250834/timer-pwa/releases/download/android-latest/app-debug.apk
```

## 安装（荣耀 / 华为手机）

1. 手机浏览器打开上面的 APK 地址下载（或在电脑上下载后传到手机）。
2. 安装时系统会提示「外部来源应用」，允许一次即可。
3. 第一次打开应用，按界面上方的提示逐项授予：
   - **闹钟与提醒**（Android 12+）：没有它只能用不精确的闹钟，可能晚几分钟
   - **通知**（Android 13+）：没有它到点不会弹提醒
   - **锁屏全屏提醒**（Android 14+）：打开后锁屏时会直接把响铃界面顶到最前
   - **后台不受限**：在「应用启动管理」里允许后台活动，并把本应用加入电池优化白名单
     （荣耀/华为的省电策略比较激进，这一步很关键）

## 代码结构

```
app/src/main/java/com/zwj/timer/
  core/Format.java          时间格式化（纯逻辑）
  core/Stopwatch.java       正计时状态机（纯逻辑）
  core/History.java         历史记录（纯逻辑）
  core/CountdownItem.java   一条倒计时
  core/Countdowns.java      倒计时队列状态机（纯逻辑）
  core/LineStore.java       极简行式序列化（纯逻辑）
  MainActivity.java         界面：模式切换、倒计时输入、队列渲染、权限引导
  AlarmActivity.java        响铃界面（锁屏可见，声音 + 震动，多项排队）
  AlarmReceiver.java        到点接收器：标记已响铃、弹通知、拉起响铃界面
  BootReceiver.java         开机/更新后重新登记闹钟
  Alarms.java               AlarmManager 封装
  Notifications.java        通知渠道与通知样式
  Store.java                SharedPreferences 持久化
tools/LogicTests.java       纯逻辑自测（JDK 直接运行，无 JUnit 依赖）
```

`core/` 里的类刻意不引用任何 Android API，所以能用普通 JDK 编译并测试。

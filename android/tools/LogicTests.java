import com.zwj.timer.core.CountdownItem;
import com.zwj.timer.core.Countdowns;
import com.zwj.timer.core.Format;
import com.zwj.timer.core.History;
import com.zwj.timer.core.Stopwatch;

import java.util.Arrays;
import java.util.List;

/**
 * 纯逻辑自测：不依赖 Android SDK、JUnit 或任何第三方库，
 * 用 JDK 直接编译运行即可（见 android/README.md）。
 *
 *   javac -d out ../app/src/main/java/com/zwj/timer/core/*.java LogicTests.java
 *   java -cp out LogicTests
 */
public final class LogicTests {
  private static int passed;
  private static int failed;

  public static void main(String[] args) {
    stopwatchTests();
    historyTests();
    formatTests();
    countdownTests();
    lineStoreTests();

    System.out.println();
    System.out.println("通过 " + passed + " 项，失败 " + failed + " 项");
    if (failed > 0) System.exit(1);
  }

  private static void stopwatchTests() {
    Stopwatch watch = new Stopwatch();
    check("正计时初始为 idle", Stopwatch.IDLE.equals(watch.state()));
    check("初始读数为 0", watch.elapsedMs(1000) == 0);

    watch.start(1_000_000);
    check("开始后 state=running", Stopwatch.RUNNING.equals(watch.state()));
    check("读数随时间增长", watch.elapsedMs(1_002_500) == 2500);

    watch.pause(1_002_500);
    check("暂停后冻结读数", watch.elapsedMs(1_100_000) == 2500);

    watch.resume(1_100_000);
    check("继续后接着累加", watch.elapsedMs(1_100_500) == 3000);

    watch.reset();
    check("重置归零", watch.elapsedMs(2_000_000) == 0 && Stopwatch.IDLE.equals(watch.state()));

    // 系统时间回拨不应该产生负读数
    Stopwatch back = new Stopwatch();
    back.start(1_000_000);
    check("时间回拨不出负数", back.elapsedMs(900_000) >= 0);

    Stopwatch twice = new Stopwatch();
    twice.start(1_000_000);
    twice.start(1_000_500);
    check("重复 start 不清零", twice.elapsedMs(1_001_000) == 1000);
  }

  private static void historyTests() {
    History history = new History();
    for (int i = 0; i < 11; i++) history.add(1000 + i, 1_700_000_000_000L + i * 1000L);
    check("历史最多 10 条", history.size() == 10);
    check("最新的一条在最前", history.list().get(0).durationMs == 1010);
    check("最旧的一条被挤掉", history.list().get(9).durationMs == 1001);

    String firstId = history.list().get(0).id;
    check("按 id 删除", history.remove(firstId) && history.size() == 9);
    check("删不存在的返回 false", !history.remove("missing"));

    History restored = new History();
    restored.loadFrom(history.serializeLines());
    check("序列化可以往返", restored.size() == 9 && restored.list().get(0).durationMs == 1009);

    History dirty = new History();
    dirty.loadFrom(Arrays.asList("坏数据", "a\tb\tc", "id-1\t2500\t1700000000000"));
    check("脏数据被忽略，合法数据保留", dirty.size() == 1 && dirty.list().get(0).durationMs == 2500);
  }

  private static void formatTests() {
    check("duration 零点", "00:00:00.00".equals(Format.duration(0)));
    check("duration 进位", "01:01:01.23".equals(Format.duration(3_661_230)));
    check("duration 负数归零", "00:00:00.00".equals(Format.duration(-5)));

    check("remaining 向上取整", "00:01".equals(Format.remaining(1)));
    check("remaining 整分", "05:00".equals(Format.remaining(300_000)));
    check("remaining 跨小时", "1:01:01".equals(Format.remaining(3_661_000)));
    check("remaining 负数归零", "00:00".equals(Format.remaining(-100)));

    check("describeDuration 分钟", "5 分钟".equals(Format.describeDuration(300_000)));
    check("describeDuration 小时", "1 小时 30 分钟".equals(Format.describeDuration(5_400_000)));
    check("describeDuration 秒", "0 秒".equals(Format.describeDuration(0)));

    long base = 1_700_000_000_000L;
    check("endedAt 今天", Format.endedAt(base, base + 1000).startsWith("今天 "));
    check("endedAt 昨天", Format.endedAt(base, base + 86_400_000L).startsWith("昨天 "));
    check("clock 非法输入为空", Format.clock(0).isEmpty());
  }

  private static void countdownTests() {
    long base = 1_700_000_000_000L;
    Countdowns items = new Countdowns();
    check("空队列", items.size() == 0 && items.activeCount() == 0);

    CountdownItem a = items.add("关火", 300_000, base);
    CountdownItem b = items.add("吃药", 600_000, base + 60_000);
    check("同时排两条", items.size() == 2 && items.activeCount() == 2);
    check("最早的排在最前", items.list(base + 120_000).get(0).id.equals(a.id));
    check("剩余时间按墙钟推算", items.list(base + 120_000).get(0).remainingAt(base + 120_000) == 180_000);
    check("第二条也算对了", items.list(base + 120_000).get(1).remainingAt(base + 120_000) == 540_000);

    check("事项会被清洗", "关火 关窗".equals(Countdowns.normalizeLabel("  关火\n 关窗  ")));
    check("过短时长无效", items.add("x", 200, base) == null);
    check("超长时长封顶", Countdowns.normalizeDuration(Countdowns.MAX_DURATION_MS * 3)
        == Countdowns.MAX_DURATION_MS);

    check("暂停成功", items.pause(a.id, base + 120_000));
    check("暂停后剩余冻结", items.find(a.id).remainingAt(base + 600_000) == 180_000);
    check("继续后重新推算", items.resume(a.id, base + 600_000)
        && items.find(a.id).endsAt == base + 780_000);

    check("切换暂停", CountdownItem.PAUSED.equals(items.toggle(a.id, base + 600_000)));
    check("切换继续", CountdownItem.RUNNING.equals(items.toggle(a.id, base + 600_000)));

    List<CountdownItem> fired = items.sync(base + 700_000);
    check("到点只结算一次", fired.size() == 1 && fired.get(0).id.equals(b.id));
    check("结算后不再返回", items.sync(base + 700_000).isEmpty());
    check("已响铃排在最后", items.list(base + 700_000).get(items.size() - 1).id.equals(b.id));
    check("已响铃 activeCount 减一", items.activeCount() == 1);

    check("重复排一项", items.repeat(b.id, base + 700_000) != null && items.size() == 3);
    check("清掉已响铃", items.clearFired() && items.size() == 2);
    check("取消一条", items.remove(a.id) && items.size() == 1);

    // 超过宽限期算「错过」
    Countdowns late = new Countdowns();
    late.add("关火", 60_000, base);
    List<CountdownItem> missed = late.sync(base + 3 * 60 * 60 * 1000L);
    check("过期太久标记 missed", missed.size() == 1 && missed.get(0).missed);

    // 队列上限
    Countdowns capped = new Countdowns(2);
    check("上限内可添加", capped.add("a", 60_000, base) != null && capped.add("b", 60_000, base) != null);
    check("超过上限被拒", capped.add("c", 60_000, base) == null);

    // 序列化往返
    Countdowns roundTrip = new Countdowns();
    roundTrip.loadFrom(items.serializeLines());
    check("倒计时序列化往返", roundTrip.size() == items.size());

    // 脏数据
    Countdowns dirty = new Countdowns();
    dirty.loadFrom(Arrays.asList(
        "缺\t字段",
        "\t\trunning\t1000\t1700000060000\t0\t0\t0",
        "id-1\trunning\t关火\t300000\t1700000300000\t300000\t0\t0",
        "id-1\trunning\t重复 id\t300000\t1700000300000\t300000\t0\t0"));
    check("脏数据被剔除、重复 id 只留一条", dirty.size() == 1 && dirty.find("id-1") != null);

    check("nextDueAt 指向最近一条", dirty.nextDueAt(base) == 1_700_000_300_000L);
  }

  private static void lineStoreTests() {
    List<String> fields = Arrays.asList("a\tb", "换行\n在里", "反斜杠\\x", "普通");
    List<String> parsed = com.zwj.timer.core.LineStore.split(com.zwj.timer.core.LineStore.join(fields));
    check("字段转义往返", parsed.equals(fields));
    check("空字段保留", com.zwj.timer.core.LineStore.split("a\t\tb").size() == 3);
    check("空文本没有行", com.zwj.timer.core.LineStore.lines("").isEmpty());
  }

  private static void check(String name, boolean ok) {
    if (ok) {
      passed++;
      System.out.println("  ok   " + name);
    } else {
      failed++;
      System.out.println("  FAIL " + name);
    }
  }
}

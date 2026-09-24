# 计时器

零依赖的计时器 PWA，两种模式共用一个界面：

- **正计时**：秒表，开始 / 暂停 / 继续 / 重置，每次暂停写入一条历史记录，最多保留最近 10 条。
- **倒计时**：可以同时排多项，每项都写清「要提醒我什么」；到点响铃、震动、弹系统通知，并把提醒事项显示在全屏提醒层上。

左上角的分段按钮用来切换模式，当前模式会记住，下次打开还是它。

## 本地开发

```bash
npm test     # 纯逻辑单元测试（Node 内置 test runner，无依赖）
npm run dev  # 本地静态服务器，默认 http://localhost:8080
npm run build # 生成可部署的 dist/
npm run icons # 重新生成图标 PNG
```

需要 Node >= 22.8（测试用到了 `--experimental-test-isolation=none`，让测试文件在单进程内运行）。

## 手机上安装

必须是 https（或 localhost）才能启用 Service Worker 与「添加到主屏幕」：

1. 手机 Chrome 打开 `https://<用户名>.github.io/timer-pwa/`
2. 菜单 → 「添加到主屏幕」
3. 从桌面图标启动，独立窗口运行，飞行模式下也能打开并计时

也可以把 `dist/` 目录直接拖到任意静态托管（Cloudflare Pages、Vercel、Netlify 等）。

## 行为约定

### 正计时

- 读数按墙钟推算，切后台、锁屏都不会丢时间
- 暂停即写一条历史（值为该时刻的累计用时），最新记录在最上
- 第 11 条会挤掉最旧的一条，总数恒为 10
- 「重置」会把读数归零并清空历史；历史非空时需在 3 秒内点两次确认
- 切到倒计时模式时，如果正计时还在跑，界面上会留一条提示，不会悄悄消失

### 倒计时

- 多项同时计时，每项独立暂停 / 继续 / 取消；同时最多排 24 项，单项最长 24 小时
- 剩余时间同样按墙钟推算，界面每 250 毫秒对一次表，切后台也不会走偏
- 到点时：全屏提醒层 + 蜂鸣 + 震动 + 系统通知 + 应用图标角标，响 60 秒后自动停，也可以点「停止响铃」
- 多项同时到点会排队，停掉一项接着响下一项
- 关掉页面期间到点的：1 小时内算「刚刚」，下次打开会补响；超过 1 小时标记为「已错过」，只提示不响铃
- 已响铃的项留在列表里，可以「再来一次」或删除，也可以一次「清除已响铃」
- Android 上默认开启「熄屏也保持响铃」保活（见下），让关掉屏幕时也有机会准点响
- 想彻底解决熄屏提醒，可以部署 `worker/` 里的推送服务（见下），由系统推送叫醒手机
- 队列存在 `localStorage` 的 `timer.countdowns.v1`，模式存在 `timer.mode.v1`

### 熄屏提醒能做到什么

熄屏后浏览器会被系统冻结，网页里的定时器停摆，所以「关掉屏幕也准点响」在网页里是有边界的。

**先记一条走不通的路：网页没法唤起系统时钟 App 建闹钟。** 两条独立的限制叠在一起：

- Chrome 只允许唤起声明了 `BROWSABLE` category 的 Activity（这是它的安全规则），而时钟 App 的
  `SET_ALARM` 过滤器只声明了 `DEFAULT` 和 `VOICE` —— 那是留给语音助手的；
- 那个 Activity 还要求调用方持有 `com.android.alarm.permission.SET_ALARM`，而 Chrome 的清单里
  没有任何 alarm 权限。

所以任何 `intent://` 写法都绕不过去，本项目采用的办法是**保活**：

- 倒计时期间循环播放一段 -90 dB 左右、正常音量下听不见的音频。正在播放音频的标签页不会被
  Chrome 冻结，Android 也会因为音频流继续持有唤醒，页面因此有机会活到到点的那一刻，
  正常响铃、震动、弹通知。开关在倒计时面板底部，默认开；关掉能省电，但熄屏后可能不响。
- 保活必须由用户手势启动（浏览器的自动播放策略）。页面是重新打开、还没点过屏幕时，
  开关下面会直接提示「熄屏保持还没生效：点一下屏幕就能恢复」。
- 点「开始倒计时」时会申请一次通知权限，同意后到点会弹出常驻通知（直到你手动划掉）。
- 如果手机开了 Notification Triggers 实验特性，通知还能交给系统在指定时刻投递
  （代码里已实现 `showTrigger`，默认关闭，需要 `chrome://flags` 打开实验特性）。
- 倒计时进行中会申请屏幕唤醒锁，避免屏幕自己灭掉；听不到声音时（静音、未授权）震动和通知仍然生效。
- iOS 上没有保活这条路（后台会挂起 JS），熄屏提醒只能靠推送服务。

想做到「熄屏必响、跨机型都一样」只有一条路：接入 Web Push，由服务器在到点时刻投递推送，
系统唤醒 Service Worker 弹出通知。这需要一台服务器，见下一节。

## 熄屏提醒（自建推送服务，可选）

`worker/` 目录里是一个 Cloudflare Worker，负责「到点发推送」：手机锁屏、浏览器被冻结、
甚至应用没打开，推送都会由系统弹到通知栏（响铃 + 震动 + 常驻显示，直到你划掉）。
提醒时刻和事项只经过你自己的 Worker，不经过任何第三方。

### 一、部署 Worker（一次性，约 3 分钟）

```bash
cd worker
npx wrangler login      # 浏览器里点一下授权，免费账号即可
npx wrangler deploy
```

部署成功后会打印一行地址，形如 `https://timer-push.<你的子域名>.workers.dev`，复制它。
配置里已经声明好了 Durable Object（毫秒级定时）和每分钟一次的 cron 兜底，不需要手工建任何东西。

### 二、在应用里开启

1. 打开计时器 → 倒计时 → 展开「熄屏提醒（自建推送服务）」
2. 把上一步的地址粘进「Worker 地址」，点「开启熄屏提醒」，允许通知权限
3. 点「发测试提醒」，然后**锁屏**：几秒内应该弹出一条通知，这条能到就说明链路通了

开启之后，每新建一条倒计时都会自动登记到服务端；暂停会撤销，继续会重新登记，取消会删掉。
关掉开关时，Worker 上的订阅和提醒会被一并清除。

### 三、要注意的地方

- **中国大陆网络**：Android Chrome 的推送走 FCM（`fcm.googleapis.com`），在部分网络下不可达。
  所以第二步的「发测试提醒」是必须做的验证——收不到就说明这条路在你的网络下走不通，
  那就只能靠上面的保活 + 前台响铃。
- **成本**：Cloudflare 免费额度足够个人使用（Worker 10 万次请求/天、Durable Object 按请求计）。
- **精度**：到点时刻用 Durable Object 的 alarm 触发，秒级；cron 每分钟兜底补发。
- 迟到超过 6 小时的提醒不会再补发，避免早上醒来被昨晚的提醒刷屏。
- 推送服务返回 410/404（订阅失效，例如重装浏览器）时，Worker 会自动清掉那条订阅和它的提醒。

### 四、接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/config` | 返回 VAPID 公钥（首次访问时自动生成并保存） |
| POST | `/schedule` | `{ subscription, reminder: { id, at, label } }` 登记提醒 |
| POST | `/cancel` | `{ id }` 撤销一条 |
| POST | `/cancel-all` | `{ endpoint }` 清掉该订阅的全部提醒 |
| POST | `/test` | `{ subscription }` 立刻发一条测试推送 |

只放行 `https://zwj250834.github.io` 与本机 `localhost`/`127.0.0.1` 的跨域请求。


## 部署

推送到 `main` 分支后，`.github/workflows/deploy-pages.yml` 会跑测试、构建 `dist/` 并发布到 GitHub Pages。

### 首次部署需要的一次性设置

新建仓库的 `GITHUB_TOKEN` 默认只有只读权限，无法自行创建 Pages 站点，
所以第一次需要在仓库网页上点两下（都在 Settings 里）：

1. **Settings → Actions → General → Workflow permissions**
   选「Read and write permissions」→ Save。
2. **Settings → Pages → Build and deployment → Source**
   选「GitHub Actions」。

完成后往 `main` 推一次（或重跑失败的 workflow），站点就会发布到
`https://<用户名>.github.io/timer-pwa/`。

## 目录

```
index.html / styles.css        界面
src/timer.js                   正计时状态机（纯逻辑）
src/countdown.js               多路倒计时队列与持久化（纯逻辑）
src/alarm.js                   蜂鸣、震动、系统通知（可注入依赖的平台封装）
src/keep-alive.js              熄屏保活：生成极低电平音频并维持后台播放
src/push.js                    自建推送服务的接入（订阅、登记、撤销）
src/history.js                 历史记录与持久化（纯逻辑）
src/format.js                  时间格式化（纯逻辑）
src/reset-guard.js             重置二次确认（纯逻辑）
src/app.js                     DOM 绑定与渲染
sw.js                          应用外壳缓存 + 推送通知的处理
scripts/                       零依赖的开发服务器、构建、图标生成
worker/                        Cloudflare Worker：Web Push 加密、VAPID、精确定时
tests/                         node:test 单元测试
```

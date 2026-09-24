# 计时器

零依赖的正计时秒表 PWA。开始 / 暂停 / 继续 / 重置，每次暂停写入一条历史记录，最多保留最近 10 条并存在手机本地。

## 本地开发

```bash
npm test     # 纯逻辑单元测试（Node 内置 test runner，无依赖）
npm run dev  # 本地静态服务器，默认 http://localhost:8080
npm run build # 生成可部署的 dist/
npm run icons # 重新生成图标 PNG
```

需要 Node >= 22.8（测试用到了 `--test-isolation=none`）。

## 手机上安装

必须是 https（或 localhost）才能启用 Service Worker 与「添加到主屏幕」：

1. 手机 Chrome 打开 `https://<用户名>.github.io/timer-pwa/`
2. 菜单 → 「添加到主屏幕」
3. 从桌面图标启动，独立窗口运行，飞行模式下也能打开并计时

也可以把 `dist/` 目录直接拖到任意静态托管（Cloudflare Pages、Vercel、Netlify 等）。

## 行为约定

- 读数按墙钟推算，切后台、锁屏都不会丢时间
- 暂停即写一条历史（值为该时刻的累计用时），最新记录在最上
- 第 11 条会挤掉最旧的一条，总数恒为 10
- 「重置」会把读数归零并清空历史；历史非空时需在 3 秒内点两次确认
- 历史存在 `localStorage` 的 `timer.history.v1`，每条可单独删除

## 部署

推送到 `main` 分支后，`.github/workflows/deploy-pages.yml` 会跑测试、构建 `dist/` 并发布到 GitHub Pages。

## 目录

```
index.html / styles.css        界面
src/timer.js                   计时状态机（纯逻辑）
src/history.js                 历史记录与持久化（纯逻辑）
src/format.js                  时间格式化（纯逻辑）
src/reset-guard.js             重置二次确认（纯逻辑）
src/app.js                     DOM 绑定与渲染
sw.js                          应用外壳缓存
scripts/                       零依赖的开发服务器、构建、图标生成
tests/                         node:test 单元测试
```

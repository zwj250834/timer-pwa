/* 应用外壳缓存。__CACHE_VERSION__ 由 dev-server / build 脚本替换。 */
const CACHE_NAME = 'timer-__CACHE_VERSION__';
const APP_SHELL = new URL('./index.html', self.location.href).href;
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/timer.js',
  './src/countdown.js',
  './src/alarm.js',
  './src/keep-alive.js',
  './src/push.js',
  './src/history.js',
  './src/format.js',
  './src/reset-guard.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：优先联网拿最新外壳，失败时回落到已缓存的 index.html。
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(APP_SHELL, response.clone());
          }
          return response;
        } catch (error) {
          const cached = await caches.match(APP_SHELL);
          if (cached) return cached;
          throw error;
        }
      })()
    );
    return;
  }

  // 静态资源：缓存优先，未命中再联网并存入缓存。
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});

/**
 * 服务端推送：这是唯一能在手机锁屏、页面被冻结时把用户叫醒的通道。
 * 负载由 worker 加密发送，这里解密后直接交给系统通知栏，锁屏也会响铃震动。
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '时间到', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || '时间到', {
      body: data.body || '',
      tag: data.tag || 'timer-push',
      icon: new URL('./icons/icon-192.png', self.location.href).href,
      badge: new URL('./icons/icon-192.png', self.location.href).href,
      // 常驻显示，直到用户自己划掉：闹钟性质的提醒不该自己消失
      requireInteraction: true,
      vibrate: [600, 350, 600, 350, 600, 1200],
      data: { url: data.url || './' },
    })
  );
});

/** 点通知：已经在看这个应用就切过去，否则打开它。 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.href).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});

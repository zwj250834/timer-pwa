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

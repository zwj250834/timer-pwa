#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 8080);
const DEV_CACHE_VERSION = `dev-${Date.now().toString(36)}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveTarget(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const target = resolve(join(ROOT, relative));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  return target;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let target = resolveTarget(url.pathname);
  if (!target) {
    send(res, 403, 'Forbidden');
    return;
  }

  let body;
  try {
    body = await readFile(target);
  } catch {
    const fallback = resolveTarget(join(url.pathname, 'index.html'));
    if (!fallback) {
      send(res, 404, 'Not Found');
      return;
    }
    try {
      body = await readFile(fallback);
      target = fallback;
    } catch {
      send(res, 404, 'Not Found');
      return;
    }
  }

  const ext = extname(target).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';

  if (ext === '.js' && target.endsWith(`sw.js`)) {
    body = Buffer.from(
      body.toString('utf8').replaceAll('__CACHE_VERSION__', DEV_CACHE_VERSION),
      'utf8'
    );
  }

  if (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest') {
    res.setHeader('Service-Worker-Allowed', '/');
  }

  res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': type });
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(PORT, () => {
  console.log(`计时器开发服务器已启动：http://localhost:${PORT}`);
  console.log('手机联调：把 localhost 换成本机局域网 IP（注意非安全上下文下 Service Worker 不生效）。');
  console.log('按 Ctrl+C 退出。');
});

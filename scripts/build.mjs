#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const FILES = ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest'];
const DIRS = ['src', 'icons'];

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

async function contentHash() {
  const files = (await walk(DIST)).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(DIST, file).split('\\').join('/'));
    hash.update(await readFile(file));
  }
  return hash.digest('hex').slice(0, 12);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const file of FILES) {
  await cp(join(ROOT, file), join(DIST, file));
}
for (const dir of DIRS) {
  await cp(join(ROOT, dir), join(DIST, dir), { recursive: true });
}

// 缓存名 = 内容哈希，只有内容变化时 Service Worker 才会重新预缓存。
const version = await contentHash();
const swPath = join(DIST, 'sw.js');
const swSource = await readFile(swPath, 'utf8');
await writeFile(swPath, swSource.replaceAll('__CACHE_VERSION__', version), 'utf8');

// 若改用「分支部署」模式，.nojekyll 可避免下划线开头的资源被 Jekyll 忽略。
await writeFile(join(DIST, '.nojekyll'), '');

console.log(`构建完成：${DIST}`);
console.log(`Service Worker 缓存版本：${version}`);

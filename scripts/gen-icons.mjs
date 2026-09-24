#!/usr/bin/env node
/**
 * 零依赖生成 PWA 图标 PNG（不借助任何图形库）。
 * 图形：圆角深色底 + 青色秒表环 + 顶部按钮 + 白色指针。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = join(ROOT, 'icons');

const BG = [11, 18, 32];
const ACCENT = [34, 211, 238];
const HANDS = [248, 250, 252];

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([length, payload, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 绘制 ---------- */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const coverage = (distance, aa) => clamp01(0.5 - distance / aa);

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const sdRing = (px, py, cx, cy, r, width) => Math.abs(sdCircle(px, py, cx, cy, r)) - width / 2;

function sdRoundRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    radius
  );
}

function sdCapsule(px, py, ax, ay, bx, by, radius) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom === 0 ? 0 : clamp01((pax * bax + pay * bay) / denom);
  return Math.hypot(pax - bax * h, pay - bay * h) - radius;
}

function createCanvas(size) {
  return { size, r: new Float64Array(size * size), g: new Float64Array(size * size), b: new Float64Array(size * size), a: new Float64Array(size * size), cov: new Float64Array(size * size) };
}

/** 把 shape 的覆盖度写入 cov（0..1）。 */
function shape(canvas, distanceAt, aa) {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      canvas.cov[y * canvas.size + x] = coverage(distanceAt(x + 0.5, y + 0.5), aa);
    }
  }
}

/** 用颜色 color 以 cov 为源 alpha 做 source-over 合成，并清空 cov。 */
function paint(canvas, [cr, cg, cb]) {
  const { r, g, b, a, cov } = canvas;
  for (let i = 0; i < cov.length; i += 1) {
    const src = cov[i];
    cov[i] = 0;
    if (src <= 0) continue;
    const dstA = a[i];
    const outA = src + dstA * (1 - src);
    if (outA <= 0) continue;
    const keep = (dstA * (1 - src)) / outA;
    const add = src / outA;
    r[i] = cr * add + r[i] * keep;
    g[i] = cg * add + g[i] * keep;
    b[i] = cb * add + b[i] * keep;
    a[i] = outA;
  }
}

function toRgba(canvas) {
  const out = Buffer.alloc(canvas.size * canvas.size * 4);
  for (let i = 0; i < canvas.a.length; i += 1) {
    const alpha = canvas.a[i];
    out[i * 4] = Math.round(clamp01(canvas.r[i] / 255) * 255);
    out[i * 4 + 1] = Math.round(clamp01(canvas.g[i] / 255) * 255);
    out[i * 4 + 2] = Math.round(clamp01(canvas.b[i] / 255) * 255);
    out[i * 4 + 3] = Math.round(clamp01(alpha) * 255);
  }
  return out;
}

/**
 * @param size 画布边长
 * @param rounded true 时画圆角矩形底（普通图标），false 时铺满整块（maskable / iOS）
 * @param glyphScale 秒表图形占画布高度的比例
 */
function renderIcon(size, { rounded, glyphScale }) {
  const canvas = createCanvas(size);
  const aa = Math.max(1, size / 256);
  const center = size / 2;

  // 底
  if (rounded) {
    const radius = size * 0.22;
    shape(canvas, (px, py) => sdRoundRect(px, py, center, center, center, center, radius), aa);
  } else {
    shape(canvas, (px, py) => sdRoundRect(px, py, center, center, center, center, 0), aa);
  }
  paint(canvas, BG);

  // 秒表环的半径：让整体图形高度（含顶部按钮）落在 glyphScale 内
  const GLYPH_HALF_HEIGHT = 1.2; // 以环外半径为 1 的归一化单位
  const ringRadius = (glyphScale * size) / 2 / GLYPH_HALF_HEIGHT;
  const ringWidth = ringRadius * 0.17;
  const cx = center;
  const cy = center + ringRadius * 0.1; // 顶部按钮占位，整体视觉居中

  // 顶部按钮
  shape(
    canvas,
    (px, py) => {
      const top = cy - ringRadius - ringWidth * 0.35;
      return sdCapsule(px, py, cx, top, cx, top - ringRadius * 0.24, ringRadius * 0.1);
    },
    aa
  );
  paint(canvas, ACCENT);

  // 环
  shape(canvas, (px, py) => sdRing(px, py, cx, cy, ringRadius, ringWidth), aa);
  paint(canvas, ACCENT);

  // 指针：12 点方向与 4 点方向
  shape(canvas, (px, py) => {
    const a = sdCapsule(px, py, cx, cy, cx, cy - ringRadius * 0.62, ringRadius * 0.085);
    const angle = (2 * Math.PI) / 3; // 从 12 点顺时针 120° = 4 点
    const bx = cx + Math.sin(angle) * ringRadius * 0.46;
    const by = cy - Math.cos(angle) * ringRadius * 0.46;
    const b = sdCapsule(px, py, cx, cy, bx, by, ringRadius * 0.07);
    return Math.min(a, b);
  }, aa);
  paint(canvas, HANDS);

  // 中心圆点
  shape(canvas, (px, py) => sdCircle(px, py, cx, cy, ringRadius * 0.11), aa);
  paint(canvas, ACCENT);

  return toRgba(canvas);
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, options: { rounded: true, glyphScale: 0.74 } },
  { file: 'icon-512.png', size: 512, options: { rounded: true, glyphScale: 0.74 } },
  { file: 'maskable-512.png', size: 512, options: { rounded: false, glyphScale: 0.62 } },
  { file: 'apple-touch-icon.png', size: 180, options: { rounded: false, glyphScale: 0.72 } },
];

await mkdir(OUT_DIR, { recursive: true });
for (const target of TARGETS) {
  const rgba = renderIcon(target.size, target.options);
  const outPath = join(OUT_DIR, target.file);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, encodePng(target.size, rgba));
  console.log(`已生成 ${target.file} (${target.size}x${target.size})`);
}

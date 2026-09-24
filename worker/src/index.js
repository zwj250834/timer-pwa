/**
 * 计时器的推送服务（Cloudflare Worker）。
 *
 * 存在的原因：网页在锁屏后会被系统冻结，页面内的定时器停摆，只有服务端推送能叫醒设备。
 * 前端把「什么时候提醒、提醒什么」交给这里，到点由 Worker 发一条 Web Push，
 * 手机的系统通知栏负责响铃、震动、常驻显示。
 *
 * 定时精度用 Durable Object 的 alarm（毫秒级），另外挂了一个每分钟的 cron 作为兜底，
 * 万一某次 alarm 被漏掉，一分钟内也会补上。
 */

import { generateVapidKeys, sendPushNotification } from './webpush.js';

const STATE_KEY = 'state';
/** 单个订阅最多排多少条提醒。 */
export const MAX_REMINDERS_PER_SUBSCRIPTION = 50;
/** 最多保存多少个订阅（个人自用，防滥用）。 */
export const MAX_SUBSCRIPTIONS = 200;
/** 早于这个时间还没发出去的提醒直接丢弃，不再补发。 */
const EXPIRE_AFTER_MS = 6 * 60 * 60 * 1000;
/** 允许的提前量：注册提醒时最多提前 25 小时。 */
const MAX_LEAD_MS = 25 * 60 * 60 * 1000;
/** 允许的迟到量：网络往返 + 时钟误差的余量。 */
const MAX_LAG_MS = 2 * 60 * 1000;
const MAX_LABEL_LENGTH = 60;
const MAX_ID_LENGTH = 64;
/** 长期没更新的订阅清掉，避免存储无限增长。 */
const SUBSCRIPTION_IDLE_MS = 180 * 24 * 60 * 60 * 1000;

const PLACEHOLDER_LABEL = '未填写事项';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function clockOf(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 允许来源：自己的 Pages 站点 + 本地开发。 */
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === 'https://zwj250834.github.io') return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeadersFor(origin) {
  if (!isAllowedOrigin(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function decodeBase64UrlLength(text) {
  try {
    const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return atob(padded).length;
  } catch {
    return -1;
  }
}

/** 校验浏览器传来的 PushSubscription.toJSON()。 */
export function normalizeSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
  const keys = raw.keys ?? {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';
  if (!endpoint.startsWith('https://')) return null;
  if (decodeBase64UrlLength(p256dh) !== 65) return null;
  if (decodeBase64UrlLength(auth) !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** 校验一条提醒。 */
export function normalizeReminder(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || id.length > MAX_ID_LENGTH) return null;
  const at = Number(raw.at);
  if (!Number.isFinite(at)) return null;
  if (at < now - MAX_LAG_MS || at > now + MAX_LEAD_MS) return null;
  const label = typeof raw.label === 'string' ? raw.label.replace(/\s+/g, ' ').trim() : '';
  return { id, at: Math.floor(at), label: label.slice(0, MAX_LABEL_LENGTH) };
}

export function buildPushPayload(reminder, now = Date.now()) {
  return JSON.stringify({
    title: `时间到：${reminder.label || PLACEHOLDER_LABEL}`,
    body: `现在 ${clockOf(now)}，这条提醒到点了。`,
    tag: `countdown-${reminder.id}`,
    url: './',
    at: reminder.at,
  });
}

/**
 * 所有数据都存在一个 Durable Object 里：VAPID 密钥、订阅、待发提醒。
 * 个人自用的量级，用一个实例 + 一份 JSON 就够，省掉 KV 之类的额外组件。
 */
export class Reminders {
  constructor(state, env = {}) {
    this.state = state;
    this.env = env;
    /** 测试或独立调用时可以注入 fetch 与时钟。 */
    this.fetchImpl = env.fetchImpl;
    this.now = env.now ?? (() => Date.now());
  }

  async load() {
    const stored = await this.state.storage.get(STATE_KEY);
    return stored ?? { vapid: null, subscriptions: {}, reminders: {} };
  }

  async save(data) {
    await this.state.storage.put(STATE_KEY, data);
  }

  async vapidKeys(data) {
    if (!data.vapid) {
      data.vapid = await generateVapidKeys();
      await this.save(data);
    }
    return data.vapid;
  }

  subject() {
    return this.env.subject ?? 'https://timer-push.invalid';
  }

  /** 下一次该醒来的时刻：最早一条待发提醒；没有就取消 alarm。 */
  async rescheduleAlarm(data) {
    const times = Object.values(data.reminders).map((item) => item.at);
    if (!times.length) {
      await this.state.storage.deleteAlarm();
      return;
    }
    const next = Math.min(...times);
    await this.state.storage.setAlarm(Math.max(next, this.now() + 50));
  }

  /** 清掉过期的、长期没人用的数据，避免存储无限长大。 */
  prune(data, now) {
    for (const [id, item] of Object.entries(data.reminders)) {
      if (item.at < now - EXPIRE_AFTER_MS) delete data.reminders[id];
    }
    const active = new Set(Object.values(data.reminders).map((item) => item.endpoint));
    for (const [endpoint, entry] of Object.entries(data.subscriptions)) {
      const idle = now - (entry.updatedAt ?? 0) > SUBSCRIPTION_IDLE_MS;
      if (idle && !active.has(endpoint)) delete data.subscriptions[endpoint];
    }
  }

  /** 把到点的提醒发出去，返回统计。 */
  async deliverDue(data, now = this.now()) {
    const due = Object.values(data.reminders).filter((item) => item.at <= now);
    const stats = { sent: 0, failed: 0, gone: 0, dropped: 0 };
    const deadEndpoints = new Set();

    for (const reminder of due) {
      delete data.reminders[reminder.id];
      if (reminder.at < now - EXPIRE_AFTER_MS) {
        stats.dropped += 1;
        continue;
      }
      const entry = data.subscriptions[reminder.endpoint];
      if (!entry) {
        stats.dropped += 1;
        continue;
      }
      const result = await sendPushNotification({
        subscription: entry.subscription,
        payload: buildPushPayload(reminder, now),
        vapid: { ...data.vapid, subject: this.subject() },
        fetchImpl: this.fetchImpl,
        now,
      });
      if (result.ok) stats.sent += 1;
      else stats.failed += 1;
      if (result.gone) deadEndpoints.add(reminder.endpoint);
    }

    if (deadEndpoints.size) {
      stats.gone = deadEndpoints.size;
      for (const endpoint of deadEndpoints) delete data.subscriptions[endpoint];
      for (const [id, item] of Object.entries(data.reminders)) {
        if (deadEndpoints.has(item.endpoint)) delete data.reminders[id];
      }
    }

    this.prune(data, now);
    await this.save(data);
    await this.rescheduleAlarm(data);
    return stats;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const now = this.now();
    const data = await this.load();
    this.prune(data, now);

    if (request.method === 'GET' && (path === '/' || path === '/config')) {
      const vapid = await this.vapidKeys(data);
      return json({
        ok: true,
        publicKey: vapid.publicKey,
        reminders: Object.keys(data.reminders).length,
        subscriptions: Object.keys(data.subscriptions).length,
      });
    }

    if (request.method === 'POST' && path === '/schedule') {
      const body = await request.json().catch(() => null);
      const subscription = normalizeSubscription(body?.subscription);
      const reminder = normalizeReminder(body?.reminder, now);
      if (!subscription || !reminder) {
        return json({ ok: false, error: 'subscription 或 reminder 不合法' }, 400);
      }
      const isNew = !data.subscriptions[subscription.endpoint];
      if (isNew && Object.keys(data.subscriptions).length >= MAX_SUBSCRIPTIONS) {
        return json({ ok: false, error: '订阅数量已达上限' }, 429);
      }
      const mine = Object.values(data.reminders).filter(
        (item) => item.endpoint === subscription.endpoint && item.id !== reminder.id
      );
      if (mine.length >= MAX_REMINDERS_PER_SUBSCRIPTION) {
        return json({ ok: false, error: '待提醒数量已达上限' }, 429);
      }

      await this.vapidKeys(data);
      data.subscriptions[subscription.endpoint] = { subscription, updatedAt: now };
      data.reminders[reminder.id] = { ...reminder, endpoint: subscription.endpoint };
      await this.save(data);
      await this.rescheduleAlarm(data);
      return json({ ok: true, at: reminder.at });
    }

    if (request.method === 'POST' && path === '/cancel') {
      const body = await request.json().catch(() => null);
      const id = typeof body?.id === 'string' ? body.id.trim() : '';
      if (!id) return json({ ok: false, error: '缺少 id' }, 400);
      if (data.reminders[id]) {
        delete data.reminders[id];
        await this.save(data);
        await this.rescheduleAlarm(data);
      }
      return json({ ok: true });
    }

    if (request.method === 'POST' && path === '/cancel-all') {
      const body = await request.json().catch(() => null);
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
      if (!endpoint) return json({ ok: false, error: '缺少 endpoint' }, 400);
      let removed = 0;
      for (const [id, item] of Object.entries(data.reminders)) {
        if (item.endpoint === endpoint) {
          delete data.reminders[id];
          removed += 1;
        }
      }
      delete data.subscriptions[endpoint];
      await this.save(data);
      await this.rescheduleAlarm(data);
      return json({ ok: true, removed });
    }

    if (request.method === 'POST' && path === '/test') {
      const body = await request.json().catch(() => null);
      const subscription = normalizeSubscription(body?.subscription);
      if (!subscription) return json({ ok: false, error: 'subscription 不合法' }, 400);

      const vapid = await this.vapidKeys(data);
      data.subscriptions[subscription.endpoint] = { subscription, updatedAt: now };
      await this.save(data);

      const result = await sendPushNotification({
        subscription,
        payload: buildPushPayload({ id: 'test', label: '测试提醒', at: now }, now),
        vapid: { ...vapid, subject: this.subject() },
        fetchImpl: this.fetchImpl,
        now,
      });
      return json({ ok: result.ok, status: result.status, gone: result.gone }, result.ok ? 200 : 502);
    }

    if (request.method === 'POST' && path === '/sweep') {
      const stats = await this.deliverDue(data, now);
      return json({ ok: true, ...stats });
    }

    return json({ ok: false, error: '未知路径' }, 404);
  }

  /** Durable Object 的定时器：到点发推送，然后排下一次。 */
  async alarm() {
    const data = await this.load();
    await this.deliverDue(data, this.now());
  }
}

function doStub(env) {
  return env.REMINDERS.get(env.REMINDERS.idFromName('main'));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const cors = corsHeadersFor(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    }
    // 没带 Origin 的请求（curl、健康检查）放行；带了但不认识的挡掉。
    if (origin && !cors) return json({ ok: false, error: 'origin 不被允许' }, 403);

    const url = new URL(request.url);
    if (url.pathname === '/') {
      return json(
        {
          ok: true,
          service: 'timer-push',
          routes: ['GET /config', 'POST /schedule', 'POST /cancel', 'POST /cancel-all', 'POST /test'],
        },
        200,
        cors ?? {}
      );
    }

    const response = await doStub(env).fetch(new Request(`https://do${url.pathname}`, request));
    return new Response(response.body, {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), ...(cors ?? {}) },
    });
  },

  /** cron 兜底：每分钟扫一次，补上可能被漏掉的 alarm。 */
  async scheduled(event, env, ctx) {
    const task = doStub(env).fetch('https://do/sweep', { method: 'POST' });
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
  },
};

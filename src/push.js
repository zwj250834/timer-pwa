/**
 * 把倒计时登记到自建的推送服务（Cloudflare Worker），到点由系统推送叫醒手机。
 *
 * 这里只负责「跟浏览器要一条推送订阅」和「跟 Worker 说什么时候提醒什么」，
 * 平台相关的部分都可以注入，方便在 Node 里测试。
 */

export const PUSH_KEY = 'timer.push.v1';

/** 把用户填的地址整理成规范的 Worker 地址；不合法返回空串。 */
export function normalizeWorkerUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return '';
  }
  const localDev = url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !localDev) return '';
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** 请求体形状，单独抽出来方便测试与排查。 */
export function buildScheduleBody(subscription, reminder) {
  return {
    subscription,
    reminder: {
      id: String(reminder.id),
      at: Math.floor(Number(reminder.at)),
      label: String(reminder.label ?? ''),
    },
  };
}

async function defaultRequestPermission(NotificationCtor) {
  if (typeof NotificationCtor !== 'function') return 'unsupported';
  if (NotificationCtor.permission === 'granted') return 'granted';
  if (typeof NotificationCtor.requestPermission !== 'function') return 'unsupported';
  try {
    return await NotificationCtor.requestPermission();
  } catch {
    return 'unsupported';
  }
}

/** 默认的订阅方式：用 Worker 给的公钥订阅，并要一条 endpoint。 */
async function defaultSubscribe(registration, publicKey) {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: publicKey,
  });
}

export function createPushClient({
  storage = globalThis.localStorage,
  fetchImpl = (...args) => globalThis.fetch(...args),
  getRegistration = () => globalThis.navigator?.serviceWorker?.ready,
  NotificationCtor = globalThis.Notification,
  requestPermission = (ctor) => defaultRequestPermission(ctor),
  subscribe = defaultSubscribe,
} = {}) {
  let subscription = null;

  function readConfig() {
    try {
      const raw = storage?.getItem(PUSH_KEY);
      if (!raw) return { url: '', enabled: false };
      const parsed = JSON.parse(raw);
      return {
        url: typeof parsed?.url === 'string' ? parsed.url : '',
        enabled: parsed?.enabled === true,
      };
    } catch {
      return { url: '', enabled: false };
    }
  }

  function writeConfig(config) {
    try {
      storage?.setItem(PUSH_KEY, JSON.stringify(config));
    } catch {
      /* 记不住设定不影响本次使用 */
    }
  }

  async function registration() {
    const ready = await getRegistration();
    if (!ready?.pushManager) throw new Error('这个浏览器不支持推送');
    return ready;
  }

  async function currentSubscription() {
    if (subscription) return subscription;
    const reg = await registration();
    const existing = await reg.pushManager.getSubscription();
    if (existing) subscription = existing;
    return subscription;
  }

  async function post(url, path, body) {
    const response = await fetchImpl(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok === true, data };
  }

  /** 开启：先确认地址能用（拿公钥），再要权限、订阅、存配置。 */
  async function enable(rawUrl) {
    const url = normalizeWorkerUrl(rawUrl);
    if (!url) return { ok: false, error: '地址看起来不对，应该是 https://…workers.dev 这样的形式。' };

    let publicKey = '';
    try {
      const response = await fetchImpl(`${url}/config`, { method: 'GET' });
      if (!response.ok) throw new Error(String(response.status));
      const config = await response.json();
      publicKey = typeof config?.publicKey === 'string' ? config.publicKey : '';
    } catch {
      return { ok: false, error: '连不上这个地址，检查一下 Worker 地址或它是否已部署。' };
    }
    if (!publicKey) return { ok: false, error: '这个地址没有返回有效的公钥，确认填的是本项目的 Worker。' };

    // 地址确认可用之后再弹权限框，免得用户填错地址还要白点一次许可。
    const permission = await requestPermission(NotificationCtor);
    if (permission !== 'granted') {
      return {
        ok: false,
        error:
          permission === 'unsupported'
            ? '这个浏览器不支持通知，没法用熄屏提醒。'
            : '需要允许通知权限才能用熄屏提醒。',
      };
    }

    try {
      const reg = await registration();
      const created = await subscribe(reg, publicKey);
      subscription = created?.toJSON ? created.toJSON() : created;
    } catch (error) {
      return { ok: false, error: `订阅失败：${error?.message ?? error}` };
    }

    writeConfig({ url, enabled: true });
    return { ok: true, url };
  }

  /** 把一条倒计时登记到服务端。 */
  async function schedule(reminder) {
    const config = readConfig();
    if (!config.enabled || !config.url) return { ok: false, skipped: true };
    try {
      const current = await currentSubscription();
      if (!current) return { ok: false, error: '推送订阅不存在了，重新开启一次。' };
      const result = await post(
        config.url,
        '/schedule',
        buildScheduleBody(current.toJSON ? current.toJSON() : current, reminder)
      );
      if (!result.ok) {
        return { ok: false, error: result.data?.error ?? `服务端返回 ${result.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `同步失败：${error?.message ?? error}` };
    }
  }

  async function cancel(id) {
    const config = readConfig();
    if (!config.enabled || !config.url) return { ok: false, skipped: true };
    try {
      const result = await post(config.url, '/cancel', { id: String(id) });
      return { ok: result.ok, error: result.ok ? undefined : `服务端返回 ${result.status}` };
    } catch (error) {
      return { ok: false, error: `取消失败：${error?.message ?? error}` };
    }
  }

  /** 发一条测试提醒，用来确认「锁屏能不能收到」。 */
  async function test() {
    const config = readConfig();
    if (!config.url) return { ok: false, error: '先填 Worker 地址再开一次。' };
    try {
      const current = await currentSubscription();
      if (!current) return { ok: false, error: '推送订阅不存在了，重新开启一次。' };
      const result = await post(config.url, '/test', {
        subscription: current.toJSON ? current.toJSON() : current,
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.data?.error ?? `推送服务返回 ${result.status}，检查 Worker 日志。`,
        };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `发送失败：${error?.message ?? error}` };
    }
  }

  /** 关闭：让服务端忘掉这个订阅，并退订。 */
  async function disable() {
    const config = readConfig();
    try {
      const current = await currentSubscription();
      if (current) {
        if (config.url) {
          await post(config.url, '/cancel-all', {
            endpoint: (current.toJSON ? current.toJSON() : current).endpoint,
          }).catch(() => {});
        }
        await current.unsubscribe?.();
      }
    } catch {
      /* 退订失败也要把本地状态清掉 */
    }
    subscription = null;
    writeConfig({ url: config.url, enabled: false });
    return { ok: true };
  }

  return {
    config: readConfig,
    enable,
    disable,
    schedule,
    cancel,
    test,
    currentSubscription,
  };
}

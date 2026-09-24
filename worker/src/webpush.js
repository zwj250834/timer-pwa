/**
 * Web Push 的加密与签名：RFC 8291（aes128gcm）+ RFC 8292（VAPID）。
 *
 * 只依赖 WebCrypto，没有任何 npm 包，因此可以直接跑在 Cloudflare Workers 上。
 * 加密流程与 RFC 8291 附录 A 的测试向量逐字节对齐（见 tests/webpush.test.js）。
 */

const encoder = new TextEncoder();
/** Node 的 WebCrypto 要求 HMAC 明确带上 hash，写全更保险。 */
const HMAC_SHA256 = { name: 'HMAC', hash: 'SHA-256' };

/** 记录大小：一条推送最大 4096 字节，正好是 RFC 里的默认值。 */
export const RECORD_SIZE = 4096;
/** aes128gcm 的分隔符：最后一条记录用 0x02。 */
const LAST_RECORD = 2;

export function base64UrlEncode(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text) {
  const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function concatBytes(...chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function uint32BigEndian(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

/** HKDF-Extract：PRK = HMAC(key = salt, message = ikm)。 */
export async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, HMAC_SHA256, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}

/** HKDF-Expand（只用到第一块，长度 ≤ 32 足够）。 */
export async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey('raw', prk, HMAC_SHA256, false, ['sign']);
  const block = await crypto.subtle.sign('HMAC', key, concatBytes(info, new Uint8Array([1])));
  return new Uint8Array(block).slice(0, length);
}

export async function hkdf(salt, ikm, info, length) {
  return hkdfExpand(await hkdfExtract(salt, ikm), info, length);
}

/** 把「WebPush: info\0」这类 info 串按 RFC 的写法拼出来（末尾带一个 0）。 */
function infoString(text) {
  return concatBytes(encoder.encode(text), new Uint8Array([0]));
}

/**
 * 由 ECDH 共享密钥推出内容加密用的 CEK 与 NONCE。
 * 两步 HKDF：先用 auth_secret 把共享密钥和双方公钥混进 IKM，再用 salt 分出 CEK/NONCE。
 */
export async function deriveKeyMaterial({ uaPublic, asPublic, authSecret, ecdhSecret, salt }) {
  const keyInfo = concatBytes(infoString('WebPush: info'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, infoString('Content-Encoding: aes128gcm'), 16);
  const nonce = await hkdf(salt, ikm, infoString('Content-Encoding: nonce'), 12);
  return { ikm, cek, nonce };
}

/** 用客户端的 p256dh/auth 加密一条推送负载，返回完整的 aes128gcm 报文。 */
export async function encryptPayload({
  payload,
  uaPublic,
  authSecret,
  salt,
  serverKeys,
  recordSize = RECORD_SIZE,
}) {
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const clientKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256)
  );

  const { cek, nonce } = await deriveKeyMaterial({
    uaPublic,
    asPublic,
    authSecret,
    ecdhSecret,
    salt,
  });

  const header = concatBytes(
    salt,
    uint32BigEndian(recordSize),
    new Uint8Array([asPublic.length]),
    asPublic
  );
  const plaintext = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const padded = concatBytes(plaintext, new Uint8Array([LAST_RECORD]));

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded)
  );

  return concatBytes(header, ciphertext);
}

/** 生成一对 VAPID 密钥：publicKey 是给浏览器的 65 字节未压缩公钥（base64url）。 */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = base64UrlEncode(
    concatBytes(
      new Uint8Array([4]),
      base64UrlDecode(privateKey.x),
      base64UrlDecode(privateKey.y)
    )
  );
  return { publicKey, privateKey: { ...privateKey, ext: true } };
}

/** VAPID 的 JWT：ES256 签名，aud 取推送服务的 origin。 */
export async function createVapidJwt({
  endpoint,
  privateKey,
  subject,
  expiresInSeconds = 12 * 60 * 60,
  now = Date.now(),
}) {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + expiresInSeconds,
        sub: subject,
      })
    )
  );
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    'jwk',
    privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput))
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function createVapidHeader({ endpoint, publicKey, privateKey, subject, now }) {
  const jwt = await createVapidJwt({ endpoint, privateKey, subject, now });
  return `vapid t=${jwt}, k=${publicKey}`;
}

/**
 * 发一条推送。subscription 就是浏览器里 PushSubscription.toJSON() 的结果。
 * 返回 gone=true 表示推送服务说这条订阅已经失效（404/410），调用方应该删掉它。
 */
export async function sendPushNotification({
  subscription,
  payload,
  vapid,
  ttl = 3600,
  urgency = 'high',
  fetchImpl = globalThis.fetch,
  now = Date.now(),
}) {
  const uaPublic = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);

  const body = await encryptPayload({ payload, uaPublic, authSecret, salt, serverKeys });
  const authorization = await createVapidHeader({
    endpoint: subscription.endpoint,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
    subject: vapid.subject,
    now,
  });

  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      authorization,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(ttl),
      urgency,
    },
    body,
  });

  return {
    status: response.status,
    ok: response.ok === true,
    gone: response.status === 404 || response.status === 410,
  };
}

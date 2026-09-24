import assert from 'node:assert/strict';
import test from 'node:test';

import {
  base64UrlDecode,
  base64UrlEncode,
  concatBytes,
  createVapidHeader,
  createVapidJwt,
  deriveKeyMaterial,
  encryptPayload,
  generateVapidKeys,
  hkdf,
  hkdfExtract,
  sendPushNotification,
} from '../worker/src/webpush.js';

/** RFC 8291 附录 A 的官方测试向量（base64url 里的换行已去掉）。 */
const RFC8291 = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  ecdhSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  prkKey: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLoc' +
    'InmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLV' +
    'WGNWQexSgSxsj_Qulcy4a-fN',
};

async function importServerKeys(privateKey, publicKeyBase64Url) {
  const publicRaw = base64UrlDecode(publicKeyBase64Url);
  const privateKeyObject = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      ext: true,
      d: privateKey,
      x: base64UrlEncode(publicRaw.slice(1, 33)),
      y: base64UrlEncode(publicRaw.slice(33, 65)),
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const publicKeyObject = await crypto.subtle.importKey(
    'raw',
    publicRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
  return { privateKey: privateKeyObject, publicKey: publicKeyObject };
}

test('base64url 编解码与 RFC 4648 一致', () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x3e, 0x3f]);
  assert.equal(base64UrlEncode(bytes), '-_8APj8');
  assert.deepEqual([...base64UrlDecode('-_8APj8')], [...bytes]);
  assert.deepEqual([...base64UrlDecode(base64UrlEncode(bytes))], [...bytes]);
  assert.equal(base64UrlEncode(new Uint8Array([1, 2, 3])), 'AQID');
});

test('RFC 8291 测试向量：ECDH 共享密钥', async () => {
  const { privateKey, publicKey } = await importServerKeys(RFC8291.asPrivate, RFC8291.asPublic);
  const clientKey = await crypto.subtle.importKey(
    'raw',
    base64UrlDecode(RFC8291.uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, privateKey, 256)
  );
  assert.equal(base64UrlEncode(secret), RFC8291.ecdhSecret);

  // 公钥也能原样导出，说明后面写进报文头的 keyid 是一样的东西
  assert.deepEqual(
    [...new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))],
    [...base64UrlDecode(RFC8291.asPublic)]
  );
});

test('RFC 8291 测试向量：HKDF 各步中间值', async () => {
  const ecdhSecret = base64UrlDecode(RFC8291.ecdhSecret);
  const authSecret = base64UrlDecode(RFC8291.authSecret);
  const salt = base64UrlDecode(RFC8291.salt);

  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  assert.equal(base64UrlEncode(prkKey), RFC8291.prkKey);

  const { ikm, cek, nonce } = await deriveKeyMaterial({
    uaPublic: base64UrlDecode(RFC8291.uaPublic),
    asPublic: base64UrlDecode(RFC8291.asPublic),
    authSecret,
    ecdhSecret,
    salt,
  });
  assert.equal(base64UrlEncode(ikm), RFC8291.ikm);
  assert.equal(base64UrlEncode(cek), RFC8291.cek);
  assert.equal(base64UrlEncode(nonce), RFC8291.nonce);

  const prk = await hkdfExtract(salt, ikm);
  assert.equal(base64UrlEncode(prk), RFC8291.prk);

  // 直接调 hkdf 也应该得到同一把 CEK
  const cekDirect = await hkdf(
    salt,
    ikm,
    concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0])),
    16
  );
  assert.equal(base64UrlEncode(cekDirect), RFC8291.cek);
});

test('RFC 8291 测试向量：整条报文逐字节一致', async () => {
  const serverKeys = await importServerKeys(RFC8291.asPrivate, RFC8291.asPublic);
  const body = await encryptPayload({
    payload: RFC8291.plaintext,
    uaPublic: base64UrlDecode(RFC8291.uaPublic),
    authSecret: base64UrlDecode(RFC8291.authSecret),
    salt: base64UrlDecode(RFC8291.salt),
    serverKeys,
  });
  assert.equal(base64UrlEncode(body), RFC8291.body);
});

test('加密报文的结构：salt + 记录大小 + 公钥长度 + 公钥', async () => {
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload({
    payload: 'hello',
    uaPublic: base64UrlDecode(RFC8291.uaPublic),
    authSecret: base64UrlDecode(RFC8291.authSecret),
    salt,
    serverKeys,
  });

  assert.deepEqual([...body.slice(0, 16)], [...salt]);
  assert.deepEqual([...body.slice(16, 20)], [0, 0, 0x10, 0], '记录大小 4096（大端）');
  assert.equal(body[20], 65, '公钥长度');
  assert.equal(body[21], 4, '未压缩点前缀');
  assert.equal(body.length, 86 + 5 + 1 + 16, '头部 86 字节 + 明文 5 + 分隔符 + GCM tag');
});

test('generateVapidKeys: 公钥是 65 字节未压缩点，且与私钥配对', async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  const raw = base64UrlDecode(publicKey);
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4);

  // 用私钥签一段数据，再用公钥验签，确认两者配对
  const signKey = await crypto.subtle.importKey(
    'jwk',
    privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const verifyKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const data = new TextEncoder().encode('vapid');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, data);
  assert.equal(
    await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, signature, data),
    true
  );
});

test('VAPID JWT: 结构正确且签名可用公钥验证', async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
  const now = 1_700_000_000_000;
  const jwt = await createVapidJwt({
    endpoint,
    privateKey,
    subject: 'https://timer-push.example.workers.dev',
    now,
  });

  const [headerPart, claimsPart, signaturePart] = jwt.split('.');
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(claimsPart)));

  assert.deepEqual(header, { typ: 'JWT', alg: 'ES256' });
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, Math.floor(now / 1000) + 12 * 3600);
  assert.equal(claims.sub, 'https://timer-push.example.workers.dev');

  const verifyKey = await crypto.subtle.importKey(
    'raw',
    base64UrlDecode(publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${claimsPart}`)
  );
  assert.equal(valid, true);
});

test('VAPID 请求头格式', async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  const header = await createVapidHeader({
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz',
    publicKey,
    privateKey,
    subject: 'mailto:me@example.com',
    now: 1_700_000_000_000,
  });
  assert.match(header, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.ok(header.endsWith(`k=${publicKey}`));
});

test('sendPushNotification: 请求头、加密体与失效订阅判定', async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  const calls = [];

  const result = await sendPushNotification({
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
    },
    payload: JSON.stringify({ title: '时间到：关火' }),
    vapid: { publicKey, privateKey, subject: 'https://example.workers.dev' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 201, ok: true };
    },
    now: 1_700_000_000_000,
  });

  assert.equal(result.status, 201);
  assert.equal(result.ok, true);
  assert.equal(result.gone, false);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fcm.googleapis.com/fcm/send/abc123');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-encoding'], 'aes128gcm');
  assert.equal(calls[0].init.headers.urgency, 'high');
  assert.equal(calls[0].init.headers.ttl, '3600');
  assert.match(calls[0].init.headers.authorization, /^vapid t=/);
  assert.ok(calls[0].init.body instanceof Uint8Array);
  assert.equal(calls[0].init.body[20], 65, '报文头里的公钥长度');
});

test('sendPushNotification: 404/410 表示订阅已失效', async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  const vapid = { publicKey, privateKey, subject: 'https://example.workers.dev' };
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/gone',
    keys: { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
  };

  for (const status of [404, 410]) {
    const result = await sendPushNotification({
      subscription,
      payload: '{}',
      vapid,
      fetchImpl: async () => ({ status, ok: false }),
    });
    assert.equal(result.gone, true, `${status} 应判定为失效`);
    assert.equal(result.ok, false);
  }
});

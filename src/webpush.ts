import { fromBase64Url, toBase64Url } from './env';

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidConfig {
  publicKey: string;
  privateJwk: string;
  subject: string;
}

const encoder = new TextEncoder();
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** RFC 8291 aes128gcm encryption of a payload for one subscription. */
export async function encrypt(subscription: PushSubscriptionJson, payload: string): Promise<Uint8Array> {
  const clientPublic = fromBase64Url(subscription.keys.p256dh);
  const auth = fromBase64Url(subscription.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const localPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const clientKey = await crypto.subtle.importKey('raw', clientPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(encoder.encode('WebPush: info\0'), clientPublic, localPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(encoder.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  return concat(header, localPublic, cipher);
}

async function vapidAuthorization(endpoint: string, vapid: VapidConfig): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(vapid.privateJwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (value: object) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${vapid.publicKey}`;
}

/** Sends a push; returns the push service HTTP status (404/410 mean the subscription is gone). */
export async function sendPush(subscription: PushSubscriptionJson, payload: object, vapid: VapidConfig): Promise<number> {
  const body = await encrypt(subscription, JSON.stringify(payload));
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  return response.status;
}

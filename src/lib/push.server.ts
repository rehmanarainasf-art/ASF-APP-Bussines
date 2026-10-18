// Minimal Web Push sender built on WebCrypto only (no Node APIs), so it also runs on Cloudflare Workers.
// VAPID: RFC 8292. Payload encryption: RFC 8291 (aes128gcm, RFC 8188).

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

const enc = new TextEncoder();

export function b64uToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function bytesToB64u(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, length * 8));
}

function ecJwk(publicRaw: Uint8Array, d?: Uint8Array): JsonWebKey {
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: bytesToB64u(publicRaw.slice(1, 33)), y: bytesToB64u(publicRaw.slice(33, 65)), ext: true };
  if (d) jwk.d = bytesToB64u(d);
  return jwk;
}

/** Encrypts a payload for one subscription. `fixed` exists only so the RFC 8291 test vector can be checked. */
export async function encryptPayload(sub: PushSubscriptionJson, payload: Uint8Array, fixed?: { asPrivate: Uint8Array; asPublic: Uint8Array; salt: Uint8Array }): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(sub.keys.p256dh);
  const authSecret = b64uToBytes(sub.keys.auth);
  let asPublic: Uint8Array; let asPrivateKey: CryptoKey;
  if (fixed) {
    asPublic = fixed.asPublic;
    asPrivateKey = await crypto.subtle.importKey('jwk', ecJwk(fixed.asPublic, fixed.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    asPrivateKey = pair.privateKey;
  }
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256));
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aes, buf(concat(payload, new Uint8Array([2])))));
  const header = concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic);
  return concat(header, cipher);
}

async function vapidAuthorization(endpoint: string, vapid: VapidConfig): Promise<string> {
  const publicRaw = b64uToBytes(vapid.publicKey);
  const key = await crypto.subtle.importKey('jwk', ecJwk(publicRaw, b64uToBytes(vapid.privateKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${bytesToB64u(sig)}, k=${vapid.publicKey}`;
}

export type PushResult = { ok: boolean; status: number; gone: boolean };

export async function sendWebPush(sub: PushSubscriptionJson, message: unknown, vapid: VapidConfig, opts: { ttl?: number; urgency?: 'low' | 'normal' | 'high' } = {}): Promise<PushResult> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 60),
      Urgency: opts.urgency ?? 'high',
    },
    body: buf(body),
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

import { notifyPeer, removePushSubscription, savePushSubscription } from './push.functions';

const VAPID_PUBLIC = (import.meta.env['VITE_VAPID_PUBLIC_KEY'] as string | undefined) ?? '';

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const bin = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export type PushOutcome = 'on' | 'denied' | 'unsupported' | 'not-configured' | 'failed';

/** Asks permission (needs a tap), subscribes this device and stores it against the signed-in account. */
export async function enablePush(): Promise<PushOutcome> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC) return 'not-configured';
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  return syncPushSubscription();
}

/** Makes sure the stored subscription belongs to the current account (also used silently after sign-in). */
export async function syncPushSubscription(): Promise<PushOutcome> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC) return 'not-configured';
  if (Notification.permission !== 'granted') return 'denied';
  try {
    const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
    const json = sub.toJSON();
    const p256dh = json.keys?.['p256dh']; const auth = json.keys?.['auth'];
    if (!json.endpoint || !p256dh || !auth) return 'failed';
    await savePushSubscription({ data: { endpoint: json.endpoint, keys: { p256dh, auth } } });
    return 'on';
  } catch { return 'failed'; }
}

export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await removePushSubscription({ data: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* ignore */ }
}

export async function pushIsOn() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try { return !!(await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription()); } catch { return false; }
}

/** Fire-and-forget: tells the other person's devices about a new message or call. */
export function firePush(args: { toId: string; kind: 'message' | 'call'; video?: boolean; text?: string; media?: string | null }) {
  const { media, ...rest } = args;
  void notifyPeer({ data: { ...rest, ...(media ? { media } : {}) } }).catch(() => { /* best effort */ });
}

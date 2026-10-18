// Ringtones, ringback ("tone-tone") and message tones.
// Custom sounds are chosen from the device (gallery / music) and stored per account in IndexedDB.
export type ToneKind = 'ringtone' | 'messageTone';
export type StoredTone = { blob: Blob; name: string };

/* ---------------- shared audio context ---------------- */
let ctx: AudioContext | null = null;
function audioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}
// Browsers only allow sound after a tap/click, so unlock the context on the first interaction.
if (typeof window !== 'undefined') {
  const unlock = () => { audioContext(); };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock, { passive: true });
}

function beep(c: AudioContext, freqs: number[], at: number, dur: number, vol = 0.2, type: OscillatorType = 'sine') {
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(vol, at + 0.02);
  gain.gain.setValueAtTime(vol, Math.max(at + 0.02, at + dur - 0.04));
  gain.gain.linearRampToValueAtTime(0.0001, at + dur);
  gain.connect(c.destination);
  for (const f of freqs) {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.connect(gain);
    o.start(at); o.stop(at + dur + 0.05);
  }
}

/* ---------------- IndexedDB storage for custom tones ---------------- */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('asf-sounds', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('tones'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const cache = new Map<string, StoredTone | null>();
const keyOf = (uid: string, kind: ToneKind) => `${uid}:${kind}`;

export async function loadTone(uid: string, kind: ToneKind): Promise<StoredTone | null> {
  const k = keyOf(uid, kind);
  if (cache.has(k)) return cache.get(k) ?? null;
  try {
    const db = await openDb();
    const value = await new Promise<StoredTone | null>((resolve, reject) => {
      const r = db.transaction('tones').objectStore('tones').get(k);
      r.onsuccess = () => resolve((r.result as StoredTone | undefined) ?? null);
      r.onerror = () => reject(r.error);
    });
    db.close(); cache.set(k, value); return value;
  } catch { return null; }
}

export async function saveTone(uid: string, kind: ToneKind, file: File): Promise<void> {
  if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) throw new Error('Choose an audio file (MP3, M4A, WAV, OGG…).');
  if (file.size > 8 * 1024 * 1024) throw new Error('The sound must be smaller than 8 MB.');
  const tone: StoredTone = { blob: file, name: file.name };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('tones', 'readwrite'); tx.objectStore('tones').put(tone, keyOf(uid, kind));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close(); cache.set(keyOf(uid, kind), tone);
}

export async function removeTone(uid: string, kind: ToneKind): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('tones', 'readwrite'); tx.objectStore('tones').delete(keyOf(uid, kind));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close(); cache.set(keyOf(uid, kind), null);
}

/* ---------------- looping ring sounds ---------------- */
let stopCurrent: (() => void) | null = null;

export function stopRinging() {
  stopCurrent?.(); stopCurrent = null;
  try { navigator.vibrate?.(0); } catch { /* not supported */ }
}

function synthLoop(play: (c: AudioContext, at: number) => void, periodSeconds: number): () => void {
  const c = audioContext(); if (!c) return () => {};
  const run = () => play(c, c.currentTime + 0.05);
  run();
  const id = setInterval(run, periodSeconds * 1000);
  return () => clearInterval(id);
}

/** Caller hears this while the other phone is calling/ringing: "tone … tone". */
export function startRingback() {
  stopRinging();
  stopCurrent = synthLoop((c, t) => { beep(c, [425, 450], t, 0.45, 0.16); beep(c, [425, 450], t + 0.65, 0.45, 0.16); }, 3.2);
}

/** The receiver's incoming-call ringtone: their own chosen sound, or a built-in melody. */
export async function startRingtone(uid: string) {
  stopRinging();
  const custom = await loadTone(uid, 'ringtone');
  if (custom) {
    const url = URL.createObjectURL(custom.blob);
    const el = new Audio(url); el.loop = true; el.volume = 1;
    const stop = () => { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); };
    // A newer ring request may have started while the file was loading.
    stopCurrent = stop;
    try { await el.play(); } catch { /* blocked until the user interacts; notification still shows */ }
  } else {
    stopCurrent = synthLoop((c, t) => {
      [[880, 0], [1175, 0.2], [988, 0.4], [1175, 0.6], [880, 1.2], [1175, 1.4], [988, 1.6], [1175, 1.8]].forEach(([f, d]) => beep(c, [f as number], t + (d as number), 0.17, 0.22, 'triangle'));
    }, 3.6);
  }
  try { navigator.vibrate?.([700, 350, 700, 350, 700]); } catch { /* not supported */ }
  const vib = setInterval(() => { try { navigator.vibrate?.([700, 350, 700]); } catch { /* ignore */ } }, 3600);
  const prev = stopCurrent;
  stopCurrent = () => { clearInterval(vib); prev?.(); };
}

/** Plays once for a new message. */
export async function playMessageTone(uid: string) {
  const custom = await loadTone(uid, 'messageTone');
  if (custom) {
    const url = URL.createObjectURL(custom.blob);
    const el = new Audio(url); el.volume = 1;
    const done = () => URL.revokeObjectURL(url);
    el.onended = done; setTimeout(() => { el.pause(); done(); }, 8000);
    try { await el.play(); } catch { done(); }
    return;
  }
  const c = audioContext(); if (!c) return;
  const t = c.currentTime + 0.02;
  beep(c, [988], t, 0.12, 0.2); beep(c, [1319], t + 0.14, 0.2, 0.2);
}

/** Preview helper for the settings screen. */
export async function previewTone(uid: string, kind: ToneKind) {
  if (kind === 'messageTone') { await playMessageTone(uid); return; }
  await startRingtone(uid);
  const stop = stopCurrent;
  setTimeout(() => { if (stopCurrent === stop) stopRinging(); }, 4500);
}

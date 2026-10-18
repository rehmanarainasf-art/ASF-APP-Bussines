import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Music, Play, RotateCcw, Upload, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAsf } from '@/lib/asf-context';
import { loadTone, previewTone, removeTone, saveTone, stopRinging, type ToneKind } from '@/lib/sounds';
import { disablePush, enablePush, pushIsOn, pushSupported } from '@/lib/push-client';

function ToneRow({ kind, title, hint }: { kind: ToneKind; title: string; hint: string }) {
  const { user } = useAsf();
  const [name, setName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const uid = user?.id;
  useEffect(() => { setName(null); if (uid) void loadTone(uid, kind).then((t) => setName(t?.name ?? null)); }, [uid, kind]);
  useEffect(() => () => stopRinging(), []);
  if (!uid) return null;
  return <div className="setting-line">
    <div>{title}<p>{name ?? 'Default ASF sound'} · {hint}</p></div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input ref={input} type="file" accept="audio/*,video/*" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        try { await saveTone(uid, kind, file); setName(file.name); toast.success(`${title} saved`); void previewTone(uid, kind); } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save the sound'); }
      }} />
      <Button size="sm" variant="outline" onClick={() => input.current?.click()}><Upload size={14} />Choose</Button>
      <Button size="sm" variant="ghost" aria-label={`Play ${title}`} onClick={() => void previewTone(uid, kind)}><Play size={14} /></Button>
      {name && <Button size="sm" variant="ghost" aria-label="Use default sound" onClick={async () => { await removeTone(uid, kind); setName(null); toast.success('Default sound restored'); }}><RotateCcw size={14} /></Button>}
    </div>
  </div>;
}

export function SoundSettings() {
  const { prefs, setPrefs, profile } = useAsf();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushIsOn().then(setOn); }, []);
  async function turnOn() {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    if (r === 'on') { setOn(true); setPrefs({ ...prefs, nPush: true }); toast.success('Notifications will arrive even when ASF is closed.'); }
    else if (r === 'denied') toast.error('Notifications are blocked. Allow them in your browser or phone settings for this site.');
    else if (r === 'unsupported') toast.info('This browser cannot show closed-app notifications. On iPhone, add ASF to the Home Screen first.');
    else if (r === 'not-configured') toast.error('Push keys are missing. Add VITE_VAPID_PUBLIC_KEY and the VAPID secrets.');
    else toast.error('Could not turn on notifications. Please try again.');
  }
  async function turnOff() { await disablePush(); setOn(false); setPrefs({ ...prefs, nPush: false }); toast.success('Closed-app notifications are off on this device.'); }
  return <>
    <h3 className="settings-sub">Notifications when the app is closed</h3>
    <div className="setting-line">
      <div>Push notifications<p>{pushSupported() ? (on ? 'On for this device — messages and calls arrive even when ASF is closed.' : 'Off — turn on to get messages and calls with the app closed.') : 'Not supported in this browser. Use Chrome, Edge or Safari (installed to the Home Screen).'}</p></div>
      <div className="flex gap-2">
        {on ? <Button size="sm" variant="outline" onClick={() => void turnOff()}>Turn off</Button> : <Button size="sm" disabled={busy || !pushSupported()} onClick={() => void turnOn()}><BellRing size={14} />Turn on</Button>}
        {on && <Button size="sm" variant="ghost" onClick={() => void navigator.serviceWorker.ready.then((r) => r.showNotification('ASF', { body: `Test notification for ${profile?.asf_number ?? 'your account'}`, icon: '/icons/icon-192.png', tag: 'asf-test' }))}>Test</Button>}
      </div>
    </div>
    <h3 className="settings-sub"><Music size={14} className="mr-1 inline" />Sounds</h3>
    <ToneRow kind="ringtone" title="Call ringtone" hint="Plays on this device when someone calls you" />
    <ToneRow kind="messageTone" title="Message tone" hint="Plays when a new message arrives" />
    <p className="mt-2 text-xs text-muted-foreground">Pick any song or sound from your gallery, music or files (up to 8 MB). It is saved on this device for your account only. With the app fully closed, the phone’s own notification sound is used — the web cannot play a custom ringtone in the background.</p>
  </>;
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAsf } from './asf-context';
import { startRingback, startRingtone, stopRinging } from './sounds';
import { firePush } from './push-client';

import { CallContext, type CallPeer, type CallState, type CallLog } from './call-context-value';
export { useCall } from './call-context-value';
export type { CallPeer, CallLog } from './call-context-value';

// Public STUN works on the same network. Calls between different networks (mobile data <-> Wi-Fi) need a TURN relay:
// set VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL (see .env). The free open relay below is only a fallback.
function buildIce(): RTCConfiguration {
  const env = import.meta.env as Record<string, string | undefined>;
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  if (env['VITE_TURN_URL']) servers.push({ urls: env['VITE_TURN_URL'].split(',').map((u) => u.trim()).filter(Boolean), username: env['VITE_TURN_USERNAME'] ?? '', credential: env['VITE_TURN_CREDENTIAL'] ?? '' });
  servers.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' });
  return { iceServers: servers, iceCandidatePoolSize: 4 };
}
const IDLE: CallState = { phase: 'idle', callId: null, peer: null, video: false, startedAt: null };

export function CallProvider({ children }: { children: ReactNode }) {
  const { user, data, saveData, prefs } = useAsf();
  const [call, setCall] = useState<CallState>(IDLE);
  const [localStream, setLocal] = useState<MediaStream | null>(null);
  const [remoteStream, setRemote] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const callRef = useRef(call); callRef.current = call;
  const dataRef = useRef(data); dataRef.current = data;
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const offer = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const declined = useRef(false);
  const screen = useRef<MediaStreamTrack | null>(null);
  const remote = useRef<MediaStream | null>(null);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingAlert = useRef<Notification | null>(null);
  const [sharing, setSharing] = useState(false);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const userId = user?.id;

  const chatWith = useCallback(async (peerId: string) => {
    if (!user) return null;
    const [a, b] = [user.id, peerId].sort();
    if (!a || !b) return null;
    const r = await supabase.from('direct_chats').select('id').eq('user_a', a).eq('user_b', b).maybeSingle();
    return r.data?.id ?? null;
  }, [user]);

  const sendText = useCallback(async (text: string) => {
    const c = callRef.current; if (!c.peer || !user) return;
    const id = await chatWith(c.peer.id); if (!id) { toast.error('Chat not found'); return; }
    const r = await supabase.from('direct_messages').insert({ chat_id: id, sender_id: user.id, body: text });
    if (r.error) toast.error(r.error.message); else { toast.success('Sent'); firePush({ toId: c.peer.id, kind: 'message', text }); }
  }, [user, chatWith]);

  const log = useCallback((entry: Omit<CallLog, 'id' | 'at'>) => {
    const d = dataRef.current;
    const list = ((d['calls'] as CallLog[] | undefined) ?? []);
    saveData({ ...d, calls: [{ id: crypto.randomUUID(), at: Date.now(), ...entry }, ...list].slice(0, 200) });
  }, [saveData]);

  const signal = useCallback(async (to: string, callId: string, kind: string, payload: unknown = {}, video = false) => {
    if (!user) return;
    const r = await supabase.from('call_signals').insert({ call_id: callId, from_id: user.id, to_id: to, kind, video, payload: payload as Json });
    if (r.error) throw new Error(r.error.message);
  }, [user]);

  const cleanup = useCallback((logIt?: Omit<CallLog, 'id' | 'at'>) => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    if (dropTimer.current) clearTimeout(dropTimer.current);
    dropTimer.current = null;
    pc.current?.close(); pc.current = null;
    remote.current = null;
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null;
    incomingAlert.current?.close(); incomingAlert.current = null;
    offer.current = null; pendingIce.current = [];
    setLocal(null); setRemote(null); setMuted(false); setCameraOff(false);
    screen.current?.stop(); screen.current = null; setSharing(false);
    const c = callRef.current;
    if (c.peer && c.callId && !c.incoming && user) {
      const body = c.startedAt ? `answered:${Math.round((Date.now() - c.startedAt) / 1000)}` : declined.current ? 'declined' : 'missed';
      const peerId = c.peer.id; const type = c.video ? 'call/video' : 'call/voice';
      void chatWith(peerId).then(async (chat) => { if (!chat) throw new Error('Chat not found'); const result = await supabase.from('direct_messages').insert({ chat_id: chat, sender_id: user.id, body, media_type: type }); if (result.error) throw result.error; }).catch(() => toast.error('The call ended, but its chat record could not be saved.'));
    }
    declined.current = false;
    // Keep the end/reject signal readable until the peer has received it.
    callRef.current = IDLE;
    if (logIt) log(logIt);
    setCall(IDLE);
  }, [log, user, chatWith]);

  const entryFor = useCallback((dir: NonNullable<CallLog['dir']>): Omit<CallLog, 'id' | 'at'> | undefined => {
    const c = callRef.current; if (!c.peer) return undefined;
    return { name: c.peer.name, number: c.peer.number ?? '', peerId: c.peer.id, video: c.video, dir, duration: c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0 };
  }, []);

  const makePeer = useCallback((peerId: string, callId: string) => {
    const conn = new RTCPeerConnection(buildIce());
    conn.onicecandidate = (e) => { if (e.candidate) void signal(peerId, callId, 'ice', e.candidate.toJSON()).catch(() => {}); };
    // Collect every remote track (audio and video arrive as separate events) into one stream, so the voice is never replaced by the video track.
    conn.ontrack = (e) => {
      if (!remote.current) remote.current = new MediaStream();
      if (!remote.current.getTracks().includes(e.track)) remote.current.addTrack(e.track);
      setRemote(new MediaStream(remote.current.getTracks()));
    };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'connected') {
        if (dropTimer.current) { clearTimeout(dropTimer.current); dropTimer.current = null; }
        setCall((c) => (c.callId === callId ? { ...c, phase: 'active', startedAt: c.startedAt ?? Date.now() } : c));
      }
      if (conn.connectionState === 'disconnected' && !dropTimer.current) {
        // Brief network blips recover on their own; only end the call if it does not come back.
        dropTimer.current = setTimeout(() => { dropTimer.current = null; if (pc.current === conn && conn.connectionState !== 'connected') { toast.error('The connection was lost.'); cleanup(entryFor(callRef.current.incoming ? 'in' : 'out')); } }, 10000);
      }
      if (conn.connectionState === 'failed') { toast.error('The call could not connect. Both phones need internet; calls between different networks need a TURN server.'); cleanup(entryFor(callRef.current.incoming ? 'in' : 'out')); }
    };
    pc.current = conn;
    return conn;
  }, [signal, cleanup, entryFor]);

  const getMedia = async (video: boolean) => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: video ? { width: 1280, height: 720 } : false });
    local.current = s; setLocal(s); return s;
  };

  const flushIce = async () => {
    const conn = pc.current; if (!conn?.remoteDescription) return;
    for (const c of pendingIce.current.splice(0)) { try { await conn.addIceCandidate(c); } catch { /* ignore stale */ } }
  };

  const startCall = useCallback(async (peer: CallPeer, video: boolean) => {
    if (!user) return;
    if (callRef.current.phase !== 'idle') { toast.error('End your current call first.'); return; }
    const callId = crypto.randomUUID();
    const outgoing: CallState = { phase: 'outgoing', callId, peer, video, startedAt: null };
    callRef.current = outgoing;
    setCall(outgoing);
    try {
      const stream = await getMedia(video);
      if (callRef.current.callId !== callId) { stream.getTracks().forEach((t) => t.stop()); local.current = null; setLocal(null); return; }
      const conn = makePeer(peer.id, callId);
      stream.getTracks().forEach((t) => conn.addTrack(t, stream));
      const o = await conn.createOffer();
      if (callRef.current.callId !== callId) return;
      await conn.setLocalDescription(o);
      if (callRef.current.callId !== callId) return;
      await signal(peer.id, callId, 'offer', { sdp: o.sdp, type: o.type }, video);
      // Wakes the other phone/browser even if the app is closed (shows an "Incoming call" notification).
      firePush({ toId: peer.id, kind: 'call', video });
      if (callRef.current.callId !== callId) { await signal(peer.id, callId, 'end'); return; }
      timeout.current = setTimeout(() => {
        if (callRef.current.callId === callId && callRef.current.phase === 'outgoing') {
          void signal(peer.id, callId, 'end').catch(() => {});
          toast.info(`${peer.name} did not answer the call.`);
          cleanup(entryFor('out'));
        }
      }, 45000);
    } catch (e) {
      if (callRef.current.callId !== callId) return;
      const msg = e instanceof DOMException && e.name === 'NotAllowedError' ? 'Allow microphone and camera access.' : e instanceof Error ? e.message : 'Could not start the call';
      toast.error(msg);
      cleanup();
    }
  }, [user, makePeer, signal, cleanup, entryFor]);

  const accept = useCallback(async () => {
    const c = callRef.current; if (c.phase !== 'incoming' || !c.peer || !c.callId || !offer.current) return;
    setCall({ ...c, phase: 'connecting' });
    try {
      const stream = await getMedia(c.video);
      if (callRef.current.callId !== c.callId || !offer.current) { stream.getTracks().forEach((t) => t.stop()); local.current = null; setLocal(null); return; }
      const conn = makePeer(c.peer.id, c.callId);
      await conn.setRemoteDescription(offer.current);
      stream.getTracks().forEach((t) => conn.addTrack(t, stream));
      await flushIce();
      const a = await conn.createAnswer();
      await conn.setLocalDescription(a);
      await signal(c.peer.id, c.callId, 'answer', { sdp: a.sdp, type: a.type });
    } catch (e) {
      toast.error(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Allow microphone and camera access.' : 'The call could not connect');
      if (c.peer && c.callId) void signal(c.peer.id, c.callId, 'end').catch(() => {});
      cleanup(entryFor('missed'));
    }
  }, [makePeer, signal, cleanup, entryFor]);

  const decline = useCallback(() => {
    const c = callRef.current; if (c.peer && c.callId) void signal(c.peer.id, c.callId, 'reject').catch(() => {});
    cleanup(entryFor('missed'));
  }, [signal, cleanup, entryFor]);

  const hangup = useCallback(() => {
    const c = callRef.current; if (c.peer && c.callId) void signal(c.peer.id, c.callId, 'end').catch(() => {});
    cleanup(entryFor(c.phase === 'incoming' ? 'missed' : c.incoming ? 'in' : 'out'));
  }, [signal, cleanup, entryFor]);

  const toggleMute = () => { local.current?.getAudioTracks().forEach((t) => (t.enabled = muted)); setMuted(!muted); };
  const toggleCamera = () => { local.current?.getVideoTracks().forEach((t) => (t.enabled = cameraOff)); setCameraOff(!cameraOff); };

  const toggleShare = async () => {
    const sender = pc.current?.getSenders().find((x) => x.track?.kind === 'video' || (x.track === null && callRef.current.video));
    if (!sender) { toast.info('Screen sharing is only available in video calls.'); return; }
    const cam = local.current?.getVideoTracks()[0] ?? null;
    if (sharing) { screen.current?.stop(); screen.current = null; await sender.replaceTrack(cam); setSharing(false); setLocal(local.current); return; }
    try {
      const d = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const t = d.getVideoTracks()[0];
      if (!t) { d.getTracks().forEach(track => track.stop()); return; }
      screen.current = t;
      await sender.replaceTrack(t); setSharing(true); setLocal(d);
      t.onended = () => { void sender.replaceTrack(cam); screen.current = null; setSharing(false); setLocal(local.current); };
    } catch { toast.error('Could not start screen sharing.'); }
  };

  // Account data saves recreate callbacks; keep the subscription alive through those renders.
  const listenerActions = useRef({ signal, cleanup, entryFor });
  listenerActions.current = { signal, cleanup, entryFor };
  const callAlertsOn = useRef(true); callAlertsOn.current = prefs?.['nCalls'] !== false;

  // Who is online right now: lets the caller see "Ringing…" (their data is on) or "Calling…" (offline).
  useEffect(() => {
    if (!userId) { setOnline(new Set()); return; }
    const ch = supabase.channel('asf-presence', { config: { presence: { key: userId } } });
    ch.on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch.presenceState()))))
      .subscribe((status) => { if (status === 'SUBSCRIBED') void ch.track({ at: Date.now() }); });
    return () => { void supabase.removeChannel(ch); };
  }, [userId]);

  // Ring sounds follow the call phase: tone-tone for the caller, the chosen ringtone for the receiver.
  useEffect(() => {
    if (call.phase === 'outgoing') startRingback();
    else if (call.phase === 'incoming' && userId) void startRingtone(userId);
    else stopRinging();
    return () => { if (call.phase === 'outgoing' || call.phase === 'incoming') stopRinging(); };
  }, [call.phase, userId]);

  // A call that stays "connecting" is a network problem; say so instead of hanging silently.
  useEffect(() => {
    if (call.phase !== 'connecting') return;
    const id = call.callId;
    const t = setTimeout(() => {
      if (callRef.current.callId === id && callRef.current.phase === 'connecting') {
        toast.error('The call could not connect. If you are on different networks, a TURN server is needed (see .env).');
        const c = callRef.current; if (c.peer && c.callId) void listenerActions.current.signal(c.peer.id, c.callId, 'end').catch(() => {});
        listenerActions.current.cleanup(listenerActions.current.entryFor(c.incoming ? 'in' : 'out'));
      }
    }, 30000);
    return () => clearTimeout(t);
  }, [call.phase, call.callId]);

  // Listen for signals addressed to me
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    type Signal = { call_id: string; from_id: string; kind: string; video: boolean; payload: Record<string, unknown>; created_at: string };

    async function handle(s: Signal) {
      if (disposed) return;
      const { signal, cleanup, entryFor } = listenerActions.current;
      const cur = callRef.current;
      if (s.kind === 'offer') {
        if (Date.now() - new Date(s.created_at).getTime() > 60000) return;
        if (s.call_id === cur.callId) return;
        if (cur.phase !== 'idle') { void signal(s.from_id, s.call_id, 'busy').catch(() => {}); return; }
        // Reserve immediately so duplicate offers cannot generate a false busy response.
        const incoming: CallState = { phase: 'incoming', incoming: true, callId: s.call_id, video: s.video, startedAt: null, peer: { id: s.from_id, name: 'ASF user' } };
        callRef.current = incoming;
        offer.current = s.payload as unknown as RTCSessionDescriptionInit;
        pendingIce.current = [];
        setCall(incoming);
        const { data: p } = await supabase.rpc('asf_caller_profile', { _id: s.from_id });
        const info = p?.[0];
        const contacts = await supabase.from('contacts').select('name').eq('asf_number', info?.asf_number ?? '').maybeSingle();
        if (disposed || callRef.current.callId !== s.call_id) return;
        const resolved = { ...incoming, peer: { id: s.from_id, name: contacts.data?.name || info?.asf_number || 'ASF user', avatar: info?.avatar_url, number: info?.asf_number } };
        callRef.current = resolved;
        setCall(resolved);
        // App minimised / another tab: show a system notification as well.
        if (callAlertsOn.current && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          try {
            const n = new Notification(resolved.peer.name, { body: `Incoming ${s.video ? 'video' : 'voice'} call`, tag: 'asf-call', requireInteraction: true, icon: '/icons/icon-192.png' });
            n.onclick = () => { window.focus(); n.close(); };
            incomingAlert.current = n;
          } catch { /* mobile browsers need the service worker notification instead */ }
        }
        return;
      }
      if (s.call_id !== cur.callId || s.from_id !== cur.peer?.id) return;
      if (s.kind === 'answer' && pc.current) {
        if (pc.current.signalingState !== 'have-local-offer') return;
        if (timeout.current) clearTimeout(timeout.current);
        setCall((c) => ({ ...c, phase: 'connecting' }));
        try { await pc.current.setRemoteDescription(s.payload as unknown as RTCSessionDescriptionInit); await flushIce(); } catch { /* stale answer */ }
      } else if (s.kind === 'ice') {
        if (pc.current?.remoteDescription) { try { await pc.current.addIceCandidate(s.payload as RTCIceCandidateInit); } catch { /* ignore */ } }
        else pendingIce.current.push(s.payload as RTCIceCandidateInit);
      } else if (s.kind === 'end' || s.kind === 'reject' || s.kind === 'busy') {
        if (s.kind === 'reject' || s.kind === 'busy') declined.current = true;
        if (s.kind === 'reject') toast.info(`${cur.peer?.name ?? 'Contact'} declined the call.`);
        if (s.kind === 'busy') toast.info(`${cur.peer?.name ?? 'Contact'} is on another call.`);
        cleanup(entryFor(cur.phase === 'incoming' ? 'missed' : cur.incoming ? 'in' : 'out'));
      }
    }

    const ch = supabase.channel(`calls-${userId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `to_id=eq.${userId}` }, (payload) => { void handle(payload.new as Signal); })
      .subscribe((status) => {
        // Opening the app from a "missed/incoming call" notification: pick up a call that is still ringing.
        if (status !== 'SUBSCRIBED') return;
        void (async () => {
          const since = new Date(Date.now() - 50000).toISOString();
          const r = await supabase.from('call_signals').select('call_id,from_id,kind,video,payload,created_at').eq('to_id', userId).gte('created_at', since).order('created_at', { ascending: true });
          if (disposed || r.error || !r.data?.length) return;
          const rows = r.data as unknown as Signal[];
          const finished = new Set(rows.filter((x) => x.kind === 'end' || x.kind === 'reject' || x.kind === 'busy').map((x) => x.call_id));
          for (const row of rows) { if (disposed) return; if (finished.has(row.call_id)) continue; if (row.kind === 'offer' || row.kind === 'ice') await handle(row); }
        })();
      });
    return () => { disposed = true; void supabase.removeChannel(ch); };
  }, [userId]);

  const peerOnline = !!call.peer && online.has(call.peer.id);
  return <CallContext.Provider value={{ call, localStream, remoteStream, muted, cameraOff, peerOnline, startCall, accept, decline, hangup, toggleMute, toggleCamera, sharing, toggleShare, sendText }}>{children}</CallContext.Provider>;
}

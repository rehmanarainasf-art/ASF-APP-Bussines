import { useEffect, useRef, useState } from 'react';
import { Lock, Mic, MicOff, Minus, Maximize2, MessageSquareText, MonitorUp, Phone, PhoneOff, Smile, UserPlus, Volume2, VolumeX, Video, VideoOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCall } from '@/lib/call-context';
import { PeerAvatar } from './Avatar';
import { Button } from '@/components/ui/button';

function useTimer(start: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!start) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [start]);
  if (!start) return '';
  const s = Math.max(0, Math.floor((now - start) / 1000));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function Pill({ label, onClick, active, danger, accept, children }: { label: string; onClick: () => void; active?: boolean; danger?: boolean; accept?: boolean; children: React.ReactNode }) {
  const tone = danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 px-7' : accept ? 'bg-primary text-primary-foreground hover:bg-primary/90 px-7' : active ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-muted/70';
  return <Button aria-label={label} title={label} onClick={onClick} className={`grid h-12 min-w-12 place-items-center rounded-full px-4 transition-colors ${tone}`}>{children}</Button>;
}
function Tool({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return <Button aria-label={label} title={label} onClick={onClick} className={`grid size-11 place-items-center rounded-full transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}>{children}</Button>;
}

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👋', '🎉'];

export function CallOverlay() {
  const { call, localStream, remoteStream, muted, cameraOff, peerOnline, sharing, accept, decline, hangup, toggleMute, toggleCamera, toggleShare, sendText } = useCall();
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const [mini, setMini] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [chat, setChat] = useState(false);
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState(true);
  const [soundBlocked, setSoundBlocked] = useState(false);
  // One audio element carries the other person's voice for every call type and layout (video elements are muted, they only show the picture).
  const playRemote = () => { const el = remoteAudio.current; if (!el) return; el.volume = speaker ? 1 : 0.35; void el.play().then(() => setSoundBlocked(false)).catch(() => setSoundBlocked(true)); };
  useEffect(() => {
    const el = remoteAudio.current; if (!el) return;
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream;
    if (remoteStream) playRemote();
  }, [remoteStream, call.phase, speaker]); // eslint-disable-line react-hooks/exhaustive-deps
  const timer = useTimer(call.phase === 'active' ? call.startedAt : null);

  useEffect(() => { if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream; }, [remoteStream, call.video, mini, call.phase]);
  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = localStream; }, [localStream, mini, remoteStream]);
  useEffect(() => { if (call.phase === 'idle') { setMini(false); setEmoji(false); setChat(false); } }, [call.phase]);

  if (call.phase === 'idle' || !call.peer) return null;
  const status = call.phase === 'incoming' ? `Incoming ${call.video ? 'video' : 'voice'} call…` : call.phase === 'outgoing' ? (peerOnline ? 'Ringing…' : 'Calling…') : call.phase === 'connecting' ? 'Connecting…' : timer;
  const live = call.phase !== 'incoming';
  const connected = !!remoteStream && call.video;

  const audioEl = <audio ref={remoteAudio} autoPlay playsInline />;

  if (mini) return <>{audioEl}<div className="fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-full border bg-background p-2 pl-3 shadow-xl">
    {call.video && <video ref={remoteVideo} autoPlay playsInline muted className="hidden" />}
    <PeerAvatar path={call.peer.avatar} name={call.peer.name} className="size-9" />
    <span className="text-sm"><span className="block font-medium">{call.peer.name}</span><span className="block text-xs text-muted-foreground">{status}</span></span>
    <Tool label="Open call" onClick={() => setMini(false)}><Maximize2 size={18} /></Tool>
    <Button aria-label="End call" onClick={hangup} className="grid size-10 place-items-center rounded-full bg-destructive text-destructive-foreground"><PhoneOff size={18} /></Button>
  </div></>;

  return <>{audioEl}<div className="call-dialog fixed inset-0 z-[60] grid place-items-center bg-background/70 p-4" role="dialog" aria-label="Call">
    <div className="call-window flex h-[min(640px,92vh)] w-[min(960px,96vw)] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl">
      <div className="flex h-11 items-center justify-between px-4 text-sm">
        <span className="font-medium">ASF</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><Lock size={13} />Encrypted peer connection</span>
        <span className="flex gap-1"><Tool label="Minimise" onClick={() => setMini(true)}><Minus size={16} /></Tool><Tool label="End call" onClick={call.phase === 'incoming' ? decline : hangup}><X size={16} /></Tool></span>
      </div>
      <div className="call-stage relative mx-2 flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-lg call-stage">
        {call.video && live && <video ref={remoteVideo} autoPlay playsInline muted className={`absolute inset-0 h-full w-full object-contain ${connected ? '' : 'hidden'}`} />}
        {soundBlocked && <Button className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={playRemote}>Tap to hear the call</Button>}
        {!connected && <>
          <PeerAvatar path={call.peer.avatar} name={call.peer.name} className="size-28" />
          <h2 className="text-2xl text-foreground">{call.peer.name}</h2>
          <p className="text-muted-foreground">{status}</p>
          {call.video && live && localStream && !cameraOff && <video ref={localVideo} autoPlay playsInline muted className="mt-4 h-56 max-w-[70%] rounded-lg call-stage object-cover" />}
        </>}
        {connected && <>
          <span className="absolute left-4 top-3 z-10 rounded bg-background/60 px-2 py-1 text-sm">{call.peer.name} · {status}</span>
          {localStream && !cameraOff && <video ref={localVideo} autoPlay playsInline muted className="absolute bottom-3 right-3 z-10 h-36 w-52 rounded-lg border call-stage object-cover" />}
        </>}
        {emoji && <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-full bg-background p-2 shadow-lg">{EMOJIS.map((e) => <Button key={e} className="rounded-full p-1.5 text-2xl hover:bg-muted" onClick={() => { void sendText(e); setEmoji(false); }}>{e}</Button>)}</div>}
        {chat && <form className="absolute bottom-3 left-1/2 z-20 flex w-[min(420px,90%)] -translate-x-1/2 gap-2 rounded-full bg-background p-2 shadow-lg" onSubmit={(ev) => { ev.preventDefault(); if (!text.trim()) return; void sendText(text.trim()); setText(''); setChat(false); }}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" className="flex-1 bg-transparent px-3 text-sm outline-none" />
          <Button className="rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground">Send</Button>
        </form>}
      </div>
      <div className="call-controls flex items-center justify-between gap-3 p-3">
        {call.phase === 'incoming' ? <div className="flex w-full justify-center gap-6">
          <Pill label="Decline" danger onClick={decline}><PhoneOff /></Pill>
          <Pill label="Accept" accept onClick={() => void accept()}>{call.video ? <Video /> : <Phone />}</Pill>
        </div> : <>
          <div className="flex gap-2">
            <Pill label={call.video ? (cameraOff ? 'Camera on' : 'Camera off') : 'Camera is for video calls only'} active={!call.video || cameraOff} onClick={() => call.video ? toggleCamera() : toast.info('This is a voice call. Start a video call to use the camera.')}>{!call.video || cameraOff ? <VideoOff size={20} /> : <Video size={20} />}</Pill>
            <Pill label={speaker ? 'Speaker off' : 'Speaker on'} active={speaker} onClick={() => setSpeaker(!speaker)}>{speaker ? <Volume2 size={20} /> : <VolumeX size={20} />}</Pill>
            <Pill label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={toggleMute}>{muted ? <MicOff size={20} /> : <Mic size={20} />}</Pill>
          </div>
          <div className="flex gap-1">
            <Tool label="Emoji bhejein" active={emoji} onClick={() => { setEmoji(!emoji); setChat(false); }}><Smile size={20} /></Tool>
            <Tool label={sharing ? 'Stop sharing screen' : 'Screen share'} active={sharing} onClick={() => void toggleShare()}><MonitorUp size={20} /></Tool>
            <Tool label="Add person" onClick={() => toast.info('Group calls aren’t available yet. Calls are limited to two people.')}><UserPlus size={20} /></Tool>
            <Tool label="Message" active={chat} onClick={() => { setChat(!chat); setEmoji(false); }}><MessageSquareText size={20} /></Tool>
          </div>
          <Pill label="End call" danger onClick={hangup}><PhoneOff size={20} /></Pill>
        </>}
      </div>
    </div>
  </div></>;
}

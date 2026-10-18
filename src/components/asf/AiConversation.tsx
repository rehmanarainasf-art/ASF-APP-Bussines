import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Send, Paperclip, Phone, PhoneOff, X, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { clearAiCall, takeAiCall } from '@/lib/ai-call-flag';
import { startRingback, stopRinging } from '@/lib/sounds';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AgentMark } from './Avatar';

export function AiConversation({ threadId, onTitleChange }: { threadId: string; onTitleChange: () => unknown }) {
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  useEffect(() => {
    setInitial(null);
    void supabase.from('ai_threads').select('messages').eq('id', threadId).maybeSingle().then(({ data }) => {
      setInitial(((data?.messages as unknown) as UIMessage[]) ?? []);
    });
  }, [threadId]);
  if (!initial) return <div className="empty-pane"><AgentMark /><p className="text-muted-foreground">Loading…</p></div>;
  return <Chat key={threadId} threadId={threadId} initial={initial} onTitleChange={onTitleChange} />;
}

function Chat({ threadId, initial, onTitleChange }: { threadId: string; initial: UIMessage[]; onTitleChange: () => unknown }) {
  const [input, setInput] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ai-chat',
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
        },
        body: { threadId },
      }),
    [threadId],
  );
  const { messages, sendMessage, status, error } = useChat({ id: threadId, messages: initial, transport, onFinish: () => onTitleChange() });
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  const busy = status === 'submitted' || status === 'streaming';
  const [files, setFiles] = useState<FileList | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* ---------------- voice call with ASF AI ---------------- */
  type Lang = 'ur' | 'hi' | 'en';
  const RECOG: Record<Lang, string> = { ur: 'ur-PK', hi: 'hi-IN', en: 'en-GB' };
  const [calling, setCalling] = useState(false);
  const [phase, setPhase] = useState<'connecting' | 'listening' | 'thinking' | 'speaking'>('connecting');
  const [heard, setHeard] = useState('');
  const [micOff, setMicOff] = useState(false);
  const [lang, setLang] = useState<Lang>(() => (typeof localStorage !== 'undefined' && (localStorage.getItem('asf-ai-lang') as Lang)) || 'ur');
  const callRef = useRef(false);
  const micOffRef = useRef(false);
  const langRef = useRef<Lang>(lang); langRef.current = lang;
  const busyRef = useRef(false); busyRef.current = busy;
  const speakingRef = useRef(false);
  const recRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const spokenRef = useRef<string | null>(null);
  const messagesRef = useRef(messages); messagesRef.current = messages;

  function voiceFor(l: Lang) { const prefix = l === 'en' ? 'en' : l === 'hi' ? 'hi' : 'ur'; return window.speechSynthesis?.getVoices().find((v) => v.lang.toLowerCase().startsWith(prefix)); }
  // Urdu is spoken in the same way as Hindi. If this device has no Urdu voice, ask the AI to answer in Devanagari so a Hindi voice can read it aloud.
  function replyScript(): Lang { return langRef.current === 'ur' && !voiceFor('ur') && voiceFor('hi') ? 'hi' : langRef.current; }

  function send(override?: string, voice = false) {
    const t = (override ?? input).trim(); if ((!t && !files) || busy) return;
    if (files && Array.from(files).some((f) => f.size > 4 * 1024 * 1024)) { alert('Each file must be under 4 MB.'); return; }
    setInput('');
    const options = voice ? { body: { threadId, voice: true, speak: replyScript() } } : undefined;
    void sendMessage(files ? { text: t || 'Please look at this file.', files } : { text: t }, options); setFiles(null); if (fileRef.current) fileRef.current.value = '';
  }

  function listen() {
    if (!callRef.current || micOffRef.current || speakingRef.current || busyRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!SR) { toast.error('Voice calls need Chrome, Edge or Safari. This browser cannot listen.'); endCall(); return; }
    try { recRef.current?.abort?.(); } catch { /* ignore */ }
    const r = new SR(); r.lang = RECOG[langRef.current]; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1; recRef.current = r;
    let finalText = '';
    r.onstart = () => setPhase('listening');
    r.onresult = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) finalText += res[0].transcript; else interim += res[0].transcript; }
      setHeard((finalText + interim).trim());
    };
    r.onerror = (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast.error('Allow microphone access to talk to ASF AI.'); endCall(); }
      else if (e.error === 'language-not-supported') { toast.error('This language is not supported for listening on this device. Choose another.'); }
    };
    r.onend = () => {
      if (recRef.current !== r) return;
      const said = finalText.trim();
      if (said && callRef.current) { setHeard(''); setPhase('thinking'); send(said, true); }
      else if (callRef.current) setTimeout(listen, 250); // nothing heard: keep listening
    };
    try { r.start(); } catch { setTimeout(listen, 400); }
  }

  function speak(text: string) {
    const synth = window.speechSynthesis; if (!synth) { listen(); return; }
    const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>`~|]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
    if (!clean) { listen(); return; }
    const chunks = clean.match(/[^.!?۔।؟\n]+[.!?۔।؟]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [clean];
    const spoken = replyScript(); const voice = voiceFor(spoken);
    speakingRef.current = true; setPhase('speaking'); try { recRef.current?.abort?.(); } catch { /* ignore */ }
    synth.cancel();
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c); u.lang = RECOG[spoken]; if (voice) u.voice = voice;
      if (i === chunks.length - 1) { u.onend = () => { speakingRef.current = false; if (callRef.current) listen(); }; u.onerror = u.onend; }
      synth.speak(u);
    });
  }

  function startCall() {
    if (callRef.current) return;
    callRef.current = true; micOffRef.current = false; setMicOff(false); setCalling(true); setPhase('connecting'); setHeard('');
    // Skip answers that were already in the conversation before the call started.
    spokenRef.current = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')?.id ?? null;
    window.speechSynthesis?.getVoices(); // warm up the voice list
    startRingback();
    setTimeout(() => { stopRinging(); if (callRef.current) { speak(lang === 'en' ? 'Hello, this is ASF AI. How can I help?' : replyScript() === 'hi' ? 'नमस्ते, मैं ASF AI हूँ। बताइए, मैं आपकी क्या मदद कर सकता हूँ?' : 'السلام علیکم، میں ASF AI ہوں۔ بتائیے، میں آپ کی کیا مدد کر سکتا ہوں؟'); } }, 1800);
  }
  function endCall() {
    callRef.current = false; speakingRef.current = false; setCalling(false); setHeard(''); stopRinging();
    try { recRef.current?.abort?.(); } catch { /* ignore */ } recRef.current = null; window.speechSynthesis?.cancel();
  }
  function toggleMic() {
    const next = !micOffRef.current; micOffRef.current = next; setMicOff(next);
    if (next) { try { recRef.current?.abort?.(); } catch { /* ignore */ } } else listen();
  }
  useEffect(() => { if (takeAiCall()) { startCall(); setTimeout(clearAiCall, 2000); } return () => endCall(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (calling) setPhase((p) => (p === 'connecting' ? p : busy ? 'thinking' : p)); }, [busy, calling]);
  useEffect(() => {
    if (!callRef.current || status !== 'ready') return;
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last || spokenRef.current === last.id) return;
    spokenRef.current = last.id;
    speak(last.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' '));
  }, [status, messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = { connecting: 'Calling ASF AI…', listening: micOff ? 'Microphone off' : 'Listening… speak now', thinking: 'ASF AI is thinking…', speaking: 'ASF AI is speaking…' }[phase];

  return (
    <div className="relative flex h-full flex-col">
      {calling && <div className="absolute inset-0 z-30 flex flex-col items-center justify-between bg-background/95 p-6 text-center" role="dialog" aria-label="Call with ASF AI">
        <div className="text-sm text-muted-foreground">ASF AI voice call</div>
        <div className="flex flex-col items-center gap-4">
          <AgentMark className={`size-28 ${phase === 'speaking' ? 'animate-pulse' : ''}`} />
          <h2 className="text-2xl font-semibold">ASF AI</h2>
          <p className="text-muted-foreground">{label}</p>
          {heard && <p className="max-w-md rounded-lg bg-muted px-3 py-2 text-sm" dir="auto">{heard}</p>}
          <div className="mt-2 flex gap-2">{([['ur', 'اردو'], ['hi', 'हिन्दी'], ['en', 'English']] as const).map(([k, t]) => <Button key={k} size="sm" variant={lang === k ? 'default' : 'outline'} onClick={() => { setLang(k); langRef.current = k; try { localStorage.setItem('asf-ai-lang', k); } catch { /* ignore */ } if (callRef.current && !speakingRef.current && !busyRef.current) listen(); }}>{t}</Button>)}</div>
        </div>
        <div className="flex gap-6">
          <Button size="icon" variant={micOff ? 'default' : 'secondary'} className="size-14 rounded-full" aria-label={micOff ? 'Unmute microphone' : 'Mute microphone'} onClick={toggleMic}>{micOff ? <MicOff /> : <Mic />}</Button>
          <Button size="icon" variant="destructive" className="size-14 rounded-full" aria-label="End AI call" onClick={endCall}><PhoneOff /></Button>
        </div>
      </div>}
      <div className="flex items-center gap-3 border-b px-5 py-3"><AgentMark className="size-9" /><div><div className="font-semibold">ASF AI</div><div className="text-xs text-muted-foreground">{calling ? 'On call…' : busy ? 'typing…' : 'Assistant'}</div></div><Button size="icon" variant={calling ? 'destructive' : 'outline'} className="ml-auto" aria-label={calling ? 'End AI call' : 'Call ASF AI'} onClick={calling ? endCall : startCall}>{calling ? <PhoneOff size={16} /> : <Phone size={16} />}</Button></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
        {messages.length === 0 && <div className="empty-pane"><AgentMark className="size-16" /><h2>Ask ASF AI anything</h2><p className="text-sm text-muted-foreground">Type in British English, or in any language you prefer.</p></div>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              {m.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : p.type === 'file' ? (p.mediaType?.startsWith('image/') ? <img key={i} src={p.url} alt={p.filename ?? 'file'} className="mb-1 max-h-60 rounded" /> : <div key={i} className="mb-1 text-xs underline">📎 {p.filename ?? 'file'}</div>) : null))}
            </div>
          </div>
        ))}
        {status === 'submitted' && <div className="text-xs text-muted-foreground">ASF AI is thinking…</div>}
        {error && <div className="text-sm text-destructive">Could not get a reply: {error.message}</div>}
        <div ref={end} />
      </div>
      {files && <div className="flex flex-wrap gap-2 border-t px-3 pt-2 text-xs">{Array.from(files).map((f) => <span key={f.name} className="rounded bg-muted px-2 py-1">📎 {f.name}</span>)}<button aria-label="Remove files" onClick={() => { setFiles(null); if (fileRef.current) fileRef.current.value = ''; }}><X size={14} /></button></div>}
      <div className="flex items-end gap-2 border-t p-3">
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,.txt" className="hidden" onChange={(e) => setFiles(e.target.files?.length ? e.target.files : null)} />
        <Button size="icon" variant="ghost" aria-label="Attach file" onClick={() => fileRef.current?.click()}><Paperclip size={16} /></Button>
        <Textarea rows={1} className="max-h-40 min-h-10 resize-none" placeholder="Message ASF AI" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button size="icon" aria-label="Send" disabled={(!input.trim() && !files) || busy} onClick={() => send()}><Send size={16} /></Button>
      </div>
    </div>
  );
}

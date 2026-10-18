import { ListsDialog, BackupDialog, useChatOrg } from './ChatTools';
import { DatabaseBackup as MBackup, Store as MStore, Users as MUsers, Megaphone as MMega, Radio as MRadio, Grid3x3 as MGrid, Archive as MArchive, Zap as MZap, SquareCheck as MCheckSq, List as MList, MailCheck as MMarkRead } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { Search, MoreVertical, Plus, Phone, Video, Mic, Smile, Send, Check, CheckCheck, X, ArrowLeft, FileText, Image as ImageIcon, Star, Lock, Ban, Trash2, Palette, Clock, Copy, MessageCirclePlus, LogOut, Settings, Square, UserPlus, Users, Ban as Deleted } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useAsf } from '@/lib/asf-context';
import { useCall } from '@/lib/call-context';
import { firePush } from '@/lib/push-client';
import { supabase } from '@/integrations/supabase/client';
import { startDirectChat, saveContact } from '@/lib/asf.functions';
import { reportMessage } from '@/lib/admin.functions';
import { useChats, formatTime, hashPin, type ChatRow } from '@/lib/use-chats';
import { PeerAvatar } from './Avatar';
import { callLabel } from '@/lib/asf.functions';
import { IconButton } from './controls';
import { MediaView } from './MediaView';
import { toast } from 'sonner';
import doodles from '@/assets/chat-doodles.jpg';
import { uploadMedia } from '@/lib/media';
import { useMediaUrl } from './MediaView';

type Msg = { id: string; chat_id: string; sender_id: string; body: string; created_at: string; media_path: string | null; media_name: string | null; media_type: string | null; deleted: boolean; read_at: string | null; delivered_at: string | null };
const EMOJIS = '😀😂🤣😊😍😘😎🤔😢😭😡👍👎🙏👏💪🎉❤️💔🔥✨💯✅❌👋🤝🙌😴🤩🥳😇😅😉😋🌹⭐📞📷🎁'.match(/\p{Extended_Pictographic}\uFE0F?/gu) ?? [];
const FILTERS = ['All', 'Unread', 'Favourites', 'Groups'] as const;

export function Messenger() {
  const { user, profile, data, saveData, setAuthOpen, prefs, ready } = useAsf();
  const navigate = useNavigate();
  const report = useServerFn(reportMessage);
  const startChat = useServerFn(startDirectChat); const saveContactFn = useServerFn(saveContact); const [cname, setCname] = useState('');
  const { chats, refresh } = useChats(); const { startCall } = useCall();
  const [contacts, setContacts] = useState<{name:string;asf_number:string}[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [info, setInfo] = useState(false); const [dialog, setDialog] = useState(''); const [draft, setDraft] = useState('');
  const [input, setInput] = useState(''); const [emoji, setEmoji] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [recording, setRecording] = useState(false); const [unlocked, setUnlocked] = useState<string[]>([]); const [pin, setPin] = useState('');
  const [chatSearch, setChatSearch] = useState(''); const [showSearch, setShowSearch] = useState(false);
  const [showLocked, setShowLocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const inputRef = useRef<HTMLTextAreaElement>(null); const end = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]); const [accept, setAccept] = useState('*/*');
  const wallpaper = useMediaUrl(prefs.wallpaper && !prefs.wallpaper.startsWith('#') ? prefs.wallpaper : null);

  const hidden = (data['hidden'] as string[] | undefined) ?? [];
  const hiddenMsgs = (data['hiddenMessages'] as string[] | undefined) ?? [];
  const starred = (data['starred'] as string[] | undefined) ?? [];
  const lockedList = data.locked ?? []; const favs = data.favourites ?? []; const blocked = data.blocked ?? [];
  const active = chats.find((c) => c.id === activeId) ?? null;
  const org = useChatOrg(); const [viewArchived, setViewArchived] = useState(false); const [listId, setListId] = useState<string | null>(null);
  const [selMode, setSelMode] = useState(false); const [picked, setPicked] = useState<string[]>([]); const [listsOpen, setListsOpen] = useState(false); const [addOpen, setAddOpen] = useState(false); const [backupOpen, setBackupOpen] = useState(false);
  const curList = org.lists.find((l) => l.id === listId) ?? null;
  const endSel = () => { setSelMode(false); setPicked([]); };

  const visible = useMemo(() => chats.filter((c) => {
    if (hidden.includes(c.id) && !(c.last && !c.last.mine && c.unread > 0)) return false;
    if (viewArchived !== org.archived.includes(c.id)) return false;
    if (curList && !curList.chatIds.includes(c.id)) return false;
    if (lockedList.includes(c.id) && (prefs.hideLocked || !showLocked)) return false;
    if (q && !(c.peer.display_name.toLowerCase().includes(q.toLowerCase()) || c.peer.asf_number.includes(q.replace(/\D/g, '')))) return false;
    if (filter === 'Unread') return c.unread > 0;
    if (filter === 'Favourites') return favs.includes(c.id);
    if (filter === 'Groups') return false;
    return true;
  }), [chats, hidden, lockedList, prefs.hideLocked, showLocked, q, filter, favs, viewArchived, org.archived, curList]);

  useEffect(() => { if (!user || dialog !== 'New chat') return; void supabase.from('contacts').select('name,asf_number').order('name').then(r => { if (r.error) toast.error(r.error.message); else setContacts(r.data ?? []); }); }, [user, dialog]);

  useEffect(() => {
    if (!activeId || !user) { setMessages([]); return; }
    let live = true;
    const load = async () => {
      const r = await supabase.from('direct_messages').select('*').eq('chat_id', activeId).order('created_at');
      if (r.error) { toast.error(r.error.message); return; }
      if (!live) return;
      setMessages(r.data as Msg[]);
      if (!blocked.includes(activeId) && r.data.some((m) => m.sender_id !== user.id && !m.read_at) && document.visibilityState === 'visible' && (prefs['readReceipts'] ?? true)) {
        await supabase.from('direct_messages').update({ read_at: new Date().toISOString() }).eq('chat_id', activeId).neq('sender_id', user.id).is('read_at', null);
      }
    };
    void load();
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    const ch = supabase.channel('chat-' + activeId).on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages', filter: `chat_id=eq.${activeId}` }, () => void load()).subscribe();
    const timer = setInterval(() => void load(), 5000);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); void supabase.removeChannel(ch); };
  }, [activeId, user?.id, prefs, data.blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length, activeId]);

  if (!ready) return <div className="empty-pane"><p className="text-muted-foreground">Loading…</p></div>;
  if (!user) return <div className="empty-pane"><img src={doodles} alt="" className="absolute inset-0 h-full w-full object-cover opacity-10" /><h2 className="relative">ASF APP Business</h2><p className="relative max-w-md text-muted-foreground">Sign in to get your own 03 number and chat with real people. Share your number with friends — they sign up and add you.</p><Button className="relative mt-6" onClick={() => setAuthOpen(true)}>Sign in or create account</Button></div>;

  function toggle(key: string, id: string) { const list = (data[key] as string[] | undefined) ?? []; saveData({ ...data, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] }); }
  function open(c: ChatRow) { setActiveId(c.id); setInfo(false); setShowSearch(false); setChatSearch(''); if (hidden.includes(c.id)) saveData({ ...data, hidden: hidden.filter((x) => x !== c.id) }); }

  async function send(extra?: { media_path: string; media_name: string; media_type: string }) {
    if (!active || !user) return;
    const text = input.trim();
    if (!text && !extra) return;
    if (blocked.includes(active.id)) { toast.error('You blocked this contact. Unblock to send messages.'); return; }
    setInput(''); setEmoji(false);
    const r = await supabase.from('direct_messages').insert({ chat_id: active.id, sender_id: user.id, body: extra ? text : text, ...extra });
    if (r.error) { toast.error(r.error.message); setInput(text); return; }
    firePush({ toId: active.peer.id, kind: 'message', text, media: extra?.media_type ?? null });
    inputRef.current?.focus();
  }
  async function attach(file: File) {
    if (!user || !active) return;
    const t = toast.loading('Uploading…');
    try { const path = await uploadMedia(file, user.id); await send({ media_path: path, media_name: file.name, media_type: file.type || 'application/octet-stream' }); toast.success('Sent', { id: t }); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed', { id: t }); }
  }
  async function record() {
    if (recording) { recorder.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); recorder.current = r; chunks.current = [];
      r.ondataavailable = (e) => chunks.current.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void attach(new File(chunks.current, 'Voice message.webm', { type: r.mimeType || 'audio/webm' })); };
      r.start(); setRecording(true);
    } catch { toast.error('Please allow microphone access to record a voice message.'); }
  }
  async function deleteForEveryone(m: Msg) { const r = await supabase.from('direct_messages').update({ deleted: true }).eq('id', m.id); if (r.error) toast.error(r.error.message); }
  function deleteForMe(m: Msg) { saveData({ ...data, hiddenMessages: [...hiddenMsgs, m.id] }); }
  async function submitDialog() {
    if (dialog === 'Start chat') {
      try { const r = await startChat({ data: { number: draft.replace(/[\s-]/g, ''), name: cname.trim() || undefined } }); await refresh(); setActiveId(r.id); setDialog(''); setDraft(''); setCname(''); }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start chat'); }
    } else if (dialog === 'New contact') {
      try { await saveContactFn({ data: { number: draft.replace(/[\s-]/g, ''), name: cname.trim() } }); await refresh(); setDialog('New chat'); setDraft(''); setCname(''); toast.success('Contact saved'); }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save contact'); }
    } else if (dialog === 'Contact name' && active) {
      try { await saveContactFn({ data: { number: active.peer.asf_number, name: cname } }); await refresh(); setDialog(''); toast.success('Contact saved'); }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save contact'); }
    } else if (dialog === 'Unlock chat' && active) {
      const ok = (data['chatPin'] as string | undefined) === await hashPin(pin);
      if (ok) { setUnlocked([...unlocked, active.id]); setDialog(''); } else toast.error('Wrong PIN');
      setPin('');
    } else if (dialog === 'Set chat PIN' && active) {
      if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN must be 4–6 digits'); return; }
      saveData({ ...data, chatPin: await hashPin(pin), locked: [...lockedList, active.id] }); setUnlocked([...unlocked, active.id]); setPin(''); setDialog(''); toast.success('Chat locked');
    } else if (dialog === 'Disappearing messages' && active) {
      saveData({ ...data, ['disappearing-' + active.id]: draft }); setDialog(''); toast.success(draft === 'Off' ? 'Disappearing messages turned off' : `Messages will disappear after ${draft}`);
    }
  }
  function lockChat() {
    if (!active) return;
    if (lockedList.includes(active.id)) { toggle('locked', active.id); toast.success('Chat unlocked'); return; }
    if (data['chatPin']) { saveData({ ...data, locked: [...lockedList, active.id] }); toast.success('Chat locked'); } else { setPin(''); setDialog('Set chat PIN'); }
  }
  function deleteChat() {
    if (!active) return;
    saveData({ ...data, hidden: [...hidden, active.id], hiddenMessages: [...hiddenMsgs, ...messages.map((m) => m.id)] });
    setActiveId(null); setInfo(false); toast.success('Chat deleted');
  }
  const isLocked = active && lockedList.includes(active.id) && !unlocked.includes(active.id);
  const shown = messages.filter((m) => !hiddenMsgs.includes(m.id) && (!chatSearch || m.body.toLowerCase().includes(chatSearch.toLowerCase())));
  const media = messages.filter((m) => m.media_path && !m.deleted);
  const starMsgs = messages.filter((m) => starred.includes(m.id));
  let lastDay = '';

  return <div className={`messenger ${active ? 'has-chat' : ''} ${info ? 'contact-sidebar-open' : ''}`}>
    <section className="chat-list" aria-label="Chats">
      <div className="list-heading"><h1>ASF Chats</h1><div className="flex gap-1">
        <IconButton label="New chat" onClick={() => { setDraft(''); setDialog('New chat'); }}><MessageCirclePlus size={19} /></IconButton>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Menu"><MoreVertical size={19} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={12} className="asf-chat-menu">
            <DropdownMenuItem onClick={() => navigate({ to: '/business' })}><MStore />Business tools</DropdownMenuItem><DropdownMenuItem onClick={() => navigate({ to: '/communities' })}><MUsers />New group</DropdownMenuItem><DropdownMenuItem onClick={() => navigate({ to: '/announcements' })}><MMega />Advertise</DropdownMenuItem><DropdownMenuItem onClick={() => navigate({ to: '/channels' })}><MRadio />Business broadcast</DropdownMenuItem><DropdownMenuItem onClick={() => navigate({ to: '/business' })}><MGrid />Catalogue</DropdownMenuItem><DropdownMenuItem onClick={() => { setViewArchived(true); setListId(null); }}><MArchive />Archived</DropdownMenuItem><DropdownMenuItem onClick={() => navigate({ to: '/business' })}><MZap />Quick replies</DropdownMenuItem><DropdownMenuItem onClick={() => setDialog('Starred')}><Star />Starred messages</DropdownMenuItem><DropdownMenuItem onClick={() => { setSelMode(true); setPicked([]); }}><MCheckSq />Select chats</DropdownMenuItem><DropdownMenuItem onClick={() => setListsOpen(true)}><MList />Lists</DropdownMenuItem><DropdownMenuItem onClick={() => setBackupOpen(true)}><MBackup />Chat backup</DropdownMenuItem><DropdownMenuItem onClick={() => setDialog('My number')}><Copy />My ASF number</DropdownMenuItem>{lockedList.length > 0 && !prefs.hideLocked && <DropdownMenuItem onClick={() => setShowLocked(!showLocked)}><Lock />{showLocked ? 'Hide' : 'Show'} locked chats</DropdownMenuItem>}<DropdownMenuItem onClick={() => { const ids = chats.filter((c) => c.unread).map((c) => c.id); void Promise.all(ids.map((id) => supabase.from('direct_messages').update({ read_at: new Date().toISOString() }).eq('chat_id', id).neq('sender_id', user.id).is('read_at', null))).then(() => refresh()); }}><MMarkRead />Mark all as read</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: '/settings' })}><Settings />Settings</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => navigate({ to: '/settings' })}><Lock />App lock</DropdownMenuItem><DropdownMenuItem onClick={() => void supabase.auth.signOut()}><LogOut />Log out</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu></div></div>
      <div className="search-box"><Search /><input aria-label="Search chats" placeholder="Search name or 03 number" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button aria-label="Clear" onClick={() => setQ('')}><X size={14} /></button>}</div>
      {viewArchived ? <div className="filter-row"><Button variant="ghost" className="filter selected" onClick={() => setViewArchived(false)}><ArrowLeft size={14} />Archived ({org.archived.length})</Button></div>
      : <div className="filter-row">{FILTERS.map((f) => <Button key={f} variant="ghost" className={`filter ${filter === f && !listId ? 'selected' : ''}`} onClick={() => { setFilter(f); setListId(null); }}>{f}</Button>)}{org.lists.map((l) => <Button key={l.id} variant="ghost" className={`filter ${listId === l.id ? 'selected' : ''}`} onClick={() => { setListId(listId === l.id ? null : l.id); setFilter('All'); }}>{l.name} <small>{l.chatIds.length}</small></Button>)}<Button variant="ghost" className="filter" aria-label="Create list" onClick={() => setListsOpen(true)}><Plus size={14} /></Button></div>}
      {selMode && <div className="select-bar"><Button size="icon" variant="ghost" aria-label="Cancel selection" onClick={endSel}><X size={16} /></Button><b className="flex-1">{picked.length} selected</b><Button size="sm" variant="ghost" disabled={!picked.length} onClick={() => { org.archive(picked, !viewArchived); toast.success(viewArchived ? 'Chats unarchived' : 'Chats archived'); endSel(); }}><MArchive size={15} />{viewArchived ? 'Unarchive' : 'Archive'}</Button><Button size="sm" variant="ghost" disabled={!picked.length} onClick={() => setAddOpen(true)}><MList size={15} />Add to list</Button>{curList && <Button size="sm" variant="ghost" disabled={!picked.length} onClick={() => { picked.forEach((id) => org.removeFromList(curList.id, id)); endSel(); }}>Remove</Button>}</div>}
      <div className="flex-1 overflow-y-auto px-2">
        {lockedList.length > 0 && !prefs.hideLocked && !showLocked && <Button variant="ghost" className="chat-row" onClick={() => setShowLocked(true)}><span className="grid size-11 place-items-center rounded-full bg-muted"><Lock size={18} /></span><span className="row-name">Locked chats ({lockedList.length})</span></Button>}
        {!viewArchived && !selMode && org.archived.length > 0 && <Button variant="ghost" className="chat-row" onClick={() => { setViewArchived(true); setListId(null); }}><span className="grid size-11 place-items-center rounded-full bg-muted"><MArchive size={18} /></span><span className="row-name flex-1 text-left">Archived</span><span className="text-xs text-primary">{org.archived.length}</span></Button>}
        {visible.map((c) => <Button variant="ghost" key={c.id} className={`chat-row ${c.id === activeId || picked.includes(c.id) ? 'active' : ''}`} onClick={() => (selMode ? setPicked(picked.includes(c.id) ? picked.filter((x) => x !== c.id) : [...picked, c.id]) : open(c))} onContextMenu={(e) => { e.preventDefault(); setSelMode(true); setPicked([c.id]); }}>
          {selMode && <span className={`select-tick ${picked.includes(c.id) ? 'on' : ''}`}>{picked.includes(c.id) && <Check size={13} />}</span>}<PeerAvatar path={c.peer.avatar_url} blocked={blocked.includes(c.id)} name={c.peer.display_name} />
          <span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><span className="row-name truncate">{c.peer.display_name}</span><span className="row-right">{c.last && <span className={`row-time ${c.unread ? 'text-primary' : ''}`}>{formatTime(c.last.at)}</span>}{c.unread > 0 && <span className="unread-count">{c.unread}</span>}</span></span>
            <span className="preview flex items-center gap-1">{c.last?.mine && (c.last.read ? <CheckCheck size={14} className="text-tick" /> : c.last.delivered ? <CheckCheck size={14} /> : <Check size={14} />)}<span className="truncate flex-1">{lockedList.includes(c.id) ? '🔒 Locked chat' : c.last?.body ?? 'Tap to start chatting'}</span>{favs.includes(c.id) && <Star size={12} />}</span></span>
        </Button>)}
        {visible.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">{viewArchived ? 'No archived chats.' : curList ? 'This list is empty. Select chats and choose Add to list.' : filter === 'Groups' ? 'Groups are coming soon. Start a one-to-one chat with an 03 number.' : chats.length ? 'No chats match.' : <>No chats yet.<br />Tap <b>New chat</b> and enter a friend’s 03 number.<br /><br />Your number: <b className="text-foreground">{profile?.asf_number}</b></>}</div>}
      </div>
      <ListsDialog open={listsOpen} onClose={() => setListsOpen(false)} chats={chats} />
      <ListsDialog open={addOpen} onClose={() => setAddOpen(false)} chats={chats} addIds={picked} onDone={endSel} />
      <BackupDialog open={backupOpen} onClose={() => setBackupOpen(false)} chats={chats} initialChat={activeId ?? undefined} />
    </section>

    {!active ? <section className="chat-content"><div className="empty-pane"><img src={doodles} alt="" className="absolute inset-0 h-full w-full object-cover opacity-10" /><h2 className="relative">ASF APP Business</h2><p className="relative text-muted-foreground">Your number: <b className="text-foreground">{profile?.asf_number}</b></p><p className="relative mt-2 max-w-md text-sm text-muted-foreground">Share this number. When a friend signs up and adds you, your chat appears here instantly.</p><Button className="relative mt-5" onClick={() => setDialog('New chat')}><MessageCirclePlus />Start a new chat</Button><div className="bottom-note"><Lock size={12} />Messages are private to you and the person you chat with</div></div></section>
    : isLocked ? <section className="chat-content"><div className="pin-screen"><Lock size={40} /><h2 className="text-xl">This chat is locked</h2><Button onClick={() => { setPin(''); setDialog('Unlock chat'); }}>Unlock with PIN</Button></div></section>
    : <section className="chat-content" data-active-chat={active.id}>
      <header className="chat-header">
        <IconButton label="Back" className="chat-back" onClick={() => setActiveId(null)}><ArrowLeft /></IconButton>
        <Button variant="ghost" className="contact-heading" onClick={() => setInfo(!info)}><PeerAvatar path={active.peer.avatar_url} blocked={blocked.includes(active.id)} name={active.peer.display_name} className="size-10" /><span className="ml-3 min-w-0"><span className="block truncate font-semibold">{active.peer.display_name}</span><span className="block truncate text-xs text-muted-foreground">{active.peer.asf_number} · tap for info</span></span></Button>
        <IconButton label="Video call" onClick={() => void startCall({ id: active.peer.id, name: active.peer.display_name, avatar: active.peer.avatar_url, number: active.peer.asf_number }, true)}><Video size={19} /></IconButton>
        <IconButton label="Voice call" onClick={() => void startCall({ id: active.peer.id, name: active.peer.display_name, avatar: active.peer.avatar_url, number: active.peer.asf_number }, false)}><Phone size={18} /></IconButton>
        <IconButton label="Search in chat" onClick={() => setShowSearch(!showSearch)}><Search size={18} /></IconButton>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Chat menu"><MoreVertical size={18} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setInfo(true)}>Contact info</DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggle('favourites', active.id)}>{favs.includes(active.id) ? 'Remove from favourites' : 'Add to favourites'}</DropdownMenuItem>
          <DropdownMenuItem onClick={lockChat}>{lockedList.includes(active.id) ? 'Unlock chat' : 'Lock chat'}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { saveData({ ...data, hiddenMessages: [...hiddenMsgs, ...messages.map((m) => m.id)] }); toast.success('Chat cleared'); }}>Clear chat</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setActiveId(null)}>Close chat</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => toggle('blocked', active.id)}>{blocked.includes(active.id) ? 'Unblock' : 'Block'}</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={deleteChat}>Delete chat</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </header>
      {showSearch && <div className="flex items-center gap-2 border-b px-4 py-2"><Search size={15} /><Input autoFocus placeholder="Search messages" value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} /><IconButton label="Close search" onClick={() => { setShowSearch(false); setChatSearch(''); }}><X size={16} /></IconButton></div>}
      <div className="chat-wall" style={prefs.wallpaper?.startsWith('#') ? { background: prefs.wallpaper } : undefined}>
        {!prefs.wallpaper?.startsWith('#') && <img src={wallpaper || doodles} alt="" className="wallpaper-image" />}
        {!active.peer.saved && <div className="relative z-10 mx-auto my-2 flex w-fit items-center gap-3 rounded-lg bg-card px-4 py-2 text-sm shadow"><span>{active.peer.asf_number} is not in your contacts{active.peer.profile_name ? ` · ~${active.peer.profile_name}` : ''}</span><Button size="sm" onClick={() => { setCname(''); setDialog('Contact name'); }}>Save contact</Button><Button size="sm" variant="outline" onClick={() => toggle('blocked', active.id)}>{blocked.includes(active.id) ? 'Unblock' : 'Block'}</Button></div>}
        <div className="date-divider"><span>🔒 Messages are private between you and {active.peer.display_name}</span></div>
        {shown.map((m) => {
          const mine = m.sender_id === user.id; const day = new Date(m.created_at).toDateString(); const divider = day !== lastDay; lastDay = day;
          return <div key={m.id}>{divider && <div className="date-divider"><span>{formatTime(m.created_at).includes(':') ? 'Today' : formatTime(m.created_at)}</span></div>}
            <div className={`message-row ${mine ? 'mine' : ''}`}>
              <DropdownMenu><DropdownMenuTrigger asChild><div className="bubble cursor-pointer text-left">
                {m.deleted ? <span className="flex items-center gap-2 italic text-muted-foreground"><Deleted size={14} />{mine ? 'You deleted this message' : 'This message was deleted'}</span> : <>
                  {m.media_type?.startsWith('call/') && <span className="flex items-center gap-3 pr-2"><span className={`grid size-9 place-items-center rounded-full bg-background/40 ${m.body.startsWith('answered:') ? '' : 'text-destructive'}`}>{m.media_type === 'call/video' ? <Video size={18} /> : <Phone size={18} />}</span><span><span className="block font-medium">{callLabel(m.media_type, m.body, mine).split(' · ')[0]}</span><span className="block text-xs text-muted-foreground">{callLabel(m.media_type, m.body, mine).split(' · ')[1]}</span></span></span>}
                  {m.media_path && <MediaView path={m.media_path} name={m.media_name} type={m.media_type} />}
                  {m.body && !m.media_type?.startsWith('call/') && <span className="whitespace-pre-wrap break-words">{m.body}</span>}</>}
                <span className="message-meta">{starred.includes(m.id) && <Star size={10} />}{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{mine && !m.deleted && !m.media_type?.startsWith('call/') && (m.read_at ? <CheckCheck size={15} className="text-tick" /> : m.delivered_at ? <CheckCheck size={15} /> : <Check size={14} />)}</span>
              </div></DropdownMenuTrigger><DropdownMenuContent>
                {!m.deleted && m.body && <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(m.body); toast.success('Copied'); }}>Copy</DropdownMenuItem>}
                {!m.deleted && <DropdownMenuItem onClick={() => { setInput((m.body ? `"${m.body.slice(0, 60)}"\n` : '')); inputRef.current?.focus(); }}>Reply</DropdownMenuItem>}
                {!m.deleted && <DropdownMenuItem onClick={() => toggle('starred', m.id)}>{starred.includes(m.id) ? 'Unstar' : 'Star'}</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => deleteForMe(m)}>Delete for me</DropdownMenuItem>
                {!mine && !m.deleted && <DropdownMenuItem onClick={() => { const reason = window.prompt('Reason for reporting this message:')?.trim(); if (!reason || reason.length < 3) { toast.error('A reason is required.'); return; } void report({ data: { messageId: m.id, reason } }).then(() => toast.success('Message reported')).catch((e) => toast.error(e.message)); }}>Report message</DropdownMenuItem>}
                {mine && !m.deleted && <DropdownMenuItem className="text-destructive" onClick={() => void deleteForEveryone(m)}>Delete for everyone</DropdownMenuItem>}
              </DropdownMenuContent></DropdownMenu>
            </div></div>;
        })}
        {shown.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">{chatSearch ? 'No messages found.' : 'Say hi 👋'}</p>}
        <div ref={end} />
      </div>
      {emoji && <div className="mx-4 grid grid-cols-10 gap-1 rounded-lg border bg-popover p-3">{EMOJIS.map((e) => <button key={e} className="rounded p-1 text-xl hover:bg-accent" onClick={() => { setInput(input + e); inputRef.current?.focus(); }}>{e}</button>)}</div>}
      {blocked.includes(active.id) ? <div className="p-4 text-center text-sm text-muted-foreground">You blocked this contact. <Button variant="link" onClick={() => toggle('blocked', active.id)}>Unblock</Button></div> :
      <div className="composer">
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Attach"><Plus size={20} /></Button></DropdownMenuTrigger><DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onClick={() => { setAccept('image/*,video/*'); setTimeout(() => fileRef.current?.click()); }}><ImageIcon />Photos & videos</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setAccept('*/*'); setTimeout(() => fileRef.current?.click()); }}><FileText />Document</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setInput(`📇 ${profile?.display_name} — ${profile?.asf_number}`); }}>Share my contact</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
        <IconButton label="Emoji" onClick={() => setEmoji(!emoji)}><Smile size={20} /></IconButton>
        <textarea ref={inputRef} aria-label="Type a message" placeholder={recording ? 'Recording… tap stop to send' : 'Type a message'} value={input} disabled={recording} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        {input.trim() ? <IconButton label="Send" onClick={() => void send()}><Send size={19} /></IconButton> : <IconButton label={recording ? 'Stop and send' : 'Record voice message'} className={recording ? 'text-destructive' : ''} onClick={() => void record()}>{recording ? <Square size={18} /> : <Mic size={19} />}</IconButton>}
        <input ref={fileRef} type="file" hidden accept={accept} onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
      </div>}
    </section>}

    {active && info && !isLocked && <aside className="contact-sidebar">
      <div className="flex items-center gap-3 p-4"><IconButton label="Close info" onClick={() => setInfo(false)}><X /></IconButton><span className="font-semibold">Contact info</span></div>
      <div className="flex flex-col items-center px-6 pb-6 text-center"><PeerAvatar path={active.peer.avatar_url} blocked={blocked.includes(active.id)} name={active.peer.display_name} className="size-28" /><h3 className="mt-4 text-xl">{active.peer.display_name}</h3><p className="text-muted-foreground">{active.peer.asf_number}</p>{active.peer.profile_name && active.peer.profile_name !== active.peer.display_name && <p className="text-xs text-muted-foreground">Profile name: ~{active.peer.profile_name}</p>}<Button variant="link" size="sm" onClick={() => { setCname(active.peer.saved ? active.peer.display_name : ''); setDialog('Contact name'); }}>{active.peer.saved ? 'Edit contact name' : 'Save contact'}</Button>
        <div className="mt-4 flex gap-3"><Button variant="outline" onClick={() => void startCall({ id: active.peer.id, name: active.peer.display_name, avatar: active.peer.avatar_url, number: active.peer.asf_number }, false)}><Phone />Voice</Button><Button variant="outline" onClick={() => void startCall({ id: active.peer.id, name: active.peer.display_name, avatar: active.peer.avatar_url, number: active.peer.asf_number }, true)}><Video />Video</Button><Button variant="outline" onClick={() => { setInfo(false); setShowSearch(true); }}><Search />Search</Button></div></div>
      <div className="border-t px-6 py-4 text-sm"><p className="text-xs text-muted-foreground">About</p><p className="mt-1">{active.peer.about}</p></div>
      <Button variant="ghost" className="section-row" onClick={() => setDialog('Media')}><ImageIcon /><span>Media, links and docs<small>{media.length} items</small></span></Button>
      <Button variant="ghost" className="section-row" onClick={() => setDialog('Starred')}><Star /><span>Starred messages<small>{starMsgs.length} messages</small></span></Button>
      <Button variant="ghost" className="section-row" onClick={() => { setDraft((data['disappearing-' + active.id] as string) || 'Off'); setDialog('Disappearing messages'); }}><Clock /><span>Disappearing messages<small>{(data['disappearing-' + active.id] as string) || 'Off'}</small></span></Button>
      <Button variant="ghost" className="section-row" onClick={() => navigate({ to: '/settings' })}><Palette /><span>Chat theme<small>Change theme and wallpaper</small></span></Button>
      <Button variant="ghost" className="section-row" onClick={lockChat}><Lock /><span>{lockedList.includes(active.id) ? 'Unlock chat' : 'Chat lock'}<small>Lock and hide this chat behind a PIN</small></span></Button>
      <Button variant="ghost" className="section-row destructive" onClick={() => toggle('blocked', active.id)}><Ban /><span>{blocked.includes(active.id) ? 'Unblock' : 'Block'} {active.peer.display_name}</span></Button>
      <Button variant="ghost" className="section-row destructive" onClick={deleteChat}><Trash2 /><span>Delete chat</span></Button>
    </aside>}

    <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog('')}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>{dialog === 'Call' ? 'Calling' : dialog}</DialogTitle>
      {dialog === 'New chat' && <DialogDescription>Enter your friend’s 11-digit ASF number (starts with 03). They must have an ASF account.</DialogDescription>}</DialogHeader>
      {dialog === 'New chat' && <div className="space-y-2"><Input autoFocus aria-label="Search saved contacts" placeholder="Search name or number" value={contactSearch} onChange={e => setContactSearch(e.target.value)} /><Button variant="ghost" className="chat-row" onClick={() => { setDraft(''); setCname(''); setDialog('New contact'); }}><UserPlus /><span>New contact</span></Button><Button variant="ghost" className="chat-row" onClick={() => { setDraft(''); setCname(''); setDialog('Start chat'); }}><MessageCirclePlus /><span>Chat with a number</span></Button>{contacts.filter(c => (c.name+c.asf_number).toLowerCase().includes(contactSearch.toLowerCase())).map(c => <Button key={c.asf_number} variant="ghost" className="chat-row" onClick={async () => { try { const r = await startChat({ data: { number:c.asf_number } }); await refresh(); setActiveId(r.id); setDialog(''); } catch(e) { toast.error(e instanceof Error ? e.message : 'Could not open chat'); } }}><PeerAvatar name={c.name} path={chats.find(x => x.peer.asf_number===c.asf_number)?.peer.avatar_url} /><span className="min-w-0 flex-1"><span className="block truncate">{c.name}</span><small className="block text-muted-foreground">{c.asf_number}</small></span></Button>)}{!contacts.length&&<p className="py-3 text-sm text-muted-foreground">No saved contacts</p>}</div>}
      {(dialog === 'Start chat' || dialog === 'New contact') && <form onSubmit={(e) => { e.preventDefault(); void submitDialog(); }} className="space-y-3"><Input autoFocus inputMode="tel" aria-label="ASF number" placeholder="+923XXXXXXXXX" maxLength={16} value={draft} onChange={(e) => setDraft(e.target.value)} />{dialog === 'New contact' && <Input aria-label="Contact name" placeholder="Contact name" maxLength={60} value={cname} onChange={e => setCname(e.target.value)} />}<Button className="w-full" disabled={!/^(?:03\d{9}|\+923\d{9})$/.test(draft.replace(/[\s-]/g, '')) || (dialog === 'New contact' && !cname.trim())}>{dialog === 'New contact' ? 'Save contact' : 'Start chat'}</Button></form>}
      {dialog === 'Contact name' && <form onSubmit={(e) => { e.preventDefault(); void submitDialog(); }} className="space-y-3"><Input autoFocus aria-label="Contact name" placeholder="Contact name" maxLength={60} value={cname} onChange={(e) => setCname(e.target.value)} /><Button className="w-full" disabled={!cname.trim()}>Save</Button></form>}
      {dialog === 'My number' && <div className="space-y-3 text-center"><p className="text-3xl font-semibold tracking-wider">{profile?.asf_number}</p><Button onClick={() => { void navigator.clipboard.writeText(profile?.asf_number || ''); toast.success('Number copied'); }}><Copy />Copy number</Button></div>}
      {(dialog === 'Unlock chat' || dialog === 'Set chat PIN') && <form onSubmit={(e) => { e.preventDefault(); void submitDialog(); }} className="space-y-3"><Input autoFocus type="password" inputMode="numeric" placeholder="4–6 digit PIN" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /><Button className="w-full">{dialog === 'Unlock chat' ? 'Unlock' : 'Set PIN and lock'}</Button></form>}
      {dialog === 'Disappearing messages' && <div className="space-y-2">{['Off', '24 hours', '7 days', '90 days'].map((o) => <Button key={o} variant={draft === o ? 'default' : 'outline'} className="w-full" onClick={() => setDraft(o)}>{o}</Button>)}<Button className="w-full" onClick={() => void submitDialog()}>Save</Button></div>}
      {dialog === 'Media' && <div className="grid grid-cols-2 gap-2">{media.map((m) => <MediaView key={m.id} path={m.media_path!} name={m.media_name} type={m.media_type} />)}{!media.length && <p className="text-sm text-muted-foreground">No media shared yet.</p>}</div>}
      {dialog === 'Starred' && <div className="space-y-2">{(active ? starMsgs : []).map((m) => <div key={m.id} className="rounded bg-muted p-3 text-sm">{m.body || m.media_name}<p className="mt-1 text-xs text-muted-foreground">{formatTime(m.created_at)}</p></div>)}{!(active && starMsgs.length) && <p className="text-sm text-muted-foreground">{active ? 'No starred messages. Tap a message → Star.' : 'Open a chat to see its starred messages.'}</p>}</div>}
      {dialog === 'Call' && active && <div className="space-y-4 text-center"><PeerAvatar path={active.peer.avatar_url} blocked={blocked.includes(active.id)} name={active.peer.display_name} className="mx-auto size-24" /><p className="text-lg">{active.peer.display_name}</p><p className="text-sm text-muted-foreground">Voice and video calling is a preview and doesn’t connect yet. Send a voice message instead.</p><Button variant="destructive" onClick={() => { saveData({ ...data, calls: [...((data['calls'] as unknown[]) ?? []), { name: active.peer.display_name, number: active.peer.asf_number, at: Date.now() }] }); setDialog(''); }}>End</Button></div>}
    </DialogContent></Dialog>
  </div>;
}

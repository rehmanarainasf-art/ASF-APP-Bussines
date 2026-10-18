import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAsf, type MessengerData } from '@/lib/asf-context';

export type ChatList = { id: string; name: string; chatIds: string[] };
export type Backup = { id: string; chatId: string; name: string; summary: string; at: number; choices: string };
type ChatLite = { id: string; peer: { display_name: string } };

export function useChatOrg() {
  const { data, saveData } = useAsf();
  const archived = (data['archived'] as string[] | undefined) ?? [];
  const lists = (data['chatLists'] as ChatList[] | undefined) ?? [];
  const backups = (data['backups'] as Backup[] | undefined) ?? [];
  const save = (patch: Record<string, unknown>) => saveData({ ...data, ...patch } as MessengerData);
  return {
    archived, lists, backups,
    archive: (ids: string[], on: boolean) => save({ archived: on ? Array.from(new Set([...archived, ...ids])) : archived.filter((x) => !ids.includes(x)) }),
    createList: (name: string, chatIds: string[] = []) => { const l = { id: crypto.randomUUID(), name, chatIds }; save({ chatLists: [...lists, l] }); return l; },
    deleteList: (id: string) => save({ chatLists: lists.filter((l) => l.id !== id) }),
    addToList: (id: string, ids: string[]) => save({ chatLists: lists.map((l) => (l.id === id ? { ...l, chatIds: Array.from(new Set([...l.chatIds, ...ids])) } : l)) }),
    removeFromList: (id: string, chatId: string) => save({ chatLists: lists.map((l) => (l.id === id ? { ...l, chatIds: l.chatIds.filter((c) => c !== chatId) } : l)) }),
    saveBackup: (b: Backup) => save({ backups: [b, ...backups].slice(0, 50) }),
    deleteBackup: (id: string) => save({ backups: backups.filter((b) => b.id !== id) }),
  };
}

export function ListsDialog({ open, onClose, chats, addIds, onDone }: { open: boolean; onClose: () => void; chats: ChatLite[]; addIds?: string[]; onDone?: () => void }) {
  const org = useChatOrg(); const [name, setName] = useState('');
  const nameOf = (id: string) => chats.find((c) => c.id === id)?.peer.display_name ?? 'Chat';
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
    <DialogHeader><DialogTitle>{addIds?.length ? `Add ${addIds.length} chat${addIds.length > 1 ? 's' : ''} to a list` : 'Lists'}</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Group chats into your own lists, such as Customers or Family. Lists appear above your chats.</p>
    <div className="flex gap-2"><Input placeholder="New list name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} /><Button disabled={!name.trim()} onClick={() => { const l = org.createList(name.trim(), addIds ?? []); setName(''); toast.success(`List “${l.name}” created`); if (addIds?.length) { onDone?.(); onClose(); } }}><Plus />Create</Button></div>
    {org.lists.length === 0 && <p className="text-sm text-muted-foreground">No lists yet.</p>}
    {org.lists.map((l) => <div key={l.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><b>{l.name}</b><span className="flex gap-1">{addIds?.length ? <Button size="sm" onClick={() => { org.addToList(l.id, addIds); toast.success(`Added to ${l.name}`); onDone?.(); onClose(); }}>Add here</Button> : null}<Button size="icon" variant="ghost" aria-label={`Delete ${l.name}`} onClick={() => org.deleteList(l.id)}><Trash2 size={16} /></Button></span></div>
      {!addIds?.length && <div className="mt-2 flex flex-wrap gap-1">{l.chatIds.length === 0 ? <span className="text-xs text-muted-foreground">Empty — select chats and choose “Add to list”.</span> : l.chatIds.map((id) => <button key={id} className="rounded-full bg-muted px-2 py-1 text-xs" onClick={() => org.removeFromList(l.id, id)}>{nameOf(id)} ✕</button>)}</div>}
    </div>)}
  </DialogContent></Dialog>;
}

const sel = 'w-full rounded-lg border bg-background p-2 text-sm';
export function BackupDialog({ open, onClose, chats, initialChat }: { open: boolean; onClose: () => void; chats: ChatLite[]; initialChat?: string | undefined }) {
  const org = useChatOrg();
  const [chatId, setChatId] = useState(initialChat ?? ''); const [period, setPeriod] = useState<'7' | '30' | 'all'>('30');
  const [detail, setDetail] = useState<'Brief' | 'Detailed'>('Brief'); const [focus, setFocus] = useState<'Everything' | 'Decisions and plans' | 'Tasks and reminders' | 'Important dates'>('Everything');
  const [includeMedia, setIncludeMedia] = useState(true); const [summary, setSummary] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const chat = chats.find((c) => c.id === (chatId || initialChat));
  async function generate() {
    if (!chat) return; setBusy(true); setErr(''); setSummary('');
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch('/api/backup-summary', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` }, body: JSON.stringify({ chatId: chat.id, peerName: chat.peer.display_name, period, detail, focus, includeMedia }) });
      if (!r.ok || !r.body) { setErr((await r.text()) || 'Could not create the summary'); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let acc = '';
      for (;;) { const { done, value } = await reader.read(); if (done) break; acc += dec.decode(value, { stream: true }); setSummary(acc); }
      if (!acc.trim()) setErr('No summary was returned. Please try again later.');
    } catch { setErr('Could not create the summary. Check your connection.'); } finally { setBusy(false); }
  }
  function saveIt() { if (!chat || !summary) return; org.saveBackup({ id: crypto.randomUUID(), chatId: chat.id, name: chat.peer.display_name, summary, at: Date.now(), choices: `${period === 'all' ? 'All messages' : `Last ${period} days`} · ${detail} · ${focus}` }); toast.success('Backup saved'); setSummary(''); }
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()}><DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
    <DialogHeader><DialogTitle>Chat backup</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">Choose a conversation and your preferences. ASF AI writes a clear summary you can review before saving.</p>
    <label className="text-sm font-medium">Conversation<select className={sel} value={chatId || initialChat || ''} onChange={(e) => setChatId(e.target.value)}><option value="">Choose a chat…</option>{chats.map((c) => <option key={c.id} value={c.id}>{c.peer.display_name}</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm font-medium">Period<select className={sel} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All messages</option></select></label>
      <label className="text-sm font-medium">Detail<select className={sel} value={detail} onChange={(e) => setDetail(e.target.value as typeof detail)}><option>Brief</option><option>Detailed</option></select></label>
      <label className="text-sm font-medium">Focus<select className={sel} value={focus} onChange={(e) => setFocus(e.target.value as typeof focus)}><option>Everything</option><option>Decisions and plans</option><option>Tasks and reminders</option><option>Important dates</option></select></label>
    </div>
    <div className="setting-line"><div>Include shared media<p>Mention photos, videos and files</p></div><Switch checked={includeMedia} onCheckedChange={setIncludeMedia} /></div>
    <Button disabled={!chat || busy} onClick={() => void generate()}>{busy ? 'Writing summary…' : summary ? 'Regenerate summary' : 'Create summary'}</Button>
    {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    {summary && <><div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">{summary}</div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSummary('')}>Discard</Button><Button disabled={busy} onClick={saveIt}>Save backup</Button></div></>}
    {org.backups.length > 0 && <><h3 className="settings-sub">Saved backups</h3>{org.backups.map((b) => <details key={b.id} className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer"><b>{b.name}</b> · {new Date(b.at).toLocaleString('en-GB')}<span className="block text-xs text-muted-foreground">{b.choices}</span></summary><p className="mt-2 whitespace-pre-wrap">{b.summary}</p><Button size="sm" variant="ghost" className="mt-2" onClick={() => org.deleteBackup(b.id)}><Trash2 />Delete</Button></details>)}</>}
  </DialogContent></Dialog>;
}

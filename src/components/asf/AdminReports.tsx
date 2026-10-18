import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adminReports, adminModerateMessage } from '@/lib/admin.functions';

export function AdminReports() {
  const read = useServerFn(adminReports), moderate = useServerFn(adminModerateMessage);
  const [keyword, setKeyword] = useState(''), [data, setData] = useState<Awaited<ReturnType<typeof adminReports>> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = async () => { setBusy(true); setError(''); try { setData(await read({ data: { keyword } })); } catch { setError('Could not load reports. Please try again.'); } finally { setBusy(false); } };
  useEffect(() => { void load(); }, []);
  const act = async (messageId: string, reportId: string | undefined, status: 'Reviewed' | 'Resolved' | 'Dismissed', block: boolean) => {
    const note = window.prompt(block ? 'Reason for blocking this message:' : 'Internal moderation note:')?.trim();
    if (!note || note.length < 3) { toast.error('Enter a reason of at least 3 characters.'); return; }
    if (block && !window.confirm('Block this message for both participants? This cannot be undone.')) return;
    setBusy(true);
    try { await moderate({ data: { messageId, ...(reportId ? { reportId } : {}), status, note, block } }); toast.success(block ? 'Message blocked' : 'Report updated'); await load(); } catch { toast.error('Could not save moderation action.'); } finally { setBusy(false); }
  };
  return <section className="min-w-0 space-y-3 text-xs">
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(); }}><Input aria-label="Flag keyword" placeholder="Keyword to review" className="h-8 min-w-0 text-xs" maxLength={40} value={keyword} onChange={(e) => setKeyword(e.target.value)} /><Button size="sm" disabled={busy}>Search</Button></form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {busy && <p role="status">Loading…</p>}
    <h2 className="font-semibold">Reported messages</h2>
    <div className="overflow-x-auto"><table className="w-full table-fixed text-left"><thead><tr className="border-b border-border"><th className="w-24 py-2">Status / date</th><th>Message / reason</th><th className="w-24">Actions</th></tr></thead><tbody>{data?.reports.map((r) => <tr key={r.id} className="border-b border-border align-top"><td className="py-2 pr-2">{r.status}<div className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString('en-GB')}</div></td><td className="break-words py-2 pr-2"><p>{r.message?.deleted ? 'Message blocked or deleted' : r.message?.body || r.message?.media_type}</p><p className="mt-1 text-muted-foreground">{r.reason}</p><details className="mt-1"><summary>Details</summary><p className="break-all">Report: {r.id}<br />Reporter: {r.reporter_id}<br />Sender: {r.message?.sender_id}</p><p>{r.moderation_note}</p></details></td><td className="space-y-1 py-2">{r.message && <><Button size="sm" variant="outline" className="h-7 w-full text-xs" disabled={busy} onClick={() => void act(r.message_id, r.id, 'Reviewed', false)}>Review</Button><Button size="sm" variant="outline" className="h-7 w-full text-xs" disabled={busy} onClick={() => void act(r.message_id, r.id, 'Dismissed', false)}>Dismiss</Button><Button size="sm" variant="destructive" className="h-7 w-full text-xs" disabled={busy || r.message.deleted} onClick={() => void act(r.message_id, r.id, 'Resolved', true)}>Block</Button></>}</td></tr>)}</tbody></table></div>
    {data && !data.reports.length && <p className="text-muted-foreground">No reported messages.</p>}
    <h2 className="font-semibold">Keyword matches — review signals, not proof</h2>
    {data?.flags.map((m) => <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border py-2"><div className="min-w-0 break-words">{m.body}<p className="text-muted-foreground">{new Date(m.created_at).toLocaleString('en-GB')}</p></div><Button size="sm" variant="destructive" disabled={busy} onClick={() => void act(m.id, undefined, 'Resolved', true)}>Block</Button></div>)}
    {data && !data.flags.length && <p className="text-muted-foreground">{keyword ? 'No matching messages.' : 'No keyword selected.'}</p>}
  </section>;
}
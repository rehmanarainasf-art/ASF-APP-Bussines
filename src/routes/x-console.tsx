import { createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AdminReports } from '@/components/asf/AdminReports';
import { useAsf } from '@/lib/asf-context';
import { adminCheck, adminOverview, adminUser, adminChat, adminSetBlock } from '@/lib/admin.functions';

export const Route = createFileRoute('/x-console')({
  head: () => ({ meta: [{ title: 'Admin — ASF APP Bussines' }, { name: 'robots', content: 'noindex, nofollow' }, { name: 'description', content: 'Restricted.' }, { property: 'og:title', content: 'Admin — ASF APP Bussines' }, { property: 'og:description', content: 'Restricted.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }] }),
  component: Console,
});

const box = 'min-w-0 border-b border-border py-2';
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB') : '—');

function Console() {
  const { user: account, ready } = useAsf();
  const check = useServerFn(adminCheck), overview = useServerFn(adminOverview), user = useServerFn(adminUser), chat = useServerFn(adminChat), setBlock = useServerFn(adminSetBlock);
  const [ok, setOk] = useState<boolean | null>(null);
  const [data, setData] = useState<any>(null);
  const [q, setQ] = useState(''), [filter, setFilter] = useState('all'), [tab, setTab] = useState<'users' | 'reports' | 'audit'>('users');
  const [sel, setSel] = useState<any>(null), [detail, setDetail] = useState<any>(null), [msgs, setMsgs] = useState<any[] | null>(null);
  const load = () => overview().then(setData).catch((e) => toast.error(e.message));
  useEffect(() => { if (!ready) return; setOk(null); setData(null); setSel(null); setDetail(null); setMsgs(null); if (!account) { setOk(false); return; } let active = true; check().then(async (r) => { if (!active) return; setOk(r.admin); if (r.admin) { const next = await overview(); if (active) setData(next); } }).catch(() => { if (active) setOk(false); }); return () => { active = false; }; }, [ready, account?.id]);
  const rows = useMemo(() => (data?.users ?? []).filter((u: any) => (filter === 'all' || (filter === 'blocked') === u.blocked) && (u.email + u.asf).toLowerCase().includes(q.toLowerCase())), [data, q, filter]);

  if (ok === null) return <div className="fixed inset-0 z-50 grid place-items-center bg-background text-muted-foreground">Checking…</div>;
  if (!ok) return <div className="fixed inset-0 z-50 grid place-items-center bg-background text-foreground">Page not found</div>;

  const open = async (u: any): Promise<void> => { setSel(u); setDetail(null); setMsgs(null); try { setDetail(await user({ data: { id: u.id } })); } catch (e: any) { toast.error(e.message); } };
  const toggle = async () => {
    const reason = sel.blocked ? '' : window.prompt('Reason for blocking (required):')?.trim() ?? '';
    if (!sel.blocked && reason.length < 3) { toast.error('A reason is required.'); return; }
    if (!window.confirm(sel.blocked ? 'Unblock this user?' : 'Block this user?')) return;
    try { await setBlock({ data: { id: sel.id, block: !sel.blocked, reason } }); toast.success(sel.blocked ? 'User unblocked' : 'User blocked'); const n = { ...sel, blocked: !sel.blocked }; setSel(n); load(); open(n); } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background p-2 text-foreground sm:p-4">
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex items-center justify-between"><h1 className="text-sm font-semibold sm:text-base">ASF APP Bussines — Admin</h1><a href="/" className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground">Open ASF App</a></div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[['Total users', data?.stats.total], ['Active today', data?.stats.today], ['Blocked', data?.stats.blocked]].map(([l, v]) => <div key={l} className={`${box} p-2 sm:p-3`}><div className="text-[10px] text-muted-foreground sm:text-xs">{l}</div><div className="text-base font-semibold sm:text-lg">{v ?? '…'}</div></div>)}
        </div>
        <div className="flex gap-2">{(['users', 'reports', 'audit'] as const).map((t) => <Button size="sm" variant={tab === t ? 'default' : 'secondary'} key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{t === 'users' ? 'Users' : t === 'reports' ? 'Reports' : 'Audit log'}</Button>)}</div>
        {tab === 'reports' ? <AdminReports /> : tab === 'audit' ? (
          <div className={`${box} overflow-x-auto p-2 sm:p-3`}><table className="w-full text-xs sm:text-sm"><tbody>{(data?.audit ?? []).map((a: any) => <tr key={a.id} className="border-b border-border"><td className="p-1">{fmt(a.created_at)}</td><td>{a.action}</td><td className="font-mono text-xs">{a.target_user}</td><td>{a.reason}</td><td>{a.ok ? '✓' : '✗'}</td></tr>)}</tbody></table>{!data?.audit?.length && <p className="text-muted-foreground">No entries yet.</p>}</div>
        ) : (
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <div className={box}>
              <div className="mb-2 flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or number" className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs" /><select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border border-border bg-background text-sm"><option value="all">All</option><option value="active">Active</option><option value="blocked">Blocked</option></select></div>
              {rows.map((u: any) => <button key={u.id} onClick={() => open(u)} className={`block w-full border-b border-border p-2 text-left text-xs hover:bg-muted ${sel?.id === u.id ? 'bg-muted' : ''}`}><div className="break-all font-semibold">{u.email}</div><div className="text-xs text-muted-foreground">{u.asf} · joined {fmt(u.created)} · last {fmt(u.last)} · <span className={u.blocked ? 'text-destructive' : ''}>{u.blocked ? 'Blocked' : 'Active'}</span></div></button>)}
              {data && !rows.length && <p className="text-sm text-muted-foreground">No users found.</p>}
            </div>
            {sel && <div className={`${box} space-y-3 text-xs`}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><b className="break-all">{sel.email}</b><Button size="sm" onClick={toggle} className={`rounded px-3 py-1 ${sel.blocked ? 'bg-muted' : 'bg-destructive text-destructive-foreground'}`}>{sel.blocked ? 'Unblock' : 'Block'}</Button></div>
              {!detail ? <p className="text-muted-foreground">Loading…</p> : <>
                <p>Chats {detail.chats.length} · Calls {detail.calls.length} · Contacts {detail.contacts.length}</p>
                <h3 className="font-semibold">Chats</h3>{detail.chats.map((c: any) => <button key={c.id} onClick={() => chat({ data: { chatId: c.id, userId: sel.id } }).then(setMsgs).catch((e) => toast.error(e.message))} className="block w-full break-words border-b border-border py-2 text-left hover:underline">{c.peer} · {c.count} messages · {fmt(c.last)}</button>)}
                {msgs && <div className="max-h-60 overflow-auto rounded bg-muted p-2">{msgs.map((m, i) => <div key={i} className="break-words border-b border-border py-2"><span className="block text-[10px] text-muted-foreground">{fmt(m.created_at)} {m.sender_id === sel.id ? '→' : '←'} {m.read_at ? 'read' : m.delivered_at ? 'delivered' : 'sent'}</span> {m.deleted ? <i>deleted</i> : m.body || m.media_type}</div>)}</div>}
                <h3 className="font-semibold">Calls</h3><div className="overflow-x-auto"><table className="w-full table-fixed text-left text-xs"><thead><tr><th>Direction</th><th>Type / result</th><th>Date</th></tr></thead><tbody>{detail.calls.map((c: any, i: number) => <tr key={i} className="border-b border-border align-top"><td className="py-2">{c.dir}</td><td className="break-words py-2">{c.kind}<br />{c.result}</td><td className="py-2">{fmt(c.at)}</td></tr>)}</tbody></table>{!detail.calls.length && <p className="text-muted-foreground">No calls yet.</p>}</div>
                <h3 className="font-semibold">Contacts</h3>{detail.contacts.map((c: any) => <div key={c.asf_number}>{c.name} · {c.asf_number} · {fmt(c.created_at)}</div>)}
                <h3 className="font-semibold">Block history</h3>{detail.history.map((h: any) => <div key={h.id}>{h.action} · {h.reason ?? ''} · {fmt(h.created_at)}</div>)}
              </>}
            </div>}
          </div>
        )}
      </div>
    </div>
  );
}

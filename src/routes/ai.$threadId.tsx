import { useCallback, useEffect, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAsf } from '@/lib/asf-context';
import { Button } from '@/components/ui/button';
import { AiConversation } from '@/components/asf/AiConversation';
import { AgentMark } from '@/components/asf/Avatar';
import { IconButton } from '@/components/asf/controls';
import { pageHead } from '@/lib/meta';

export const Route = createFileRoute('/ai/$threadId')({
  head: () => pageHead('ASF AI', 'Chat with ASF AI — your saved assistant conversations.'),
  component: AiPage,
});

type Thread = { id: string; title: string; updated_at: string };

function AiPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const { user, ready, setAuthOpen } = useAsf();
  const [threads, setThreads] = useState<Thread[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('ai_threads').select('id,title,updated_at').order('updated_at', { ascending: false });
    setThreads(data ?? []);
    return data ?? [];
  }, []);

  const create = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('ai_threads').insert({ user_id: user.id }).select('id').single();
    if (data) { await load(); void navigate({ to: '/ai/$threadId', params: { threadId: data.id }, replace: true }); }
  }, [user, load, navigate]);

  useEffect(() => {
    if (!user) return;
    void load().then((list) => {
      if (threadId === 'new') { if (list[0] && list[0].title === 'New conversation') void navigate({ to: '/ai/$threadId', params: { threadId: list[0].id }, replace: true }); else void create(); }
    });
  }, [user, threadId, load, create, navigate]);

  async function remove(id: string) {
    await supabase.from('ai_threads').delete().eq('id', id);
    const list = await load();
    if (id === threadId) void navigate({ to: '/ai/$threadId', params: { threadId: list[0]?.id ?? 'new' } });
  }

  if (!ready) return <div className="empty-pane"><p>Loading…</p></div>;
  if (!user) return <div className="empty-pane"><AgentMark className="size-16" /><h2>Sign in to use ASF AI</h2><Button className="mt-4" onClick={() => setAuthOpen(true)}>Sign in</Button></div>;

  return (
    <div className="messenger">
      <aside className="chat-list">
        <div className="list-heading"><h1>ASF AI</h1><IconButton label="New conversation" onClick={() => void create()}><Plus size={18} /></IconButton></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.map((t) => (
            <div key={t.id} className={`chat-row group ${t.id === threadId ? 'active' : ''}`}>
              <Link to="/ai/$threadId" params={{ threadId: t.id }} className="flex min-w-0 flex-1 items-center gap-3"><AgentMark /><div className="min-w-0"><div className="row-name truncate">{t.title}</div><div className="preview">{new Date(t.updated_at).toLocaleString()}</div></div></Link>
              <IconButton label="Delete conversation" className="opacity-0 group-hover:opacity-100" onClick={() => void remove(t.id)}><Trash2 size={15} /></IconButton>
            </div>
          ))}
        </div>
      </aside>
      <section className="relative min-w-0 flex-1 bg-[var(--panel)]">
        {threadId !== 'new' ? <AiConversation threadId={threadId} onTitleChange={load} /> : <div className="empty-pane"><AgentMark /><p>Starting…</p></div>}
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Eye, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAsf } from '@/lib/asf-context';
import { Button } from '@/components/ui/button';
import { PeerAvatar } from './Avatar';

type Viewer = { viewer_id: string; display_name: string; asf_number: string; avatar_url: string | null; viewed_at: string; liked: boolean };
export function StatusEngagement({ statusId, own, onPause }: { statusId: string; own: boolean; onPause: () => void }) {
  const { user } = useAsf();
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!user) return;
    let live = true;
    async function load() {
      if (!user) return;
      if (own) {
        const r = await supabase.rpc('asf_status_viewers', { _status_id: statusId });
        if (r.error) { toast.error('Could not load viewers'); return; }
        if (live) setViewers(r.data ?? []);
      } else {
        const r = await supabase.from('status_receipts').upsert({ status_id: statusId, viewer_id: user.id }, { onConflict: 'status_id,viewer_id', ignoreDuplicates: true });
        if (r.error) { toast.error('Could not save your status view'); return; }
        const saved = await supabase.from('status_receipts').select('liked').eq('status_id', statusId).eq('viewer_id', user.id).maybeSingle();
        if (live) setLiked(saved.data?.liked ?? false);
      }
    }
    setExpanded(false); setViewers([]); setLiked(false); void load();
    const timer = own ? setInterval(() => void load(), 5000) : null;
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [statusId, own, user]);
  async function like() {
    if (!user || busy) return;
    setBusy(true);
    const r = await supabase.from('status_receipts').upsert({ status_id: statusId, viewer_id: user.id, liked: !liked }, { onConflict: 'status_id,viewer_id' });
    if (r.error) toast.error('Could not save your like'); else setLiked(!liked);
    setBusy(false);
  }
  return <div className="status-engagement" onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
    {own ? <>
      <Button variant="secondary" aria-label={`View: viewed by ${viewers.length}, liked by ${viewers.filter(v => v.liked).length}`} onClick={() => { setExpanded(!expanded); onPause(); }}><Eye />View · {viewers.length}{viewers.some(v => v.liked) && <><Heart fill="currentColor" className="ml-1 text-primary" />{viewers.filter(v => v.liked).length}</>}</Button>
      {expanded && <div className="mt-2 max-h-72 w-[min(18rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border bg-background p-3 text-foreground">
        <h3 className="mb-2 text-sm font-semibold">Viewed by {viewers.length}</h3>{!viewers.length && <p className="text-sm text-muted-foreground">Nobody has viewed this yet.</p>}
        {[...viewers].sort((x, y) => Number(y.liked) - Number(x.liked)).map(v => <div key={v.viewer_id} className="flex items-center gap-3 py-2"><PeerAvatar path={v.avatar_url} name={v.display_name} className="size-8" /><span className="min-w-0 flex-1 truncate text-sm">{v.display_name}</span>{v.liked && <span className="flex items-center gap-1 text-xs text-primary"><Heart size={16} fill="currentColor" />Liked</span>}</div>)}
      </div>}</> : <Button variant="secondary" size="icon" aria-label={liked ? 'Unlike status' : 'Like status'} disabled={busy} onClick={() => void like()} className={liked ? 'text-primary' : ''}><Heart fill={liked ? 'currentColor' : 'none'} /></Button>}
  </div>;
}
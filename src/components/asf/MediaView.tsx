import { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { mediaUrl } from '@/lib/media';

export function useMediaUrl(path?: string | null) {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) { setResolved(null); return; }
    let live = true;
    mediaUrl(path).then((u) => { if (live) setResolved({ path, url: u }); }).catch(() => { if (live) setResolved({ path, url: null }); });
    return () => { live = false; };
  }, [path]);
  return path && resolved?.path === path ? resolved.url : null;
}

export function MediaView({ path, name, type }: { path: string; name?: string | null; type?: string | null }) {
  const url = useMediaUrl(path);
  if (!url) return <div className="h-24 w-48 animate-pulse rounded bg-muted" />;
  if (type?.startsWith('image')) return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={name || 'Photo'} className="max-h-72 max-w-[280px] rounded object-cover" /></a>;
  if (type?.startsWith('video')) return <video src={url} controls className="max-h-72 max-w-[280px] rounded" />;
  if (type?.startsWith('audio')) return <audio src={url} controls className="w-60" />;
  return <a href={url} target="_blank" rel="noreferrer" download={name || undefined} className="flex items-center gap-3 rounded bg-background/40 p-3"><FileText size={28} /><span className="max-w-[180px] truncate text-sm">{name || 'Document'}</span><Download size={16} /></a>;
}

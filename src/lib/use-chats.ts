import { useCallback, useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/integrations/supabase/client';
import { getDirectChats } from './asf.functions';
import { useAsf } from './asf-context';

export type ChatRow = Awaited<ReturnType<typeof getDirectChats>>[number];

export function useChats() {
  const { user } = useAsf();
  const fetchChats = useServerFn(getDirectChats);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const accountId = useRef(user?.id);
  accountId.current = user?.id;
  const [loadedFor, setLoadedFor] = useState<string>();
  const refresh = useCallback(async () => {
    if (!user) { setChats([]); setLoading(false); return; }
    const id = user.id;
    try {
      const rows = await fetchChats();
      if (accountId.current !== id) return;
      setChats(rows); setLoadedFor(id);
    } catch { /* shown elsewhere */ }
    if (accountId.current === id) setLoading(false);
  }, [user?.id, fetchChats]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void refresh();
    if (!user) return;
    const timer = setInterval(() => void refresh(), 10000);
    const channel = supabase.channel('my-chats-' + user.id + '-' + crypto.randomUUID())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_chats' }, () => void refresh())
      .subscribe();
    return () => { clearInterval(timer); void supabase.removeChannel(channel); };
  }, [refresh, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ownChats = loadedFor === user?.id ? chats : [];
  const unread = ownChats.reduce((n, c) => n + c.unread, 0);
  // The Chats icon shows how many chats have unread messages (not how many messages).
  const unreadChats = ownChats.filter((c) => c.unread > 0).length;
  return { chats: ownChats, loading, refresh, setChats, unread, unreadChats };
}

export function formatTime(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

export async function hashPin(pin: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('asf-pin:' + pin));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

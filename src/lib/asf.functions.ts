import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export const ensureProfile = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ name: z.string().max(60) }).parse(data))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const existing = await context.supabase.from('profiles').select('*').eq('id', context.userId).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return existing.data;
    // The database assigns a unique +923XXXXXXXXX ASF ID; retry on a rare number collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await supabaseAdmin.from('profiles').insert({ id: context.userId, display_name: '', about: '', avatar_url: null }).select().single();
      if (!result.error) return result.data;
      if (result.error.code !== '23505') throw new Error(result.error.message);
      const retry = await context.supabase.from('profiles').select('*').eq('id', context.userId).maybeSingle();
      if (retry.data) return retry.data;
    }
    throw new Error('Could not assign an ASF number. Please try again.');
  });

export type Peer = { id: string; display_name: string; profile_name?: string; saved?: boolean; asf_number: string; avatar_url: string | null; about: string };

export const startDirectChat = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ number: z.string().transform((s) => s.replace(/[\s-]/g, "")).pipe(z.string().regex(/^(?:03\d{9}|\+923\d{9})$/, "Invalid ASF number")), name: z.string().trim().max(60).optional() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: peer, error } = await supabaseAdmin.from('profiles').select('id,display_name,asf_number,avatar_url,about').eq('asf_number', data.number).maybeSingle();
    if (error) throw new Error(error.message);
    if (!peer) throw new Error('No ASF account has this number. Ask your friend to sign up first.');
    if (peer.id === context.userId) throw new Error('This is your own ASF number.');
    const ids = [context.userId, peer.id].sort();
    const [userA, userB] = ids;
    if (!userA || !userB) throw new Error('Could not identify chat participants.');
    const result = await supabaseAdmin.from('direct_chats').upsert({ user_a: userA, user_b: userB }, { onConflict: 'user_a,user_b' }).select('id').single();
    if (result.error) throw new Error(result.error.message);
    if (data.name) {
      const c = await context.supabase.from('contacts').upsert({ owner_id: context.userId, asf_number: data.number, name: data.name }, { onConflict: 'owner_id,asf_number' });
      if (c.error) throw new Error(c.error.message);
    }
    return { id: result.data.id, peer: { ...peer, profile_name: peer.display_name, display_name: data.name || peer.asf_number, saved: !!data.name } as Peer };
  });

export const getDirectChats = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: chats, error } = await context.supabase.from('direct_chats').select('*').order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    if (!chats?.length) return [];
    const peerIds = chats.map((c) => (c.user_a === context.userId ? c.user_b : c.user_a));
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const peers = await supabaseAdmin.from('profiles').select('id,display_name,asf_number,avatar_url,about').in('id', peerIds);
    if (peers.error) throw new Error(peers.error.message);
    const saved = await context.supabase.from('contacts').select('asf_number,name');
    if (saved.error) throw new Error(saved.error.message);
    const msgs = await context.supabase.from('direct_messages').select('chat_id,sender_id,body,media_type,deleted,read_at,delivered_at,created_at').in('chat_id', chats.map((c) => c.id)).order('created_at', { ascending: false }).limit(1000);
    if (msgs.error) throw new Error(msgs.error.message);
    const unreadCounts = await Promise.all(chats.map(async (chat) => {
      const count = await context.supabase.from('direct_messages').select('id', { count: 'exact', head: true }).eq('chat_id', chat.id).neq('sender_id', context.userId).is('read_at', null).eq('deleted', false);
      if (count.error) throw new Error(count.error.message);
      return [chat.id, count.count ?? 0] as const;
    }));
    const unreadByChat = new Map(unreadCounts);
    return chats.flatMap((chat) => {
      const peerId = chat.user_a === context.userId ? chat.user_b : chat.user_a;
      const raw = peers.data.find((p) => p.id === peerId);
      if (!raw) return [];
      const contact = saved.data.find((x) => x.asf_number === raw.asf_number);
      const peer: Peer = { ...raw, profile_name: raw.display_name, display_name: contact?.name || raw.asf_number, saved: !!contact };
      const mine = msgs.data.filter((m) => m.chat_id === chat.id);
      const last = mine[0];
      const unread = unreadByChat.get(chat.id) ?? 0;
      return [{ id: chat.id, peer, updated_at: chat.updated_at, unread, last: last ? { body: last.deleted ? 'This message was deleted' : last.media_type?.startsWith('call/') ? callLabel(last.media_type, last.body, last.sender_id === context.userId) : last.body || (last.media_type?.startsWith('image') ? '📷 Photo' : last.media_type?.startsWith('audio') ? '🎤 Voice message' : '📄 Document'), mine: last.sender_id === context.userId, at: last.created_at, read: !!last.read_at, delivered: !!last.delivered_at } : null }];
    });
  });

export const saveContact = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ number: z.string().transform((s) => s.replace(/[\s-]/g, "")).pipe(z.string().regex(/^(?:03\d{9}|\+923\d{9})$/, "Invalid ASF number")), name: z.string().trim().min(1).max(60) }).parse(data))
  .handler(async ({ context, data }) => {
    const r = await context.supabase.from('contacts').upsert({ owner_id: context.userId, asf_number: data.number, name: data.name }, { onConflict: 'owner_id,asf_number' });
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });

export type StatusPerson = { id: string; name: string; avatar_url: string | null; asf_number: string; chatId: string | null };

// Everyone whose status I may see: saved contacts (even without a chat) + chat partners.
export const getStatusPeople = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const saved = await context.supabase.from('contacts').select('asf_number,name');
    if (saved.error) throw new Error(saved.error.message);
    const chats = await context.supabase.from('direct_chats').select('id,user_a,user_b');
    if (chats.error) throw new Error(chats.error.message);
    const peerIds = chats.data.map((c) => (c.user_a === context.userId ? c.user_b : c.user_a));
    const numbers = saved.data.map((c) => c.asf_number);
    if (!numbers.length && !peerIds.length) return [] as StatusPerson[];
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const [byNumber, byId] = await Promise.all([
      numbers.length ? supabaseAdmin.from('profiles').select('id,display_name,asf_number,avatar_url').in('asf_number', numbers) : Promise.resolve({ data: [], error: null }),
      peerIds.length ? supabaseAdmin.from('profiles').select('id,display_name,asf_number,avatar_url').in('id', peerIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (byNumber.error) throw new Error(byNumber.error.message);
    if (byId.error) throw new Error(byId.error.message);
    const map = new Map<string, StatusPerson>();
    for (const p of [...(byNumber.data ?? []), ...(byId.data ?? [])]) {
      if (p.id === context.userId || map.has(p.id)) continue;
      const contact = saved.data.find((c) => c.asf_number === p.asf_number);
      const chat = chats.data.find((c) => c.user_a === p.id || c.user_b === p.id);
      map.set(p.id, { id: p.id, name: contact?.name || p.asf_number, avatar_url: p.avatar_url, asf_number: p.asf_number, chatId: chat?.id ?? null });
    }
    return Array.from(map.values());
  });

export function callLabel(type: string, body: string, mine: boolean) {
  const kind = type === 'call/video' ? 'Video call' : 'Voice call';
  if (body.startsWith('answered:')) { const s = Number(body.slice(9)) || 0; return `${kind} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  if (body === 'declined') return `${kind} · ${mine ? 'Declined' : 'Missed'}`;
  return `${kind} · ${mine ? 'No answer' : 'Missed'}`;
}

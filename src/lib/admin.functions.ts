import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { reportInput, moderationInput, keywordInput, escapedKeyword } from './moderation-rules';

type Ctx = { supabase: any; userId: string };

// Every admin call re-verifies the caller's role in the database before using the service role.
async function admin(ctx: Ctx) {
  const { data, error } = await ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'admin' });
  if (error || data !== true) throw new Error('Forbidden');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}
async function audit(db: any, adminId: string, action: string, target: string | null, ref?: string, reason?: string, ok = true) {
  const { error } = await db.from('admin_audit').insert({ admin_id: adminId, action, target_user: target, ref: ref ?? null, reason: reason ?? null, ok });
  if (error) throw new Error('Could not record the audit entry.');
}

export const adminCheck = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
  return { admin: data === true };
});

export const adminOverview = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const db = await admin(context);
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const profiles = await db.from('profiles').select('id,asf_number');
  const num = new Map((profiles.data ?? []).map((p: any) => [p.id, p.asf_number]));
  const now = Date.now();
  const users = data.users.map((u: any) => ({
    id: u.id, email: u.email ?? '', asf: num.get(u.id) ?? '', created: u.created_at, last: u.last_sign_in_at ?? null,
    blocked: !!u.banned_until && new Date(u.banned_until).getTime() > now,
  }));
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const log = await db.from('admin_audit').select('*').order('created_at', { ascending: false }).limit(200);
  return {
    users,
    stats: { total: users.length, today: users.filter((u: any) => u.last && new Date(u.last) >= day).length, blocked: users.filter((u: any) => u.blocked).length },
    audit: log.data ?? [],
  };
});

export const adminUser = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const [chats, contacts, calls] = await Promise.all([
      db.from('direct_chats').select('id,user_a,user_b,updated_at').or(`user_a.eq.${data.id},user_b.eq.${data.id}`).order('updated_at', { ascending: false }),
      db.from('contacts').select('name,asf_number,created_at').eq('owner_id', data.id),
      db.from('direct_messages').select('chat_id,sender_id,media_type,body,created_at').like('media_type', 'call/%').order('created_at', { ascending: false }).limit(500),
    ]);
    const chatIds = (chats.data ?? []).map((c: any) => c.id);
    const peerIds = (chats.data ?? []).map((c: any) => (c.user_a === data.id ? c.user_b : c.user_a));
    const peers = peerIds.length ? await db.from('profiles').select('id,asf_number').in('id', peerIds) : { data: [] };
    const counts = await Promise.all(chatIds.map(async (id: string) => (await db.from('direct_messages').select('id', { count: 'exact', head: true }).eq('chat_id', id)).count ?? 0));
    await audit(db, context.userId, 'viewed_user', data.id);
    const hist = await db.from('admin_audit').select('*').eq('target_user', data.id).in('action', ['blocked', 'unblocked']).order('created_at', { ascending: false });
    return {
      chats: (chats.data ?? []).map((c: any, i: number) => ({ id: c.id, peer: (peers.data ?? []).find((p: any) => p.id === peerIds[i])?.asf_number ?? '—', last: c.updated_at, count: counts[i] })),
      contacts: contacts.data ?? [],
      calls: (calls.data ?? []).filter((m: any) => chatIds.includes(m.chat_id)).map((m: any) => ({ dir: m.sender_id === data.id ? 'Outgoing' : 'Incoming', kind: m.media_type === 'call/video' ? 'Video' : 'Voice', result: m.body, at: m.created_at })),
      history: hist.data ?? [],
    };
  });

export const reportMessage = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => reportInput.parse(d))
  .handler(async ({ context, data }) => {
    // Caller-scoped client: RLS checks chat participation and the reporter identity.
    const { error } = await context.supabase.from('message_reports').insert({ reporter_id: context.userId, message_id: data.messageId, reason: data.reason });
    if (error) throw new Error(error.code === '23505' ? 'You have already reported this message.' : 'Could not report this message.');
    return { ok: true };
  });

export const adminReports = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => keywordInput.parse(d))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const reports = await db.from('message_reports').select('*,message:direct_messages(id,chat_id,sender_id,body,media_type,deleted,created_at)').order('created_at', { ascending: false }).limit(100);
    if (reports.error) throw new Error('Could not load reports.');
    const flags = data.keyword.length >= 2 ? await db.from('direct_messages').select('id,chat_id,sender_id,body,media_type,deleted,created_at').eq('deleted', false).ilike('body', `%${escapedKeyword(data.keyword)}%`).order('created_at', { ascending: false }).limit(100) : { data: [], error: null };
    if (flags.error) throw new Error('Could not load keyword matches.');
    await audit(db, context.userId, 'viewed_reports', null, undefined, data.keyword || undefined);
    return { reports: reports.data ?? [], flags: flags.data ?? [] };
  });

export const adminModerateMessage = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => moderationInput.parse(d))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const message = await db.from('direct_messages').select('id,sender_id').eq('id', data.messageId).single();
    if (message.error || !message.data) throw new Error('Message not found.');
    if (data.reportId) {
      const report = await db.from('message_reports').select('id').eq('id', data.reportId).eq('message_id', data.messageId).single();
      if (report.error) throw new Error('Report does not match this message.');
    }
    await audit(db, context.userId, data.block ? 'message_block_requested' : 'report_review_requested', message.data.sender_id, data.messageId, data.note);
    if (data.block) {
      const result = await db.from('direct_messages').update({ deleted: true, body: '', media_path: null, media_name: null, media_type: null }).eq('id', data.messageId);
      if (result.error) throw new Error('Could not block this message.');
    }
    if (data.reportId) {
      const result = await db.from('message_reports').update({ status: data.status, moderation_note: data.note, reviewed_at: new Date().toISOString() }).eq('id', data.reportId);
      if (result.error) throw new Error('Could not update report.');
    }
    await audit(db, context.userId, data.block ? 'message_blocked' : `report_${data.status.toLowerCase()}`, message.data.sender_id, data.messageId, data.note);
    return { ok: true };
  });

export const adminChat = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ chatId: z.string().uuid(), userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const m = await db.from('direct_messages').select('sender_id,body,media_type,deleted,created_at,delivered_at,read_at').eq('chat_id', data.chatId).order('created_at').limit(500);
    await audit(db, context.userId, 'viewed_chat', data.userId, data.chatId);
    return m.data ?? [];
  });

export const adminSetBlock = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), block: z.boolean(), reason: z.string().trim().max(300) }).parse(d))
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    if (data.id === context.userId) throw new Error('You cannot block your own account.');
    if (data.block && data.reason.length < 3) throw new Error('A reason is required.');
    // A ban stops sign-in and refreshing; already-issued access tokens expire within the hour.
    const { error } = await db.auth.admin.updateUserById(data.id, { ban_duration: data.block ? '876000h' : 'none' } as any);
    await audit(db, context.userId, data.block ? 'blocked' : 'unblocked', data.id, undefined, data.reason || undefined, !error);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const Sub = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

/** Remember this browser/device for closed-app notifications. A device always belongs to the account that last enabled it. */
export const savePushSubscription = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Sub.parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    // Drop older rows for the same endpoint (the token stores the whole subscription as JSON).
    await supabaseAdmin.from('push_tokens').delete().like('token', `%${JSON.stringify(data.endpoint).slice(1, -1)}%`);
    const r = await supabaseAdmin.from('push_tokens').insert({ token: JSON.stringify(data), user_id: context.userId });
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ endpoint: z.string().max(2000) }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    await supabaseAdmin.from('push_tokens').delete().eq('user_id', context.userId).like('token', `%${JSON.stringify(data.endpoint).slice(1, -1)}%`);
    return { ok: true };
  });

/**
 * Called by the sender's app right after a message is stored or a call is started.
 * Only chat partners can notify each other. The recipient's preferences and blocked list are respected.
 */
export const notifyPeer = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ toId: z.string().uuid(), kind: z.enum(['message', 'call']), chatId: z.string().uuid().optional(), video: z.boolean().optional(), text: z.string().max(400).optional(), media: z.string().max(60).optional() }).parse(data))
  .handler(async ({ context, data }) => {
    const publicKey = process.env['VAPID_PUBLIC_KEY']; const privateKey = process.env['VAPID_PRIVATE_KEY'];
    if (!publicKey || !privateKey) return { sent: 0, reason: 'push-not-configured' };
    const [a, b] = [context.userId, data.toId].sort();
    if (!a || !b) return { sent: 0, reason: 'bad-peer' };
    const chat = await context.supabase.from('direct_chats').select('id').eq('user_a', a).eq('user_b', b).maybeSingle();
    if (!chat.data) return { sent: 0, reason: 'not-chat-partners' };
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { sendWebPush } = await import('./push.server');
    const [tokens, me, target, state] = await Promise.all([
      supabaseAdmin.from('push_tokens').select('token').eq('user_id', data.toId),
      supabaseAdmin.from('profiles').select('asf_number,display_name').eq('id', context.userId).maybeSingle(),
      supabaseAdmin.from('profiles').select('preferences').eq('id', data.toId).maybeSingle(),
      supabaseAdmin.from('messenger_state').select('data').eq('user_id', data.toId).maybeSingle(),
    ]);
    if (!tokens.data?.length) return { sent: 0, reason: 'no-devices' };
    const prefs = (target.data?.preferences ?? {}) as Record<string, unknown>;
    const stateData = (state.data?.data ?? {}) as { blocked?: string[] };
    if (data.kind === 'message' && prefs['nMsg'] === false) return { sent: 0, reason: 'muted' };
    if (data.kind === 'call' && prefs['nCalls'] === false) return { sent: 0, reason: 'muted' };
    if (chat.data.id && (stateData.blocked ?? []).includes(chat.data.id)) return { sent: 0, reason: 'blocked' };
    const saved = me.data?.asf_number ? await supabaseAdmin.from('contacts').select('name').eq('owner_id', data.toId).eq('asf_number', me.data.asf_number).maybeSingle() : null;
    const who = saved?.data?.name || me.data?.asf_number || 'ASF user';
    const preview = prefs['nPreview'] === false ? 'New message' : data.text || (data.media?.startsWith('image') ? '📷 Photo' : data.media?.startsWith('audio') ? '🎤 Voice message' : data.media ? '📄 Document' : 'New message');
    const message = data.kind === 'call'
      ? { kind: 'call', title: who, body: `Incoming ${data.video ? 'video' : 'voice'} call`, tag: 'asf-call', url: '/', chatId: chat.data.id }
      : { kind: 'message', title: `ASF · ${who}`, body: preview, tag: chat.data.id, url: '/', chatId: chat.data.id };
    const vapid = { publicKey, privateKey, subject: process.env['VAPID_SUBJECT'] || 'mailto:admin@asf.app' };
    let sent = 0;
    await Promise.all(tokens.data.map(async (row) => {
      try {
        const sub = JSON.parse(row.token) as { endpoint: string; keys: { p256dh: string; auth: string } };
        const res = await sendWebPush(sub, message, vapid, { ttl: data.kind === 'call' ? 45 : 86400, urgency: 'high' });
        if (res.ok) sent++;
        else if (res.gone) await supabaseAdmin.from('push_tokens').delete().eq('token', row.token);
      } catch { /* a bad subscription must not block the others */ }
    }));
    return { sent };
  });

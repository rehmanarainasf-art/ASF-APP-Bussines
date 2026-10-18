import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createResponsesCall } from '@/lib/ai/responses.server';
import type { Database } from '@/integrations/supabase/types';

const Body = z.object({
  chatId: z.string().uuid(),
  peerName: z.string().max(80),
  period: z.enum(['7', '30', 'all']),
  detail: z.enum(['Brief', 'Detailed']),
  focus: z.enum(['Everything', 'Decisions and plans', 'Tasks and reminders', 'Important dates']),
  includeMedia: z.boolean(),
});

export const Route = createFileRoute('/api/backup-summary')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env['SUPABASE_URL'];
        const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
        const aiKey = process.env['LOVABLE_API_KEY'];
        if (!url || !key || !aiKey) return new Response('AI is not configured', { status: 500 });
        const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        if (!token) return new Response('Please sign in again', { status: 401 });
        const supabase = createClient<Database>(url, key, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
        const uid = claims?.claims?.sub;
        if (authErr || !uid) return new Response('Please sign in again', { status: 401 });
        const parsed = Body.safeParse(await request.json());
        if (!parsed.success) return new Response('Invalid backup choices', { status: 400 });
        const b = parsed.data;

        let query = supabase.from('direct_messages').select('sender_id,body,media_type,deleted,created_at').eq('chat_id', b.chatId).order('created_at', { ascending: false }).limit(400);
        if (b.period !== 'all') query = query.gte('created_at', new Date(Date.now() - Number(b.period) * 86400000).toISOString());
        const { data: rows, error } = await query;
        if (error) return new Response('Could not read this conversation', { status: 403 });
        if (!rows?.length) return new Response('This conversation has no messages in the chosen period.', { status: 404 });

        const transcript = rows.reverse().filter((m) => !m.deleted).map((m) => {
          const who = m.sender_id === uid ? 'Me' : b.peerName || 'Contact';
          const media = m.media_type ? (b.includeMedia ? ` [shared ${m.media_type.split('/')[0]}]` : '') : '';
          return `${new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ')} ${who}: ${m.body}${media}`;
        }).join('\n').slice(-24000);

        const call = createResponsesCall(request, { baseURL: 'https://ai.gateway.lovable.dev', apiKey: aiKey, model: 'openai/gpt-6-astra' }, [
          { role: 'system', content: 'You write personal chat backup summaries for ASF APP Business. Always use British English and British spelling. Use short headings and bullet points. Be accurate; never invent facts that are not in the transcript. Refer to the user as "you".' },
          { role: 'user', content: `Create a ${b.detail.toLowerCase()} backup summary of my conversation with ${b.peerName}. Focus: ${b.focus}. Period: ${b.period === 'all' ? 'all messages' : `last ${b.period} days`}. ${b.includeMedia ? 'Mention shared photos, videos and files.' : 'Ignore shared media.'}\n\nTranscript:\n${transcript}` },
        ]);
        return call.result.toTextStreamResponse();
      },
    },
  },
});

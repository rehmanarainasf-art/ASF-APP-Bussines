import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { z } from 'zod';
import { createGatewayProvider, getGatewayRunId } from '@/lib/ai/gateway-helpers.server';
import type { Database } from '@/integrations/supabase/types';

const Body = z.object({ threadId: z.string().uuid(), messages: z.array(z.any()).max(200), voice: z.boolean().optional(), speak: z.enum(['ur', 'hi', 'en']).optional() });

export const Route = createFileRoute('/api/ai-chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env['SUPABASE_URL'];
        const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
        const aiKey = process.env['LOVABLE_API_KEY'];
        if (!url || !key || !aiKey) return new Response('AI is not configured', { status: 500 });
        const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        if (!token) return new Response('Unauthorized', { status: 401 });
        const supabase = createClient<Database>(url, key, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
        if (authErr || !claims?.claims?.sub) return new Response('Unauthorized', { status: 401 });

        const parsed = Body.safeParse(await request.json());
        if (!parsed.success) return new Response('Bad request', { status: 400 });
        const { threadId } = parsed.data;
        const messages = parsed.data.messages as UIMessage[];

        const { data: access } = await supabase.from('ai_access_state').select('blocked').maybeSingle();
        if (access?.blocked) return new Response('AI access is blocked for this account', { status: 403 });
        const { data: thread } = await supabase.from('ai_threads').select('id,title').eq('id', threadId).maybeSingle();
        if (!thread) return new Response('Conversation not found', { status: 404 });

        // Live voice call: short, speakable answers in the language (and script) the person is speaking.
        const voiceRule = parsed.data.voice
          ? ` This is a live voice call and your reply will be read aloud. Answer in one to three short, natural spoken sentences. Never use markdown, lists, emojis or symbols. ${parsed.data.speak === 'ur' ? 'Reply in Urdu, written in Urdu script.' : parsed.data.speak === 'hi' ? 'Reply in simple spoken Hindi/Urdu written in Devanagari script.' : 'Reply in English.'}`
          : '';
        const provider = createGatewayProvider(aiKey, getGatewayRunId(request), {
          baseURL: 'https://ai.gateway.lovable.dev',
        });
        const result = streamText({
          model: provider('google/gemini-3-flash-preview'),
          system:
            'You are ASF AI, the helpful assistant inside ASF APP Business. Reply in British English with British spelling (for example colour, favourite, organise) by default. If the user clearly writes in another language, reply in that language. Be concise and friendly.' + voiceRule,
          messages: await convertToModelMessages(messages),
          abortSignal: request.signal,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: all }) => {
            const firstUser = all.find((m) => m.role === 'user');
            const firstText = firstUser?.parts.find((p) => p.type === 'text');
            const title =
              thread.title === 'New conversation' && firstText && 'text' in firstText
                ? String(firstText.text).slice(0, 48)
                : thread.title;
            await supabase
              .from('ai_threads')
              .update({ messages: JSON.parse(JSON.stringify(all)), title, updated_at: new Date().toISOString() })
              .eq('id', threadId);
          },
        });
      },
    },
  },
});

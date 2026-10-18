import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAsf } from '@/lib/asf-context';
import { playMessageTone } from '@/lib/sounds';
import { registerServiceWorker, syncPushSubscription } from '@/lib/push-client';

export function MessageNotifications() {
  const { user, prefs, data } = useAsf();
  const preferences = useRef({ prefs, data }); preferences.current = { prefs, data };
  // Closed-app notifications: register the service worker and keep this device linked to the signed-in account.
  useEffect(() => {
    void registerServiceWorker();
    if (!user || prefs['nPush'] === false) return;
    if ('Notification' in window && Notification.permission === 'granted') void syncPushSubscription();
  }, [user, prefs]);
  useEffect(() => {
    if (!user) return;
    let live = true;
    let acknowledging = false;
    const notified = new Set<string>();
    async function acknowledge() {
      if (!navigator.onLine || acknowledging || !live) return;
      acknowledging = true;
      try {
      const r = await supabase.from('direct_messages').select('id,chat_id,sender_id,body,media_type').neq('sender_id', user?.id ?? '').is('delivered_at', null);
      if (!live || r.error || !r.data.length) return;
      const blocked = preferences.current.data.blocked ?? [];
      const messages = r.data.filter(m => !blocked.includes(m.chat_id));
      if (!messages.length) return;
      const result = await supabase.from('direct_messages').update({ delivered_at: new Date().toISOString() }).in('id', messages.map(m => m.id));
      if (result.error) return;
      for (const m of messages) {
        if (!live) return;
        if (notified.has(m.id)) continue;
        notified.add(m.id);
        if (preferences.current.prefs['nMsg'] === false) continue;
        const active = document.querySelector('[data-active-chat]')?.getAttribute('data-active-chat');
        if (active === m.chat_id && document.visibilityState === 'visible') continue;
        const p = await supabase.rpc('asf_caller_profile', { _id: m.sender_id });
        const person = p.data?.[0];
        const saved = person ? await supabase.from('contacts').select('name').eq('asf_number', person.asf_number).maybeSingle() : null;
        if (!live) return;
        const title = `ASF · ${saved?.data?.name || person?.asf_number || 'New message'}`;
        const body = m.body || (m.media_type?.startsWith('image') ? 'Photo' : 'New message');
        toast.message(title, { description: body });
        if (preferences.current.prefs['nSound'] !== false) void playMessageTone(user?.id ?? '');
        if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          try { const n = new Notification(title, { body, tag: m.chat_id }); n.onclick = () => { window.focus(); window.location.assign('/'); n.close(); }; } catch { /* Mobile browsers may require service-worker push. */ }
        }
      }
      } finally { acknowledging = false; }
    }
    void acknowledge();
    const channel = supabase.channel('delivery-' + user.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => void acknowledge()).subscribe();
    const timer = setInterval(() => void acknowledge(), 8000);
    window.addEventListener('online', acknowledge);
    return () => { live = false; clearInterval(timer); window.removeEventListener('online', acknowledge); void supabase.removeChannel(channel); };
  }, [user]);
  return null;
}
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { supabase } from '@/integrations/supabase/client';
import { ensureProfile } from './asf.functions';
import { toast } from 'sonner';
import { ACCOUNT_DEFAULTS, accountPreferences } from './account-defaults';
import type { User } from '@supabase/supabase-js';
import type { Json, Database } from '@/integrations/supabase/types';

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type SavedMessage = { id: string; text: string; mine: boolean; time: string; deleted?: boolean; starred?: boolean; file?: string; fileName?: string; mime?: string; poll?: string[]; votes?: number[] };
export type Contact = { id: string; name: string; number: string; preview: string; unread: number; is_group: boolean; avatar: number; real?: boolean; avatar_url?: string | null };
export type Preferences = { theme?: string; language?: string; fontSize?: number; hideLocked?: boolean; wallpaper?: string; appPinHash?: string; [key: string]: unknown };
export type MessengerData = { messages?: Record<string, SavedMessage[]>; favourites?: string[]; blocked?: string[]; locked?: string[]; contacts?: Contact[]; statuses?: { name: string; text: string; image?: string; color: string; at: number }[]; quickReplies?: string[]; channels?: string[]; lists?: string[]; catalogue?: { name: string; price: string; image?: string }[]; [key: string]: unknown };
type Context = { user: User | null; profile: Profile | null; ready: boolean; data: MessengerData; prefs: Preferences; setPrefs: (p: Preferences) => void; saveData: (d: MessengerData) => void; updateProfile: (p: Partial<Profile>) => Promise<void>; reloadProfile: () => Promise<void>; authOpen: boolean; setAuthOpen: (v: boolean) => void };
const AsfContext = createContext<Context | null>(null);
export function AsfProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<MessengerData>({});
  const [prefs, changePrefs] = useState<Preferences>(ACCOUNT_DEFAULTS);
  const [authOpen, setAuthOpen] = useState(false);
  const ensure = useServerFn(ensureProfile);
  const currentId = useRef<string | null>(null);
  const load = useCallback(async () => {
    let { data: auth } = await supabase.auth.getUser();
    // On mobile the stored session can still be restoring on first load; retry once before treating as signed out.
    if (!auth.user) {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) {
        await new Promise((r) => setTimeout(r, 600));
        auth = (await supabase.auth.getUser()).data;
      }
    }
    const u = auth.user;
    if (currentId.current !== (u?.id ?? null)) {
      setProfile(null); setData({}); changePrefs(ACCOUNT_DEFAULTS); setReady(false);
    }
    currentId.current = u?.id ?? null;
    setUser((prev) => (prev && u && prev.id === u.id ? prev : u));
    if (!u) { setProfile(null); setData({}); setReady(true); return; }
    try {
      const p = await ensure({ data: { name: '' } });
      if (currentId.current !== u.id) return;
      setProfile(p); changePrefs(accountPreferences(p.preferences as Preferences));
      const result = await supabase.from('messenger_state').select('data').eq('user_id', u.id).maybeSingle();
      if (result.error) throw result.error;
      if (currentId.current !== u.id) return;
      setData((result.data?.data ?? {}) as MessengerData);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load your account'); }
    if (currentId.current === u.id) setReady(true);
  }, [ensure]);
  useEffect(() => {
    void load();
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { currentId.current = null; setUser(null); setProfile(null); setData({}); changePrefs(ACCOUNT_DEFAULTS); setReady(true); }
      else if (event !== 'INITIAL_SESSION' && event !== 'TOKEN_REFRESHED' && session?.user.id !== currentId.current) { setProfile(null); setData({}); setReady(false); setTimeout(() => void load(), 0); }
    });
    return () => subscription.subscription.unsubscribe();
  }, [load]);
  function saveData(next: MessengerData) {
    setData(next);
    if (!user) return;
    void supabase.from('messenger_state').upsert({ user_id: user.id, data: next as Json, updated_at: new Date().toISOString() }).then(({ error }) => { if (error) toast.error('Changes could not be saved: ' + error.message); });
  }
  function setPrefs(next: Preferences) {
    next = accountPreferences(next);
    changePrefs(next);
    if (!user) return;
    void supabase.from('profiles').update({ preferences: next as Json }).eq('id', user.id).then(({ error }) => { if (error) toast.error(error.message); });
  }
  async function updateProfile(next: Partial<Profile>) {
    if (!user) { setAuthOpen(true); return; }
    const { error } = await supabase.from('profiles').update(next).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    if (currentId.current !== user.id) return;
    setProfile((p) => p?.id === user.id ? { ...p, ...next } : p); toast.success('Profile saved');
  }
  return <AsfContext.Provider value={{ user, profile, ready, data, prefs, setPrefs, saveData, updateProfile, reloadProfile: load, authOpen, setAuthOpen }}>{children}</AsfContext.Provider>;
}
export function useAsf() { const value = useContext(AsfContext); if (!value) throw new Error('ASF provider is missing'); return value; }
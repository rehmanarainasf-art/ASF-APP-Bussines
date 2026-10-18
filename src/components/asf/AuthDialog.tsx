import { useState } from 'react';
import { useAsf } from '@/lib/asf-context';
import { supabase } from '@/integrations/supabase/client';
import { cloudOAuth } from '@/integrations/oauth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, ArrowRight, Mail } from 'lucide-react';
export function AuthDialog() {
 const { authOpen, setAuthOpen, reloadProfile } = useAsf();
 const [mode,setMode] = useState<'login'|'signup'|'reset'>('login'); const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [busy,setBusy]=useState(false);
 async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); setNotice('');
 try {
  if(mode==='reset') { const r=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'/reset-password'}); if(r.error)throw r.error; setNotice('Check your email for your password reset link.'); }
  else if(mode==='signup') { const r=await supabase.auth.signUp({email,password,options:{data:{full_name:name},emailRedirectTo:window.location.origin}}); if(r.error)throw r.error; if(!r.data.session)setNotice('Check your email to confirm your account. Your ASF number will be assigned after confirmation.'); else {await reloadProfile();setAuthOpen(false);} }
  else {const r=await supabase.auth.signInWithPassword({email,password});if(r.error)throw r.error;await reloadProfile();setAuthOpen(false);}
 }catch(e){setError(e instanceof Error?e.message:'Could not sign in');}finally{setBusy(false);}}
 return <Dialog open={authOpen} onOpenChange={setAuthOpen}><DialogContent className="max-w-sm"><DialogHeader><div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground"><MessageCircle size={28}/></div><DialogTitle className="text-center text-2xl">{mode==='signup'?'Join ASF APP Business':mode==='reset'?'Reset password':'Welcome to ASF'}</DialogTitle></DialogHeader><form onSubmit={submit} className="mt-3 space-y-4">{mode==='signup'&&<Input required aria-label="Display name" placeholder="Display name" value={name} onChange={e=>setName(e.target.value)} maxLength={60}/>}<Input type="email" aria-label="Email" required placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)}/>{mode!=='reset'&&<Input type="password" aria-label="Password" required minLength={8} placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>} {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm text-primary">{notice}</p>}<Button className="w-full" disabled={busy}>{busy?'Please wait…':mode==='signup'?'Create account':mode==='reset'?'Send reset email':'Sign in'}<ArrowRight/></Button></form>{mode!=='reset'&&<Button variant="outline" className="w-full" onClick={async()=>{const r=await cloudOAuth.auth.signInWithOAuth('google',{redirect_uri:window.location.origin});if(r.error)setError(r.error.message);}}>Continue with Google</Button>}<div className="flex justify-center gap-1 text-xs"><Button variant="link" onClick={()=>{setMode(mode==='signup'?'login':'signup');setNotice('');setError('');}}>{mode==='signup'?'Already have an account? Sign in':'Create an account'}</Button>{mode==='login'&&<Button variant="link" onClick={()=>setMode('reset')}>Forgot password?</Button>}</div><p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Mail size={13}/>Your own permanent +923 ASF ID (not a real phone number)</p></DialogContent></Dialog>;
}

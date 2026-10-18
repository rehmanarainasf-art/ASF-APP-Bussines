import { supabase } from '@/integrations/supabase/client';
export async function uploadMedia(file:File,userId:string,folder?:string) {
 if(file.size>10*1024*1024)throw new Error('Choose a file smaller than 10 MB.');
 const path=`${userId}/${folder?folder+'/':''}${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
 const result=await supabase.storage.from('asf-media').upload(path,file);if(result.error)throw new Error(result.error.message);
 return path;
}
export async function mediaUrl(path:string) { if(path.startsWith('blob:')||path.startsWith('data:'))return path;const r=await supabase.storage.from('asf-media').createSignedUrl(path,3600);if(r.error)throw new Error(r.error.message);return r.data.signedUrl; }

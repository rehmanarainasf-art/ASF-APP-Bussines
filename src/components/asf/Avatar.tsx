import { cn } from '@/lib/utils';
import { UserRound } from 'lucide-react';
import { useMediaUrl } from './MediaView';
export function Avatar({ src, name = '', className }: { index?: number; src?: string | null | undefined; name?: string; className?: string }) {
  return <PeerAvatar path={src} name={name} className={cn(className)} />;
}
export function AgentMark({ className }: { className?: string }) { return <span className={cn('agent-mark grid size-11 shrink-0 place-items-center rounded-full font-bold', className)}>a<span className="agent-dot" /></span>; }
/** Real profile photo of another user. Empty person icon when none; red icon when blocked. */
export function PeerAvatar({ path, name = '', blocked, className }: { path?: string | null | undefined; name?: string; blocked?: boolean; className?: string }) {
  const photo = path && !/(?:avatar-[0-7](?:[.-])|contact-avatars|\/src\/assets\/)/i.test(path) ? path : null;
  const isUrl = !!photo && /^(https?:|blob:|data:)/.test(photo);
  const signed = useMediaUrl(!blocked && photo && !isUrl ? photo : null);
  const src = blocked ? null : isUrl ? photo : signed;
  if (src) return <img src={src} alt={name} className={cn('size-11 shrink-0 rounded-full object-cover', className)} width={44} height={44} />;
  if (blocked) return <span aria-label={name} data-blocked-avatar className={cn('grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-destructive/20 text-destructive ring-2 ring-destructive/60', className)}><UserRound className="h-[62%] w-[62%]" fill="currentColor" strokeWidth={1} /></span>;
  return <span aria-label={name} data-blank-avatar className={cn('grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground', className)}><UserRound className="h-[62%] w-[62%]" fill="currentColor" strokeWidth={1} /></span>;
}

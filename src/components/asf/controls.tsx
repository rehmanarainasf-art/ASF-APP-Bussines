import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
export function IconButton({ label, children, onClick, className, disabled }: { label: string; children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className={cn('shrink-0 rounded-full', className)} aria-label={label} onClick={onClick} disabled={disabled}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
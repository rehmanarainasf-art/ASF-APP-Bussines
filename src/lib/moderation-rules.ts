import { z } from 'zod';

export const reportInput = z.object({ messageId: z.string().uuid(), reason: z.string().trim().min(3).max(300) });
export const moderationInput = z.object({ messageId: z.string().uuid(), reportId: z.string().uuid().optional(), status: z.enum(['Reviewed', 'Resolved', 'Dismissed']), note: z.string().trim().min(3).max(300), block: z.boolean() });
export const keywordInput = z.object({ keyword: z.string().trim().max(40) });
export const escapedKeyword = (value: string) => value.replace(/[\\%_]/g, '\\$&');
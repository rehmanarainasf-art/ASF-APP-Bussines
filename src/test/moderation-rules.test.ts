import { describe, expect, it } from 'vitest';
import { reportInput, moderationInput, escapedKeyword } from '@/lib/moderation-rules';
const id = '00000000-0000-4000-8000-000000000001';
describe('Moderation rules', () => {
  it('requires a reason before reporting a message', () => {
    expect(reportInput.safeParse({ messageId: id, reason: ' ' }).success).toBe(false);
    expect(reportInput.safeParse({ messageId: id, reason: 'Abusive message' }).success).toBe(true);
  });
  it('requires a moderation reason before blocking a message', () => {
    expect(moderationInput.safeParse({ messageId: id, status: 'Resolved', block: true, note: '' }).success).toBe(false);
    expect(moderationInput.safeParse({ messageId: id, status: 'Resolved', block: true, note: 'Confirmed abuse' }).success).toBe(true);
  });
  it('treats keyword wildcard characters as literal text', () => {
    expect(escapedKeyword('100%_test')).toBe('100\\%\\_test');
  });
});
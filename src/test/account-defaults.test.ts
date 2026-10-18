import { describe, expect, it } from 'vitest';
import { accountPreferences } from '@/lib/account-defaults';

describe('Independent account defaults', () => {
  it('uses British English even with a legacy language preference', () => {
    expect(accountPreferences({ language: 'Urdu', theme: 'Light' })).toMatchObject({ language: 'British English', theme: 'Light' });
  });
  it('does not share account-specific preferences', () => {
    expect(accountPreferences({ wallpaper: 'owner/photo.jpg' }).wallpaper).toBe('owner/photo.jpg');
    expect(accountPreferences().wallpaper).toBeUndefined();
  });
});
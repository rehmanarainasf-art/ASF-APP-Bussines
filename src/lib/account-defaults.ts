import type { Preferences } from './asf-context';

export const ACCOUNT_DEFAULTS: Preferences = {
  theme: 'Dark', language: 'British English', fontSize: 14,
  nMsg: true, nSound: true, readReceipts: true, enterSend: true, spellCheck: true,
};

export function accountPreferences(saved: Preferences = {}): Preferences {
  return { ...ACCOUNT_DEFAULTS, ...saved, language: 'British English' };
}
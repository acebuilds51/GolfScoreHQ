import { describe, expect, it } from 'vitest';
import { DEFAULT_SENDER, senderFrom } from '../../../supabase/functions/_shared/sender';

describe('email sender setting', () => {
  it('keeps a valid address or "Name <address>"', () => {
    expect(senderFrom('GolfScoreHQ <recaps@golfscorehq.app>')).toBe('GolfScoreHQ <recaps@golfscorehq.app>');
    expect(senderFrom('  recaps@golfscorehq.app ')).toBe('recaps@golfscorehq.app');
  });

  it('falls back to the default when the setting is missing or mistyped', () => {
    expect(senderFrom('GolfScoreHQ <recaps@golfscorehq.app')).toBe(DEFAULT_SENDER); // the missing ">" that broke emails
    expect(senderFrom('GolfScoreHQ recaps@golfscorehq.app')).toBe(DEFAULT_SENDER);
    expect(senderFrom('')).toBe(DEFAULT_SENDER);
    expect(senderFrom(undefined)).toBe(DEFAULT_SENDER);
  });
});

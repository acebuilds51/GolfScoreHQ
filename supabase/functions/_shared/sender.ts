// Who emails come from. The RECAP_FROM_EMAIL secret is typed by hand, and a
// typo (like a missing ">") makes Resend refuse every email, so anything that
// isn't a plain address or "Name <address>" falls back to the default.

export const DEFAULT_SENDER = 'GolfScoreHQ <recaps@golfscorehq.app>';

const ADDRESS = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const NAMED = /^[^<>]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/;

export function senderFrom(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  return ADDRESS.test(v) || NAMED.test(v) ? v : DEFAULT_SENDER;
}

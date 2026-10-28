// Text messages through the phone's own messaging app (no SMS service, no cost):
// a link that opens Messages with the number (or numbers) and message filled in.

/** "248.707.0800", "(248) 707-0800" → "+12487070800". Null when it isn't a usable number. */
export function telNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 7 ? `+${digits}` : null;
}

const isApple = (ua: string) => /iPhone|iPad|iPod|Macintosh/.test(ua);

/**
 * Link that opens the messaging app. One number: a normal text. Several: one
 * group text from the sender's own phone. iPhones and Android phones want the
 * numbers and message written slightly differently.
 */
export function smsLink(phones: (string | null | undefined)[], body = '', ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string | null {
  const nums = [...new Set(phones.map(telNumber).filter((n): n is string => !!n))];
  if (!nums.length) return null;
  const msg = body.trim() ? encodeURIComponent(body.trim()) : '';
  if (isApple(ua)) {
    if (nums.length === 1) return `sms:${nums[0]}${msg ? `&body=${msg}` : ''}`;
    return `sms://open?addresses=${nums.join(',')}${msg ? `&body=${msg}` : ''}`;
  }
  return `sms:${nums.join(',')}${msg ? `?body=${msg}` : ''}`;
}

const SIZE_KEY = 'gshq-text-group-size';
/** The largest group text this phone's owner picked (default 20, what most carriers allow). */
export function savedGroupSize(): number {
  try { return Number(localStorage.getItem(SIZE_KEY)) || 20; } catch { return 20; }
}
export function saveGroupSize(n: number) {
  try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* not saved */ }
}

/**
 * Carriers cap how many people one group text (MMS) can go to (often 10 or 20;
 * iMessage allows 32). Split a long list into group texts of at most `size`,
 * each with the same message. Numbers are counted once.
 */
export function smsBatches(phones: (string | null | undefined)[], body: string, size: number, ua?: string): { link: string; count: number }[] {
  const nums = [...new Set(phones.map(telNumber).filter((n): n is string => !!n))];
  const per = Math.max(1, Math.floor(size));
  const out: { link: string; count: number }[] = [];
  for (let i = 0; i < nums.length; i += per) {
    const chunk = nums.slice(i, i + per);
    out.push({ link: smsLink(chunk, body, ua)!, count: chunk.length });
  }
  return out;
}

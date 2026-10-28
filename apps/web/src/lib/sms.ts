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

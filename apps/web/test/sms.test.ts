import { describe, expect, it } from 'vitest';
import { smsLink, telNumber } from '../src/lib/sms';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';

describe('texting from the app', () => {
  it('reads phone numbers however they were typed', () => {
    expect(['248.707.0800', '248 - 935 - 5364', '(586) 879-1504', '1-313-920-0999', '555', ''].map(telNumber))
      .toEqual(['+12487070800', '+12489355364', '+15868791504', '+13139200999', null, null]);
  });

  it('opens a text to one golfer', () => {
    expect(smsLink(['248.707.0800'], '', IPHONE)).toBe('sms:+12487070800');
    expect(smsLink(['248.707.0800'], 'Tee time 5:10?', ANDROID)).toBe('sms:+12487070800?body=Tee%20time%205%3A10%3F');
    expect(smsLink(['248.707.0800'], 'Hi', IPHONE)).toBe('sms:+12487070800&body=Hi');
  });

  it('opens one group text to everyone, skipping blanks and repeats', () => {
    const phones = ['248.707.0800', null, '248-707-0800', '586.879.1504'];
    expect(smsLink(phones, 'Rainout tonight', IPHONE)).toBe('sms://open?addresses=+12487070800,+15868791504&body=Rainout%20tonight');
    expect(smsLink(phones, 'Rainout tonight', ANDROID)).toBe('sms:+12487070800,+15868791504?body=Rainout%20tonight');
    expect(smsLink([null, ''], 'x', ANDROID)).toBeNull();
  });
});

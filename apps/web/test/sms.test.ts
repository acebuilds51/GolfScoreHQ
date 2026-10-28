import { describe, expect, it } from 'vitest';
import { smsBatches, smsLink, telNumber } from '../src/lib/sms';

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

  it('splits a big list into group texts under the carrier limit', () => {
    const phones = Array.from({ length: 35 }, (_, i) => `248555${String(1000 + i)}`);
    const batches = smsBatches([...phones, phones[0], null], 'Hi', 20, ANDROID);
    expect(batches.map((b) => b.count)).toEqual([20, 15]);
    expect(batches[1]!.link).toBe(`sms:${phones.slice(20).map((p) => `+1${p}`).join(',')}?body=Hi`);
    expect(smsBatches(phones, '', 10, IPHONE).map((b) => b.count)).toEqual([10, 10, 10, 5]);
    expect(smsBatches([], 'x', 20)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { keyBytes } from '../src/lib/push';

describe('phone notifications', () => {
  it('turns the public key into the bytes phones subscribe with', () => {
    // "AQID_w" is base64url for bytes 1, 2, 3, 255 (no padding, - and _ instead of + and /).
    expect([...keyBytes('AQID_w')]).toEqual([1, 2, 3, 255]);
  });
});

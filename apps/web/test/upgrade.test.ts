import { describe, expect, it } from 'vitest';
import { namesLine } from '../src/components/UpgradeCard';
import { shareDollars } from '../src/lib/plans';

describe("each golfer's share of Pro", () => {
  it('splits $149 across the golfers, rounded up to whole dollars so it covers the price', () => {
    expect(shareDollars(24)).toBe(7); // $6.21 each
    expect(shareDollars(8)).toBe(19); // $18.63 each
    expect(shareDollars(149)).toBe(1);
    expect(shareDollars(400)).toBe(1); // never less than a dollar
    expect(shareDollars(0)).toBeNull();
  });
});

describe('who said they would chip in', () => {
  it('reads naturally with first names', () => {
    expect(namesLine(['Joe Smith'])).toBe('Joe');
    expect(namesLine(['Joe Smith', 'Mike Walsh'])).toBe('Joe and Mike');
    expect(namesLine(['Joe Smith', 'Mike Walsh', 'Dave K'])).toBe('Joe, Mike and Dave');
    expect(namesLine(['Joe', 'Mike', 'Dave', 'Rob', 'Gary', 'Jim'])).toBe('Joe, Mike and 4 others');
  });
});

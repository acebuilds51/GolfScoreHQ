import { beforeEach, describe, expect, it } from 'vitest';
import { cached, cacheKey, remember, resetCacheForTests, setCacheOwner } from '../src/lib/cache';

const loadWeek = () => Promise.resolve('week');
const loadRoster = () => Promise.resolve('roster');

describe('screen cache', () => {
  beforeEach(() => resetCacheForTests());

  it('gives back what a screen loaded last time, per loader and inputs', () => {
    setCacheOwner('tony');
    remember(cacheKey(loadWeek, ['league-1', 'week-3']), { week: 3 });
    expect(cached(cacheKey(loadWeek, ['league-1', 'week-3']))).toEqual({ week: 3 });
    expect(cached(cacheKey(loadWeek, ['league-1', 'week-4']))).toBeUndefined();
    expect(cached(cacheKey(loadRoster, ['league-1', 'week-3']))).toBeUndefined();
  });

  it('only caches loaders whose inputs are plain values', () => {
    expect(cacheKey(loadWeek, ['league-1', true, 3, null])).not.toBeNull();
    expect(cacheKey(loadWeek, [{ players: [] }])).toBeNull();
  });

  it('keeps nothing when nobody is signed in', () => {
    remember(cacheKey(loadWeek, ['league-1']), 'secret');
    expect(cached(cacheKey(loadWeek, ['league-1']))).toBeUndefined();
  });

  it('wipes everything when someone else signs in, or on sign-out', () => {
    setCacheOwner('tony');
    const key = cacheKey(loadWeek, ['league-1']);
    remember(key, 'tony data');
    setCacheOwner('tony'); // same person: kept
    expect(cached(key)).toBe('tony data');
    setCacheOwner('ben');
    expect(cached(key)).toBeUndefined();
    remember(key, 'ben data');
    setCacheOwner(null);
    expect(cached(key)).toBeUndefined();
  });
});

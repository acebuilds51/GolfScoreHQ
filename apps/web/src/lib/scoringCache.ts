import { remember } from './cache';
import type { RoundData } from './types';

// The scoring screen needs its week and round. The week page already has both,
// so it saves each group's copy on the phone while there's signal: a golfer who
// loses signal before ever opening their round can still open it and score.

export const scoringCacheKey = (roundId: string) => `score:${roundId}`;

const savedAt = new Map<string, number>();

/**
 * What the scoring screen loads: the week (from loadWeek) plus its round. The week
 * page refreshes often while groups play, so each round is saved at most once a minute.
 */
export function rememberScoring<W extends { rounds: RoundData[] }>(week: W, roundIds: string[], now = Date.now()) {
  for (const round of week.rounds) {
    if (!roundIds.includes(round.id) || now - (savedAt.get(round.id) ?? 0) < 60_000) continue;
    savedAt.set(round.id, now);
    remember(scoringCacheKey(round.id), { ...week, round });
  }
}

/** The scoring screen keeps its saved copy up to date as holes are entered (not throttled). */
export function rememberRound<W>(week: W, round: RoundData) {
  savedAt.set(round.id, Date.now());
  remember(scoringCacheKey(round.id), { ...week, round });
}

/** Weeks worth saving: today's, give or take a day (or undated). */
export function isAroundToday(eventDate: string | null | undefined, now = new Date()): boolean {
  if (!eventDate) return true;
  const day = Date.parse(`${eventDate.slice(0, 10)}T12:00:00`);
  return Number.isNaN(day) || Math.abs(day - now.getTime()) < 36 * 3600 * 1000;
}

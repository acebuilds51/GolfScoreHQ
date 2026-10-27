import { courseHandicap, differentialsFrom, handicapIndex, nineHoleCourseHandicap, strokesByHole, type HandicapRules, type ScoreRecord } from '@golfscorehq/engine';
import type { Layout, Player, RoundData } from './types';

// Handicaps in the app: which Handicap Index a golfer plays off (GHIN or the
// league's own calculation) and their Course Handicap on a given nine.

export type HandicapSource = NonNullable<HandicapRules['source']>;

export const DEFAULT_HANDICAPS: HandicapRules = { enabled: false, allowance: 90, match: 'offLow', skins: 'gross', source: 'ghinFirst' };

/**
 * Rating and slope for a layout. Cards without them are treated as rating =
 * par and slope = 113 (an average course), which is close enough for a league
 * until the commissioner fills them in.
 */
export function ratingSlope(layout: Pick<Layout, 'holes' | 'rating' | 'slope'>): { rating: number; slope: number; par: number; estimated: boolean } {
  const par = layout.holes.reduce((s, h) => s + h.par, 0);
  const estimated = layout.rating == null || layout.slope == null;
  return { rating: layout.rating ?? par, slope: layout.slope ?? 113, par, estimated };
}

/** Course Handicap on this layout: the nine-hole formula for a nine, the 18-hole one otherwise. */
export function courseHandicapFor(index: number, layout: Pick<Layout, 'holes' | 'rating' | 'slope'>): number {
  const { rating, slope, par } = ratingSlope(layout);
  return layout.holes.length <= 9 ? nineHoleCourseHandicap(index, slope, rating, par) : courseHandicap(index, slope, rating, par);
}

export interface PlayedRound {
  round: RoundData;
  layout: Layout;
}

/**
 * A golfer's completed league rounds as WHS score records, oldest first.
 * Hole scores are capped like WHS: net double bogey when we know their index,
 * otherwise par + 5 (the WHS cap for golfers without a handicap yet).
 */
export function leagueScoreRecords(playerId: string, played: PlayedRound[], knownIndex: number | null): ScoreRecord[] {
  const out: ScoreRecord[] = [];
  for (const { round, layout } of played) {
    if (!round.players.some((p) => p.playerId === playerId)) continue;
    const scores = layout.holes.map((h) => round.scores[playerId]?.[h.number]);
    if (scores.some((s) => s == null)) continue; // only complete rounds count
    const strokes = knownIndex == null ? null : strokesByHole(courseHandicapFor(knownIndex, layout), layout.holes);
    const adjusted = layout.holes.reduce((sum, h, i) => sum + Math.min(scores[i]!, h.par + (strokes ? 2 + strokes[i]! : 5)), 0);
    const { rating, slope } = ratingSlope(layout);
    out.push({ score: adjusted, rating, slope, holes: layout.holes.length <= 9 ? 9 : 18 });
  }
  return out;
}

export interface IndexInfo {
  /** The index this golfer plays off right now, or null (plays without strokes). */
  index: number | null;
  from: 'ghin' | 'league' | null;
  /** The league's own calculation, when there are enough rounds (3 eighteen-hole scores, or 6 nines). */
  leagueIndex: number | null;
  /** Complete league rounds counted. */
  leagueRounds: number;
}

/** Work out every golfer's index from what's entered and what they've played. */
export function leagueIndexes(players: Player[], played: PlayedRound[], source: HandicapSource): Map<string, IndexInfo> {
  const out = new Map<string, IndexInfo>();
  for (const p of players) {
    const records = leagueScoreRecords(p.id, played, p.handicapIndex);
    const leagueIndex = handicapIndex(differentialsFrom(records));
    const ghin = p.handicapIndex;
    let index: number | null = null;
    let from: IndexInfo['from'] = null;
    if (source !== 'league' && ghin != null) { index = ghin; from = 'ghin'; }
    else if (source !== 'ghin' && leagueIndex != null) { index = leagueIndex; from = 'league'; }
    out.set(p.id, { index, from, leagueIndex, leagueRounds: records.length });
  }
  return out;
}

/**
 * Every completed league round, oldest first, with its layout. Free leagues
 * only see the current season, so their calculation uses that season.
 */
export async function loadPlayedRounds(api: import('./api').Api, leagueId: string): Promise<PlayedRound[]> {
  const [seasons, courses] = await Promise.all([api.seasons(leagueId), api.courses(leagueId)]);
  const layouts = new Map(courses.flatMap((c) => c.layouts).map((l) => [l.id, l]));
  const perSeason = await Promise.all(
    [...seasons].sort((a, b) => a.year - b.year).map(async (s) => {
      const [events, rounds] = await Promise.all([api.events(s.id), api.seasonRounds(s.id)]);
      return [...events]
        // Scramble scores are team scores, so they never count toward anyone's handicap.
        .filter((e) => e.status !== 'rainout' && e.layoutId && layouts.has(e.layoutId) && (e.rulesOverride ?? s.rules).format !== 'scramble')
        .sort((a, b) => a.weekNumber - b.weekNumber)
        .flatMap((e) => rounds.filter((r) => r.eventId === e.id).sort((a, b) => a.teeSlot - b.teeSlot).map((round) => ({ round, layout: layouts.get(e.layoutId!)! })));
    }),
  );
  return perSeason.flat();
}

/** "12.4", or "+1.2" for a plus handicap. */
export const fmtIndex = (n: number) => (n < 0 ? `+${Math.abs(n).toFixed(1)}` : n.toFixed(1));

/** Read what a commissioner types: "12.4", "+1.2" (plus handicap) or blank. */
export function parseIndex(s: string): number | null | 'bad' {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\+)?(\d{1,2}(\.\d)?)$/);
  if (!m) return 'bad';
  const n = Number(m[2]) * (m[1] ? -1 : 1);
  return n >= -10 && n <= 54 ? n : 'bad';
}

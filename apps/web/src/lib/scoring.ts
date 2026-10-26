import {
  dollars,
  scoreMatch,
  settleCtp,
  type BestBallMatchRules,
  type CtpReport,
  type FormatRules,
  type MatchRoundInput,
  type MatchResult,
} from '@golfscorehq/engine';
import type { Course, Layout, RoundData } from './types';

/**
 * Scorecard mark for a score relative to par, the way golfers draw it:
 * circle = birdie, double circle = eagle or better, square = bogey, double square = double bogey or worse.
 */
export function scoreMark(toPar: number | null): '' | 'eagle' | 'birdie' | 'bogey' | 'double' {
  if (toPar === null || toPar === 0) return '';
  return toPar <= -2 ? 'eagle' : toPar === -1 ? 'birdie' : toPar === 1 ? 'bogey' : 'double';
}

/** Rules for a league with no side games (what Free allows). */
export function basicRules(): BestBallMatchRules {
  return {
    format: 'bestBallMatch',
    holeScoring: 'bestBall',
    match: { stake: 0 },
    presses: { enabled: false, stake: 0 },
    skins: { enabled: false, tieRule: 'noSkin', payout: 'splitPot', pot: 0 },
    ctp: { enabled: false, amountPerHole: 0, resolution: 'markerChain' },
  };
}

export interface SideGameForm {
  matchStake: string;
  pressesEnabled: boolean;
  pressStake: string;
  skinsEnabled: boolean;
  skinsPot: string;
  skinsTieRule: 'noSkin' | 'carryover';
  ctpEnabled: boolean;
  ctpAmount: string;
}

export const OCBC_STYLE_FORM: SideGameForm = {
  matchStake: '5', pressesEnabled: true, pressStake: '10',
  skinsEnabled: true, skinsPot: '180', skinsTieRule: 'noSkin',
  ctpEnabled: true, ctpAmount: '36',
};

const money = (s: string) => Math.max(0, dollars(Number(s) || 0));

export function rulesFromForm(f: SideGameForm): BestBallMatchRules {
  return {
    format: 'bestBallMatch',
    holeScoring: 'bestBall',
    match: { stake: money(f.matchStake) },
    presses: { enabled: f.pressesEnabled, stake: f.pressesEnabled ? money(f.pressStake) : 0 },
    skins: {
      enabled: f.skinsEnabled,
      tieRule: f.skinsTieRule,
      payout: f.skinsTieRule === 'carryover' ? 'perHole' : 'splitPot',
      pot: f.skinsEnabled ? money(f.skinsPot) : 0,
    },
    ctp: { enabled: f.ctpEnabled, amountPerHole: f.ctpEnabled ? money(f.ctpAmount) : 0, resolution: 'markerChain' },
  };
}

export function formFromRules(r: FormatRules): SideGameForm {
  if (r.format !== 'bestBallMatch') return { ...OCBC_STYLE_FORM };
  const d = (c: number) => String(c / 100);
  return {
    matchStake: d(r.match.stake), pressesEnabled: r.presses.enabled, pressStake: d(r.presses.stake),
    skinsEnabled: r.skins.enabled, skinsPot: d(r.skins.pot), skinsTieRule: r.skins.tieRule,
    ctpEnabled: r.ctp.enabled, ctpAmount: d(r.ctp.amountPerHole),
  };
}

export function asBestBall(r: FormatRules): BestBallMatchRules {
  return r.format === 'bestBallMatch' ? r : basicRules();
}

export const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

export function describeRules(r: FormatRules): string[] {
  if (r.format !== 'bestBallMatch') return ['Scramble'];
  const out = ['2 vs 2 best ball match'];
  if (r.match.stake) out.push(`${fmtMoney(r.match.stake)} a man on the match`);
  if (r.presses.enabled) out.push(`presses ${fmtMoney(r.presses.stake)} a man`);
  if (r.skins.enabled) out.push(`skins ${fmtMoney(r.skins.pot)} pot${r.skins.tieRule === 'carryover' ? ' (ties carry over)' : ' (ties: no skin)'}`);
  if (r.ctp.enabled) out.push(`CTP ${fmtMoney(r.ctp.amountPerHole)} per par 3`);
  return out;
}

/** All layouts across the league's courses, for picking a week's nine. */
export function allLayouts(courses: Course[]): (Layout & { courseName: string })[] {
  return courses.flatMap((c) => c.layouts.map((l) => ({ ...l, courseName: c.name })));
}

/** Alternate front/back nines by week, like OCBC: odd weeks the first layout, even weeks the second. */
export function layoutForWeek(courses: Course[], weekNumber: number): string | null {
  const own = courses.find((c) => c.leagueId !== null) ?? courses[0];
  if (!own || !own.layouts.length) return null;
  if (own.layouts.length >= 2 && own.layouts.every((l) => l.holes.length === 9)) {
    return own.layouts[(weekNumber - 1) % 2]!.id;
  }
  return own.layouts[0]!.id;
}

export function nextDate(startDate: string | null, weekNumber: number): string | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + 7 * (weekNumber - 1));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The engine's view of a round. Holes without a score for a player are null. */
export function toEngineRound(round: RoundData, layout: Layout, onlyCompleted = false): MatchRoundInput {
  const thru = onlyCompleted ? holesCompleted(round, layout) : layout.holes.length;
  const scores: MatchRoundInput['scores'] = {};
  for (const p of round.players) {
    scores[p.playerId] = layout.holes.map((h, i) => (i < thru ? round.scores[p.playerId]?.[h.number] ?? null : null));
  }
  const ctp: Record<number, CtpReport> = {};
  for (const [hole, c] of Object.entries(round.ctp)) {
    ctp[Number(hole)] = c.playerId ? { winner: c.playerId, beat: c.beat } : 'none';
  }
  return {
    id: round.id,
    teeSlot: round.teeSlot,
    players: round.players.map((p) => (p.side ? { id: p.playerId, side: p.side } : { id: p.playerId })),
    scores,
    presses: round.presses
      .map((p) => ({ startHoleIndex: layout.holes.findIndex((h) => h.number === p.startHole), calledBy: p.calledBy }))
      .filter((p) => p.startHoleIndex >= 0),
    ctp,
  };
}

/** Holes (from the first) where every player in the group has a score. */
export function holesCompleted(round: RoundData, layout: Layout): number {
  let n = 0;
  for (const h of layout.holes) {
    if (!round.players.length || !round.players.every((p) => round.scores[p.playerId]?.[h.number] != null)) break;
    n++;
  }
  return n;
}

export function matchSoFar(round: RoundData, layout: Layout, rules: FormatRules): { result: MatchResult; thru: number; label: string } {
  const thru = holesCompleted(round, layout);
  const result = scoreMatch(toEngineRound(round, layout, true), layout.holes.length, asBestBall(rules));
  const hasMatch = round.players.some((p) => p.side === 'A') && round.players.some((p) => p.side === 'B');
  const { A, B } = result.holesWon;
  let label: string;
  if (!hasMatch) label = thru ? `Thru ${thru}` : 'Not started';
  else if (thru === 0) label = 'Not started';
  else if (thru === layout.holes.length) label = A === B ? `Halved ${A}–${B}` : `${A > B ? 'A' : 'B'} won ${Math.max(A, B)}–${Math.min(A, B)}`;
  else label = A === B ? `All square thru ${thru}` : `${A > B ? 'A' : 'B'} ${Math.abs(A - B)} up thru ${thru}`;
  return { result, thru, label };
}

/** Who holds the CTP marker on a par 3 right now, from every other group's claims this week. */
export function currentMarker(otherRounds: RoundData[], layout: Layout, holeNumber: number): { holder: string | null; disputed: boolean } {
  const res = settleCtp(
    otherRounds.map((r) => ({ roundId: r.id, teeSlot: r.teeSlot, ctp: toEngineRound(r, layout).ctp })),
    [holeNumber],
    { enabled: true, amountPerHole: 0, resolution: 'markerChain' },
  );
  const h = res.holes[0];
  return { holder: h?.winner ?? null, disputed: !!h?.conflict };
}

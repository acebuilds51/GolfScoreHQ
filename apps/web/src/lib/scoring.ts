import {
  dollars,
  isIndividual,
  scoreMatch,
  scramblePayouts,
  settleCtp,
  STANDARD_STABLEFORD,
  type BestBallMatchRules,
  type CtpReport,
  type FormatRules,
  type HandicapRules,
  type IndividualRules,
  type MatchRoundInput,
  type MatchResult,
  type ScrambleRules,
} from '@golfscorehq/engine';
import { DEFAULT_HANDICAPS } from './handicaps';
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

export type FormatKey = 'bestBallMatch' | 'strokePlay' | 'stableford' | 'scramble';

export const FORMAT_NAMES: Record<FormatKey, string> = {
  bestBallMatch: '2 vs 2 best ball match',
  strokePlay: 'Stroke play',
  stableford: 'Stableford',
  scramble: 'Scramble',
};

/** The rules a week is played under: its special-week rules (e.g. the scramble), else the season's. */
export const weekRules = (season: { rules: FormatRules }, event: { rulesOverride?: FormatRules | null } | null | undefined): FormatRules =>
  event?.rulesOverride ?? season.rules;

/** Each group is one team playing one ball. */
export const isScramble = (r: FormatRules): r is ScrambleRules => r.format === 'scramble';

/** Free leagues play these; the rest need Pro ("all formats"). Matches rules_are_basic_format() in the database. */
export const BASIC_FORMATS: FormatKey[] = ['bestBallMatch', 'strokePlay'];

/** No side games or money, in the chosen format (what Free allows). */
export function plainRules(format: FormatKey): FormatRules {
  const b = basicRules();
  if (format === 'bestBallMatch') return b;
  if (format === 'strokePlay') return { format, payouts: [], skins: b.skins, ctp: b.ctp };
  if (format === 'scramble') return { format, teamPot: 0, payouts: [], skins: b.skins, ctp: b.ctp };
  return { format, points: STANDARD_STABLEFORD, payouts: [], skins: b.skins, ctp: b.ctp };
}

/** Each golfer plays their own ball against the field: groups have no sides. */
export const individualRules = (r: FormatRules): IndividualRules | null => (isIndividual(r) ? r : null);

export const handicapRules = (r: FormatRules): HandicapRules | undefined => r.handicaps;

/** Anything in these rules pays out money. */
export function playsForMoney(r: FormatRules): boolean {
  if (r.skins.enabled || r.ctp.enabled) return true;
  if (r.format === 'bestBallMatch') return r.match.stake > 0 || r.presses.enabled;
  if (r.format === 'scramble') return r.teamPot > 0 || (r.payouts ?? []).some((c) => c > 0);
  return r.payouts.some((c) => c > 0);
}

export interface SideGameForm {
  format: FormatKey;
  /** Prize money by place, in dollars, comma separated: "30, 20, 10". */
  payouts: string;
  matchStake: string;
  pressesEnabled: boolean;
  pressStake: string;
  skinsEnabled: boolean;
  skinsPot: string;
  skinsTieRule: 'noSkin' | 'carryover';
  ctpEnabled: boolean;
  ctpAmount: string;
  hcpEnabled: boolean;
  hcpAllowance: string;
  hcpMatch: HandicapRules['match'];
  hcpSkins: HandicapRules['skins'];
  hcpSource: NonNullable<HandicapRules['source']>;
}

export const OCBC_STYLE_FORM: SideGameForm = {
  format: 'bestBallMatch', payouts: '30, 20, 10',
  matchStake: '5', pressesEnabled: true, pressStake: '10',
  skinsEnabled: true, skinsPot: '180', skinsTieRule: 'noSkin',
  ctpEnabled: true, ctpAmount: '36',
  hcpEnabled: false, hcpAllowance: String(DEFAULT_HANDICAPS.allowance), hcpMatch: DEFAULT_HANDICAPS.match, hcpSkins: DEFAULT_HANDICAPS.skins, hcpSource: DEFAULT_HANDICAPS.source!,
};

/** Handicap settings work on every plan, so they're kept apart from the (Pro) side games. */
export function handicapsFromForm(f: SideGameForm): HandicapRules {
  const pct = Math.round(Number(f.hcpAllowance));
  return {
    enabled: f.hcpEnabled,
    allowance: pct >= 50 && pct <= 100 ? pct : DEFAULT_HANDICAPS.allowance,
    match: f.hcpMatch, skins: f.hcpSkins, source: f.hcpSource,
  };
}

const money = (s: string) => Math.max(0, dollars(Number(s) || 0));

/** "30, 20, 10" → cents by place. Blank or zero places at the end are dropped. */
export function parsePayouts(s: string): number[] {
  const out = s.split(/[,\s]+/).filter(Boolean).map((x) => money(x.replace(/^\$/, ''))).slice(0, 10);
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

export function rulesFromForm(f: SideGameForm): FormatRules {
  const skins = {
    enabled: f.skinsEnabled,
    tieRule: f.skinsTieRule,
    payout: f.skinsTieRule === 'carryover' ? 'perHole' : 'splitPot',
    pot: f.skinsEnabled ? money(f.skinsPot) : 0,
  } as const;
  const ctp = { enabled: f.ctpEnabled, amountPerHole: f.ctpEnabled ? money(f.ctpAmount) : 0, resolution: 'markerChain' } as const;
  if (f.format === 'strokePlay') return { format: 'strokePlay', payouts: parsePayouts(f.payouts), skins, ctp, handicaps: handicapsFromForm(f) };
  if (f.format === 'stableford') return { format: 'stableford', points: STANDARD_STABLEFORD, payouts: parsePayouts(f.payouts), skins, ctp, handicaps: handicapsFromForm(f) };
  if (f.format === 'scramble') return { format: 'scramble', teamPot: 0, payouts: parsePayouts(f.payouts), skins, ctp, handicaps: handicapsFromForm(f) };
  return {
    format: 'bestBallMatch',
    holeScoring: 'bestBall',
    match: { stake: money(f.matchStake) },
    presses: { enabled: f.pressesEnabled, stake: f.pressesEnabled ? money(f.pressStake) : 0 },
    skins,
    ctp,
    handicaps: handicapsFromForm(f),
  };
}

export function formFromRules(r: FormatRules): SideGameForm {
  const d = (c: number) => String(c / 100);
  const h = { ...DEFAULT_HANDICAPS, ...r.handicaps };
  const base = {
    ...OCBC_STYLE_FORM,
    format: r.format,
    skinsEnabled: r.skins.enabled, skinsPot: d(r.skins.pot), skinsTieRule: r.skins.tieRule,
    ctpEnabled: r.ctp.enabled, ctpAmount: d(r.ctp.amountPerHole),
    hcpEnabled: h.enabled, hcpAllowance: String(h.allowance), hcpMatch: h.match, hcpSkins: h.skins, hcpSource: h.source ?? 'ghinFirst',
  };
  if (r.format === 'scramble') {
    // Older scramble rules have a single team pot for 1st instead of payouts by place.
    return { ...base, payouts: scramblePayouts(r).map(d).join(', '), matchStake: '0', pressesEnabled: false };
  }
  if (r.format !== 'bestBallMatch') return { ...base, payouts: r.payouts.map(d).join(', '), matchStake: '0', pressesEnabled: false };
  return { ...base, matchStake: d(r.match.stake), pressesEnabled: r.presses.enabled, pressStake: d(r.presses.stake) };
}

export function asBestBall(r: FormatRules): BestBallMatchRules {
  return r.format === 'bestBallMatch' ? r : basicRules();
}

export const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function describeRules(r: FormatRules): string[] {
  const out = [FORMAT_NAMES[r.format]];
  if (r.format === 'stableford') out.push('points: double bogey 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5');
  if (r.format === 'scramble') out.push('one team score per hole');
  const places = r.format === 'scramble' ? scramblePayouts(r) : r.format === 'bestBallMatch' ? [] : r.payouts;
  if (r.format === 'bestBallMatch') {
    if (r.match.stake) out.push(`${fmtMoney(r.match.stake)} a man on the match`);
    if (r.presses.enabled) out.push(`presses ${fmtMoney(r.presses.stake)} a man`);
  } else if (places.some((c) => c > 0)) {
    out.push(`pays ${places.map((c, i) => `${ordinal(i + 1)} ${fmtMoney(c)}`).join(', ')}${r.format === 'scramble' ? ' a team' : ''}`);
  }
  if (r.skins.enabled) out.push(`skins ${fmtMoney(r.skins.pot)} pot${r.skins.tieRule === 'carryover' ? ' (ties carry over)' : ' (ties: no skin)'}`);
  if (r.ctp.enabled) out.push(`CTP ${fmtMoney(r.ctp.amountPerHole)} per par 3`);
  const h = r.handicaps;
  if (h?.enabled) {
    if (r.format === 'bestBallMatch') {
      const match = h.match === 'gross' ? 'gross match' : `net match (${h.allowance}%${h.match === 'offLow' ? ', off the low man' : ''})`;
      out.push(`${match}, ${h.skins} skins`);
    } else if (r.format === 'scramble') {
      out.push(`net with a team handicap, ${h.skins} skins`);
    } else {
      out.push(`net scoring (${h.allowance}% of handicap), ${h.skins} skins`);
    }
  } else {
    out.push('gross scoring');
  }
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
    courseHandicaps: Object.fromEntries(round.players.map((p) => [p.playerId, p.courseHandicap ?? null])),
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
  const result = scoreMatch(toEngineRound(round, layout, true), layout.holes.length, asBestBall(rules), layout.holes);
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

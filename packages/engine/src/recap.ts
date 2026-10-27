import { settleIndividualWeek } from './individual';
import { totalsByPlayer } from './money';
import type { BestBallMatchRules, IndividualRules, ScrambleRules } from './rules';
import { scrambleRoundFrom, settleScrambleWeek } from './scramble';
import type { Cents, Layout, LedgerEntry, MatchRoundInput, PlayerId, Side } from './types';
import { settleBestBallWeek } from './week';

export interface RecapMatch {
  roundId: string;
  teeSlot: number;
  teamA: PlayerId[];
  teamB: PlayerId[];
  holesWon: Record<Side, number>;
  winner: Side | null;
}

export interface RecapHighlight {
  playerId: PlayerId;
  kind: 'ace' | 'eagle' | 'birdie';
  holeNumber: number;
}

/** A finishing place in stroke play, Stableford (one golfer) or a scramble (a team). Complete rounds only. */
export interface RecapPlace {
  playerIds: PlayerId[];
  place: number;
  tied: boolean;
  /** Gross strokes. */
  score: number;
  grossToPar: number;
  /** Net to par when the league plays net, otherwise the same as grossToPar. */
  toPar: number;
  /** Stableford points; null in stroke play. */
  points: number | null;
}

export interface WeeklyRecap {
  week: number;
  layoutName: string;
  format: 'bestBallMatch' | 'strokePlay' | 'stableford' | 'scramble';
  /** Scores (and places) are net. */
  net: boolean;
  skinsEnabled: boolean;
  /** Stroke play, Stableford and scramble: the week's finishing order, best first. Empty for match formats. */
  leaderboard: RecapPlace[];
  matches: RecapMatch[];
  skins: { holeNumber: number; playerIds: PlayerId[]; value: Cents }[];
  ctp: { holeNumber: number; winner: PlayerId | null; disputed: boolean }[];
  /** Best ones first: aces, then eagles, then birdies (by hole). */
  highlights: RecapHighlight[];
  lowRound: { playerIds: PlayerId[]; score: number; toPar: number } | null;
  /** What each player won (+) or owes (−) this week. */
  weekBalances: Record<PlayerId, Cents>;
  /** Season to date, including this week, when earlier ledger entries are supplied. */
  seasonBalances: Record<PlayerId, Cents>;
}

const KIND_ORDER = { ace: 0, eagle: 1, birdie: 2 } as const;

export function weeklyRecap(
  week: number,
  rounds: MatchRoundInput[],
  layout: Layout,
  rules: BestBallMatchRules | IndividualRules | ScrambleRules,
  earlierLedger: LedgerEntry[] = [],
): WeeklyRecap {
  const scramble = rules.format === 'scramble';
  const settled = rules.format === 'scramble'
    ? settleScrambleWeek(rounds.map(scrambleRoundFrom), layout, rules)
    : rules.format === 'bestBallMatch' ? settleBestBallWeek(rounds, layout, rules) : settleIndividualWeek(rounds, layout, rules);
  const par = layout.holes.reduce((s, h) => s + h.par, 0);

  const leaderboard: RecapPlace[] = 'leaderboard' in settled
    ? settled.leaderboard
        .filter((l) => l.place !== null)
        .map((l) => ({ playerIds: [l.playerId], place: l.place!, tied: l.tied, score: l.gross, grossToPar: l.grossToPar, toPar: l.toPar, points: l.points }))
    : 'standings' in settled
      ? settled.standings
          .filter((t) => t.place !== null)
          .map((t) => ({ playerIds: t.players, place: t.place!, tied: t.tied, score: t.total, grossToPar: t.grossToPar, toPar: t.toPar, points: null }))
      : [];

  const matches: RecapMatch[] = ('matches' in settled ? settled.matches : [])
    .map((m) => {
      const r = rounds.find((x) => x.id === m.roundId)!;
      return {
        roundId: m.roundId,
        teeSlot: r.teeSlot,
        teamA: r.players.filter((p) => p.side === 'A').map((p) => p.id),
        teamB: r.players.filter((p) => p.side === 'B').map((p) => p.id),
        holesWon: m.holesWon,
        winner: m.winner,
      };
    })
    .filter((m) => m.teamA.length && m.teamB.length)
    .sort((a, b) => a.teeSlot - b.teeSlot);

  const highlights: RecapHighlight[] = [];
  let low: WeeklyRecap['lowRound'] = null;
  for (const r of scramble ? [] : rounds) {
    for (const p of r.players) {
      const scores = r.scores[p.id] ?? [];
      layout.holes.forEach((h, i) => {
        const v = scores[i];
        if (v == null) return;
        const kind = v === 1 ? 'ace' : v - h.par <= -2 ? 'eagle' : v - h.par === -1 ? 'birdie' : null;
        if (kind) highlights.push({ playerId: p.id, kind, holeNumber: h.number });
      });
      if (scores.length === layout.holes.length && scores.every((v) => v != null)) {
        const score = scores.reduce<number>((t, v) => t + (v ?? 0), 0);
        if (!low || score < low.score) low = { playerIds: [p.id], score, toPar: score - par };
        else if (score === low.score && !low.playerIds.includes(p.id)) low.playerIds.push(p.id);
      }
    }
  }
  highlights.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.holeNumber - b.holeNumber);

  return {
    week,
    layoutName: layout.name,
    format: rules.format,
    net: !!rules.handicaps?.enabled,
    skinsEnabled: rules.skins.enabled,
    leaderboard,
    matches,
    skins: settled.skins.wins.map((w) => ({ holeNumber: w.holeNumber, playerIds: w.playerIds, value: w.value })),
    ctp: settled.ctp.holes.map((h) => ({ holeNumber: h.holeNumber, winner: h.winner, disputed: h.conflict })),
    highlights,
    lowRound: low,
    weekBalances: totalsByPlayer(settled.ledger),
    seasonBalances: totalsByPlayer([...earlierLedger, ...settled.ledger]),
  };
}

/**
 * Use what the commissioner actually posted when settling the week (which
 * includes their decisions on disputed CTPs) for the CTP winners and the
 * week's and season's balances, instead of recalculating them.
 */
export function withPostedResults(recap: WeeklyRecap, weekLedger: LedgerEntry[], seasonLedger: LedgerEntry[]): WeeklyRecap {
  const ctpWinners = new Map(weekLedger.filter((e) => e.kind === 'ctp' && e.holeNumber).map((e) => [e.holeNumber!, e.playerId]));
  return {
    ...recap,
    ctp: recap.ctp.map((c) => (ctpWinners.has(c.holeNumber) ? { ...c, winner: ctpWinners.get(c.holeNumber)!, disputed: false } : c)),
    weekBalances: totalsByPlayer(weekLedger),
    seasonBalances: totalsByPlayer(seasonLedger),
  };
}

const toParText = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
const money = (c: Cents) => `${c < 0 ? '-' : '+'}$${(Math.abs(c) / 100).toFixed(2).replace(/\.00$/, '')}`;

/**
 * Plain-text recap for an email body or a group text. Pass a lookup for
 * display names; amounts are left out when hideMoney is set.
 */
export function recapText(recap: WeeklyRecap, name: (id: PlayerId) => string, opts: { leagueName?: string; hideMoney?: boolean } = {}): string {
  // A scramble team reads better by first names: "Al / Bob / Cal".
  const names = (ids: PlayerId[]) =>
    recap.format === 'scramble' && ids.length > 1 ? ids.map((id) => name(id).split(' ')[0]).join(' / ') : ids.map(name).join(' & ');
  const lines: string[] = [];
  lines.push(`${opts.leagueName ? opts.leagueName + ' — ' : ''}Week ${recap.week} recap (${recap.layoutName})`, '');

  if (recap.matches.length) {
    lines.push('MATCHES');
    for (const m of recap.matches) {
      const score = `${m.holesWon.A}–${m.holesWon.B}`;
      lines.push(
        m.winner === null
          ? `  ${names(m.teamA)} halved with ${names(m.teamB)} (${score})`
          : `  ${names(m.winner === 'A' ? m.teamA : m.teamB)} beat ${names(m.winner === 'A' ? m.teamB : m.teamA)} (${m.winner === 'A' ? score : `${m.holesWon.B}–${m.holesWon.A}`})`,
      );
    }
    lines.push('');
  }

  if (recap.leaderboard.length) {
    const top = recap.leaderboard.filter((l) => l.place <= 10);
    const title = recap.format === 'stableford' ? 'STABLEFORD' : recap.format === 'scramble' ? 'SCRAMBLE' : 'STROKE PLAY';
    lines.push(`${title}${recap.net ? ' (NET)' : ''}`);
    for (const l of top) {
      const pos = `${l.tied ? 'T' : ''}${l.place}.`;
      const result = recap.format === 'stableford'
        ? `${l.points} pts (${l.score})`
        : recap.net ? `net ${toParText(l.toPar)} (${l.score} gross)` : `${l.score} (${toParText(l.toPar)})`;
      lines.push(`  ${pos} ${names(l.playerIds)} — ${result}`);
    }
    if (recap.leaderboard.length > top.length) lines.push(`  …and ${recap.leaderboard.length - top.length} more`);
    lines.push('');
  }

  if (recap.skinsEnabled) {
    lines.push('SKINS');
    if (recap.skins.length) {
      for (const s of recap.skins) lines.push(`  Hole ${s.holeNumber}: ${names(s.playerIds)}${opts.hideMoney ? '' : ` (${money(s.value)})`}`);
    } else lines.push('  No skins — every hole tied');
    lines.push('');
  }

  if (recap.ctp.length) {
    lines.push('CLOSEST TO THE PIN');
    for (const c of recap.ctp) {
      lines.push(`  Hole ${c.holeNumber}: ${c.disputed ? 'disputed — commissioner will decide' : c.winner ? name(c.winner) : 'nobody'}`);
    }
    lines.push('');
  }

  if (recap.lowRound) {
    lines.push(`LOW ROUND${recap.net || recap.format === 'stableford' ? ' (GROSS)' : ''}: ${names(recap.lowRound.playerIds)} — ${recap.lowRound.score} (${toParText(recap.lowRound.toPar)})`, '');
  }

  if (recap.highlights.length) {
    lines.push('HIGHLIGHTS');
    for (const h of recap.highlights) lines.push(`  ${h.kind === 'ace' ? 'Hole-in-one' : h.kind === 'eagle' ? 'Eagle' : 'Birdie'} — ${name(h.playerId)}, hole ${h.holeNumber}`);
    lines.push('');
  }

  if (!opts.hideMoney) {
    const rows = Object.entries(recap.weekBalances).filter(([, c]) => c !== 0).sort((a, b) => b[1] - a[1]);
    if (rows.length) {
      lines.push('THIS WEEK');
      for (const [id, c] of rows) lines.push(`  ${name(id)}: ${money(c)}`);
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd();
}

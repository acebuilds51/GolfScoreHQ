import { totalsByPlayer } from './money';
import type { BestBallMatchRules } from './rules';
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

export interface WeeklyRecap {
  week: number;
  layoutName: string;
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
  rules: BestBallMatchRules,
  earlierLedger: LedgerEntry[] = [],
): WeeklyRecap {
  const settled = settleBestBallWeek(rounds, layout, rules);
  const par = layout.holes.reduce((s, h) => s + h.par, 0);

  const matches: RecapMatch[] = settled.matches
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
  for (const r of rounds) {
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
    matches,
    skins: settled.skins.wins.map((w) => ({ holeNumber: w.holeNumber, playerIds: w.playerIds, value: w.value })),
    ctp: settled.ctp.holes.map((h) => ({ holeNumber: h.holeNumber, winner: h.winner, disputed: h.conflict })),
    highlights,
    lowRound: low,
    weekBalances: totalsByPlayer(settled.ledger),
    seasonBalances: totalsByPlayer([...earlierLedger, ...settled.ledger]),
  };
}

const money = (c: Cents) => `${c < 0 ? '-' : '+'}$${(Math.abs(c) / 100).toFixed(2).replace(/\.00$/, '')}`;

/**
 * Plain-text recap for an email body or a group text. Pass a lookup for
 * display names; amounts are left out when hideMoney is set.
 */
export function recapText(recap: WeeklyRecap, name: (id: PlayerId) => string, opts: { leagueName?: string; hideMoney?: boolean } = {}): string {
  const names = (ids: PlayerId[]) => ids.map(name).join(' & ');
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

  lines.push('SKINS');
  if (recap.skins.length) {
    for (const s of recap.skins) lines.push(`  Hole ${s.holeNumber}: ${names(s.playerIds)}${opts.hideMoney ? '' : ` (${money(s.value)})`}`);
  } else lines.push('  No skins — every hole tied');
  lines.push('');

  if (recap.ctp.length) {
    lines.push('CLOSEST TO THE PIN');
    for (const c of recap.ctp) {
      lines.push(`  Hole ${c.holeNumber}: ${c.disputed ? 'disputed — commissioner will decide' : c.winner ? name(c.winner) : 'nobody'}`);
    }
    lines.push('');
  }

  if (recap.lowRound) {
    const tp = recap.lowRound.toPar;
    lines.push(`LOW ROUND: ${names(recap.lowRound.playerIds)} — ${recap.lowRound.score} (${tp === 0 ? 'E' : tp > 0 ? `+${tp}` : tp})`, '');
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

import { playingHandicap, stablefordPoints, strokesByHole, type FormatRules } from '@golfscorehq/engine';
import { currentMarker, handicapRules, matchSoFar } from './scoring';
import type { Layout, RoundData } from './types';

// What the live leaderboard (and later the Clubhouse TV) shows during a round.
// Everything is provisional until the week is settled.

export interface LiveLine {
  playerId: string;
  roundId: string;
  teeSlot: number;
  side: 'A' | 'B' | null;
  /** Holes played, counting from the first hole without a gap. */
  thru: number;
  strokes: number;
  /** What the leaderboard ranks on: net to par when the league plays with handicaps, otherwise gross. */
  toPar: number;
  grossToPar: number;
  /** Stableford points so far (net with handicaps on); null in other formats. */
  points: number | null;
  /** Lower is better: to par, or minus the points in Stableford. Equal ranks are tied. */
  rank: number;
  finished: boolean;
}

export interface LiveSkin {
  holeNumber: number;
  /** The one golfer with the low score so far, or null if it's tied (or nobody has played it). */
  playerId: string | null;
  score: number | null;
  tiedCount: number;
}

export interface LiveHighlight {
  playerId: string;
  holeNumber: number;
  kind: 'ace' | 'eagle' | 'birdie';
}

export interface LiveBoard {
  lines: LiveLine[];
  matches: { roundId: string; teeSlot: number; teamA: string[]; teamB: string[]; extra: string[]; label: string; thru: number; status: RoundData['status'] }[];
  skins: LiveSkin[];
  ctp: { holeNumber: number; holder: string | null; disputed: boolean }[];
  highlights: LiveHighlight[];
  groupsOnCourse: number;
  groupsDone: number;
  /** True when lines rank on net scores. */
  net: boolean;
  format: 'bestBallMatch' | 'strokePlay' | 'stableford';
}

export function liveBoard(rounds: RoundData[], layout: Layout, rulesIn: FormatRules): LiveBoard {
  const rules = rulesIn;
  const lines: LiveLine[] = [];
  const highlights: LiveHighlight[] = [];
  const pts = rules.format === 'stableford' ? rules.points : null;

  const hcpRules = handicapRules(rules);
  const hcp = hcpRules?.enabled ? hcpRules : null;
  for (const r of rounds) {
    for (const p of r.players) {
      // Net uses each golfer's own strokes (after the allowance), not off the low man.
      const given = hcp ? strokesByHole(playingHandicap(p.courseHandicap ?? 0, hcp.allowance), layout.holes) : null;
      let thru = 0;
      let strokes = 0;
      let par = 0;
      let received = 0;
      let points = 0;
      for (const [i, h] of layout.holes.entries()) {
        const s = r.scores[p.playerId]?.[h.number];
        if (s == null) break;
        thru++;
        strokes += s;
        par += h.par;
        received += given?.[i] ?? 0;
        if (pts) points += stablefordPoints(s - (given?.[i] ?? 0) - h.par, pts);
        const kind = s === 1 ? 'ace' : s - h.par <= -2 ? 'eagle' : s - h.par === -1 ? 'birdie' : null;
        if (kind) highlights.push({ playerId: p.playerId, holeNumber: h.number, kind });
      }
      if (thru === 0) continue;
      const gross = strokes - par;
      const toPar = gross - received;
      lines.push({
        playerId: p.playerId, roundId: r.id, teeSlot: r.teeSlot, side: p.side, thru, strokes, toPar, grossToPar: gross,
        points: pts ? points : null, rank: pts ? -points : toPar, finished: thru === layout.holes.length,
      });
    }
  }
  lines.sort((a, b) => a.rank - b.rank || b.thru - a.thru || a.teeSlot - b.teeSlot);
  const order = { ace: 0, eagle: 1, birdie: 2 } as const;
  highlights.sort((a, b) => order[a.kind] - order[b.kind] || a.holeNumber - b.holeNumber);

  const skins: LiveSkin[] = rules.skins.enabled
    ? layout.holes.map((h) => {
        const scores = rounds.flatMap((r) => r.players.map((p) => ({ playerId: p.playerId, s: r.scores[p.playerId]?.[h.number] })))
          .filter((x): x is { playerId: string; s: number } => x.s != null);
        if (!scores.length) return { holeNumber: h.number, playerId: null, score: null, tiedCount: 0 };
        const low = Math.min(...scores.map((x) => x.s));
        const at = scores.filter((x) => x.s === low);
        return { holeNumber: h.number, playerId: at.length === 1 ? at[0]!.playerId : null, score: low, tiedCount: at.length };
      })
    : [];

  const ctp = rules.ctp.enabled
    ? layout.holes.filter((h) => h.par === 3).map((h) => ({ holeNumber: h.number, ...currentMarker(rounds, layout, h.number) }))
    : [];

  const matches = [...rounds].sort((a, b) => a.teeSlot - b.teeSlot).map((r) => {
    const side = (s: 'A' | 'B' | null) => r.players.filter((p) => p.side === s).map((p) => p.playerId);
    const m = matchSoFar(r, layout, rulesIn);
    return { roundId: r.id, teeSlot: r.teeSlot, teamA: side('A'), teamB: side('B'), extra: side(null), label: m.label, thru: m.thru, status: r.status };
  });

  return {
    lines, matches, skins, ctp, highlights,
    groupsOnCourse: rounds.filter((r) => r.status !== 'submitted').length,
    groupsDone: rounds.filter((r) => r.status === 'submitted').length,
    net: !!hcp,
    format: rules.format === 'scramble' ? 'bestBallMatch' : rules.format,
  };
}

export const fmtLiveToPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

/** What a line shows as its score: points in Stableford, otherwise to par. */
export const lineScore = (l: LiveLine) => (l.points !== null ? `${l.points} pts` : fmtLiveToPar(l.toPar));

import type { FormatRules } from '@golfscorehq/engine';
import { asBestBall, currentMarker, matchSoFar } from './scoring';
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
  toPar: number;
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
}

export function liveBoard(rounds: RoundData[], layout: Layout, rulesIn: FormatRules): LiveBoard {
  const rules = asBestBall(rulesIn);
  const lines: LiveLine[] = [];
  const highlights: LiveHighlight[] = [];

  for (const r of rounds) {
    for (const p of r.players) {
      let thru = 0;
      let strokes = 0;
      let par = 0;
      for (const h of layout.holes) {
        const s = r.scores[p.playerId]?.[h.number];
        if (s == null) break;
        thru++;
        strokes += s;
        par += h.par;
        const kind = s === 1 ? 'ace' : s - h.par <= -2 ? 'eagle' : s - h.par === -1 ? 'birdie' : null;
        if (kind) highlights.push({ playerId: p.playerId, holeNumber: h.number, kind });
      }
      if (thru === 0) continue;
      lines.push({ playerId: p.playerId, roundId: r.id, teeSlot: r.teeSlot, side: p.side, thru, strokes, toPar: strokes - par, finished: thru === layout.holes.length });
    }
  }
  lines.sort((a, b) => a.toPar - b.toPar || b.thru - a.thru || a.teeSlot - b.teeSlot);
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
  };
}

export const fmtLiveToPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

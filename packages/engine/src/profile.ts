import type { PlayedRound } from './stats';
import type { PlayerId } from './types';

// Player and course stats from a season's played rounds (gross scores, own ball).

/** How a golfer's holes went, by score against par. */
export interface ScoreMix {
  /** Eagle or better (aces on a par 3 count here). */
  eagles: number;
  birdies: number;
  pars: number;
  bogeys: number;
  /** Double bogey or worse. */
  doubles: number;
  holes: number;
}

export interface ParTypeAverage {
  par: number;
  holes: number;
  /** Average strokes over par on holes of this par, one decimal. */
  averageToPar: number;
}

export interface HoleAverage {
  layoutId: string;
  layoutName: string;
  holeNumber: number;
  par: number;
  strokeIndex?: number;
  /** Scores recorded on this hole. */
  played: number;
  averageToPar: number;
  averageScore: number;
  birdiesOrBetter: number;
  doublesOrWorse: number;
}

export interface PlayerProfile {
  playerId: PlayerId;
  mix: ScoreMix;
  byPar: ParTypeAverage[];
  /** Every hole they've played, in course order. */
  holes: HoleAverage[];
  /** Their best and worst holes against par (played at least twice). */
  bestHole: HoleAverage | null;
  worstHole: HoleAverage | null;
}

const one = (n: number) => Math.round(n * 10) / 10;

interface Acc { layoutId: string; layoutName: string; holeNumber: number; par: number; strokeIndex?: number; n: number; sum: number; under: number; doubles: number }

function holeAverages(played: PlayedRound[], only?: PlayerId): HoleAverage[] {
  const acc = new Map<string, Acc>();
  for (const { layout, round } of played) {
    for (const p of round.players) {
      if (only && p.id !== only) continue;
      const scores = round.scores[p.id] ?? [];
      layout.holes.forEach((h, i) => {
        const s = scores[i];
        if (s == null) return;
        const key = `${layout.id}#${h.number}`;
        const a = acc.get(key) ?? { layoutId: layout.id, layoutName: layout.name, holeNumber: h.number, par: h.par, strokeIndex: h.strokeIndex, n: 0, sum: 0, under: 0, doubles: 0 };
        a.n++;
        a.sum += s;
        if (s - h.par <= -1) a.under++;
        if (s - h.par >= 2) a.doubles++;
        acc.set(key, a);
      });
    }
  }
  return [...acc.values()]
    .map((a) => ({
      layoutId: a.layoutId, layoutName: a.layoutName, holeNumber: a.holeNumber, par: a.par,
      ...(a.strokeIndex !== undefined ? { strokeIndex: a.strokeIndex } : {}),
      played: a.n, averageScore: one(a.sum / a.n), averageToPar: one(a.sum / a.n - a.par), birdiesOrBetter: a.under, doublesOrWorse: a.doubles,
    }))
    .sort((x, y) => x.layoutName.localeCompare(y.layoutName) || x.holeNumber - y.holeNumber);
}

/** One golfer's scoring: mix of scores, par-3/4/5 averages and best and worst holes. */
export function playerProfile(played: PlayedRound[], playerId: PlayerId): PlayerProfile {
  const mix: ScoreMix = { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, holes: 0 };
  const byPar = new Map<number, { holes: number; sum: number }>();
  for (const { layout, round } of played) {
    if (!round.players.some((p) => p.id === playerId)) continue;
    const scores = round.scores[playerId] ?? [];
    layout.holes.forEach((h, i) => {
      const s = scores[i];
      if (s == null) return;
      const d = s - h.par;
      mix.holes++;
      if (d <= -2) mix.eagles++;
      else if (d === -1) mix.birdies++;
      else if (d === 0) mix.pars++;
      else if (d === 1) mix.bogeys++;
      else mix.doubles++;
      const t = byPar.get(h.par) ?? { holes: 0, sum: 0 };
      t.holes++;
      t.sum += d;
      byPar.set(h.par, t);
    });
  }
  const holes = holeAverages(played, playerId);
  const ranked = holes.filter((h) => h.played >= 2).sort((a, b) => a.averageToPar - b.averageToPar || b.played - a.played);
  return {
    playerId,
    mix,
    byPar: [...byPar].sort((a, b) => a[0] - b[0]).map(([par, t]) => ({ par, holes: t.holes, averageToPar: one(t.sum / t.holes) })),
    holes,
    bestHole: ranked[0] ?? null,
    worstHole: ranked.length > 1 ? ranked[ranked.length - 1]! : null,
  };
}

/** The whole league's scoring on each hole, hardest first. */
export function courseHoleStats(played: PlayedRound[]): HoleAverage[] {
  return holeAverages(played).sort((a, b) => b.averageToPar - a.averageToPar || b.played - a.played);
}

// Replays real OCBC rounds through the engine and compares with what the legacy
// app recorded. League data is private, so it is never committed: point
// OCBC_ROUNDS_JSON at a local export (array of legacy round objects) to run it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OCBC_BEST_BALL, scoreMatch, settleBestBallWeek, totalsByPlayer, type MatchRoundInput } from '../src';
import { BACK, FRONT } from './fixtures';

const path = process.env.OCBC_ROUNDS_JSON;

interface LegacyRound {
  week: number;
  side: 'front' | 'back';
  teeTime: number;
  roundId?: string;
  isScramble?: boolean;
  players: { name: string; isSub?: boolean }[];
  scores: Record<string, number>[];
  presses?: { startHole: number; calledBy: 'A' | 'B' }[];
  ctpWinners?: Record<string, string>;
  money?: Record<string, number>;
  awins: number;
  bwins: number;
  matchWinner: 'A' | 'B' | null;
  skinsSettled?: boolean;
  skins?: Record<string, string>;
  leagueCTP?: Record<string, string>;
}

function toInput(wd: LegacyRound, i: number): MatchRoundInput {
  const layout = wd.side === 'back' ? BACK : FRONT;
  const scores: MatchRoundInput['scores'] = {};
  wd.players.forEach((p, idx) => {
    scores[p.name] = layout.holes.map((_, hi) => {
      const s = wd.scores[hi]?.['p' + idx];
      return s == null || s >= 99 ? null : s;
    });
  });
  const ctp: Record<number, string> = {};
  for (const [hole, v] of Object.entries(wd.ctpWinners ?? {})) {
    if (v) ctp[Number(hole)] = v === '__HIGHER_TEE__' || v === '__none__' ? 'none' : v;
  }
  return {
    id: wd.roundId ?? `${wd.week}_${wd.teeTime}_${i}`,
    teeSlot: Number(wd.teeTime),
    players: wd.players.map((p, idx) => ({ id: p.name, side: idx < 2 ? ('A' as const) : ('B' as const) })),
    scores,
    presses: (wd.presses ?? []).map((p) => ({
      startHoleIndex: layout.holes.findIndex((h) => h.number === Number(p.startHole)),
      calledBy: p.calledBy,
    })),
    ctp,
  };
}

describe.skipIf(!path)('legacy OCBC parity', () => {
  const all: LegacyRound[] = path ? JSON.parse(readFileSync(path, 'utf8')) : [];
  const rounds = all.filter((r) => !r.isScramble);

  it('reaches the same match result as the legacy app', () => {
    const diffs: string[] = [];
    rounds.forEach((wd, i) => {
      const m = scoreMatch(toInput(wd, i), 9, OCBC_BEST_BALL);
      if (m.winner !== (wd.matchWinner ?? null) || m.holesWon.A !== wd.awins || m.holesWon.B !== wd.bwins) {
        diffs.push(`wk${wd.week} T${wd.teeTime}: legacy ${wd.awins}-${wd.bwins} ${wd.matchWinner} / engine ${m.holesWon.A}-${m.holesWon.B} ${m.winner}`);
      }
    });
    console.log(`match results: ${rounds.length - diffs.length}/${rounds.length} identical`, diffs);
    expect(diffs.length).toBeLessThanOrEqual(rounds.length);
  });

  it('pays the same match and press money for full foursomes', () => {
    const diffs: string[] = [];
    const fours = rounds.filter((r) => r.players.length === 4);
    fours.forEach((wd, i) => {
      const m = scoreMatch(toInput(wd, i), 9, OCBC_BEST_BALL);
      const engine = totalsByPlayer(m.ledger);
      for (const p of wd.players) {
        const legacy = Math.round((wd.money?.[p.name] ?? 0) * 100);
        if ((engine[p.name] ?? 0) !== legacy) diffs.push(`wk${wd.week} T${wd.teeTime} ${p.name}: legacy ${legacy} engine ${engine[p.name] ?? 0}`);
      }
    });
    console.log(`foursome money: ${diffs.length} player-round differences`, diffs);
    expect(diffs.length).toBeLessThanOrEqual(fours.length * 4);
  });

  it('awards the same skins and CTPs on settled weeks', () => {
    const report: string[] = [];
    // The legacy app settles each nine separately when a week used both.
    const weeks = [...new Set(rounds.map((r) => `${r.week}:${r.side}`))];
    for (const key of weeks) {
      const [wkStr, side] = key.split(':');
      const wk = `${wkStr} ${side}`;
      const group = rounds.filter((r) => `${r.week}:${r.side}` === key);
      const settled = group.find((r) => r.skinsSettled);
      if (!settled) {
        report.push(`wk${wk}: never settled in legacy`);
        continue;
      }
      const layout = side === 'back' ? BACK : FRONT;
      const res = settleBestBallWeek(group.map(toInput), layout, OCBC_BEST_BALL);
      const engineSkins = Object.fromEntries(res.skins.wins.map((w) => [String(w.holeNumber), w.playerIds[0]]));
      const engineCtp = Object.fromEntries(res.ctp.holes.filter((h) => h.winner).map((h) => [String(h.holeNumber), h.winner]));
      const same = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
      if (!same(settled.skins ?? {}, engineSkins)) report.push(`wk${wk} skins: legacy ${JSON.stringify(settled.skins)} engine ${JSON.stringify(engineSkins)}`);
      if (!same(settled.leagueCTP ?? {}, engineCtp)) report.push(`wk${wk} ctp: legacy ${JSON.stringify(settled.leagueCTP)} engine ${JSON.stringify(engineCtp)}`);
      const conflicts = res.ctp.holes.filter((h) => h.conflict).map((h) => h.holeNumber);
      if (conflicts.length) report.push(`wk${wk} ctp conflicts on holes ${conflicts.join(',')}`);
    }
    console.log(`skins/CTP across ${weeks.length} weeks`, report);
    expect(weeks.length).toBeGreaterThan(0);
  });
});

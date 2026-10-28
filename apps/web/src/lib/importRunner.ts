import type { Api } from './api';
import { matchRoster, norm, type ImportPlan } from './importer';
import { weekRules } from './scoring';
import { settleWeek } from './settlement';
import type { Layout, RoundPlayer, Season } from './types';

export interface ImportResult {
  golfersAdded: number;
  weeksAdded: number[];
  /** Weeks that already had groups in this season; left alone. */
  weeksSkipped: number[];
  groupsAdded: number;
  /** Weeks settled after importing (or why settling failed). */
  settled: number[];
  problems: string[];
}

/**
 * Write a plan into a season with the normal API calls (so every database
 * rule still applies): add missing golfers, then for each week create it,
 * start each group, save the scores, presses and CTPs, and submit. Weeks that
 * already have groups are never touched. Optionally settle each new week with
 * the season's rules.
 */
export async function runImport(
  api: Api,
  input: { leagueId: string; season: Season; plan: ImportPlan; layouts: Layout[]; settle: boolean },
  onProgress: (text: string) => void,
): Promise<ImportResult> {
  const { leagueId, season, plan, layouts } = input;
  const result: ImportResult = { golfersAdded: 0, weeksAdded: [], weeksSkipped: [], groupsAdded: 0, settled: [], problems: [] };

  onProgress('Adding golfers…');
  let roster = await api.players(leagueId);
  const { missing } = matchRoster(plan.names, roster);
  if (missing.length) {
    await api.addPlayers(leagueId, missing.map((displayName) => ({ displayName, isSub: plan.subs.includes(displayName) })));
    result.golfersAdded = missing.length;
    roster = await api.players(leagueId);
  }
  // Look golfers up by name, ignoring spacing and capitals, so every spelling in the file finds the same roster spot.
  const byName = new Map(roster.map((p) => [norm(p.displayName), p.id]));
  const idOf = (name: string) => byName.get(norm(name));

  const events = await api.events(season.id);
  for (const w of plan.weeks) {
    onProgress(`Week ${w.week}…`);
    let ev = events.find((e) => e.weekNumber === w.week);
    if (ev && (await api.eventRounds(ev.id)).length) {
      result.weeksSkipped.push(w.week);
      continue;
    }
    const eventId = ev?.id ?? (await api.createEvent(leagueId, season.id, { weekNumber: w.week, eventDate: toIsoDate(w.date), layoutId: w.layoutId }));
    if (ev && !ev.layoutId) await api.updateEvent(eventId, { layoutId: w.layoutId });

    for (const g of w.groups) {
      const players: RoundPlayer[] = g.players
        .map((p, i) => ({ playerId: idOf(p.name)!, side: p.side, position: i, courseHandicap: null }))
        // Skip golfers not found, and a golfer listed twice in one group (two spellings of one name).
        .filter((p, i, all) => p.playerId && all.findIndex((x) => x.playerId === p.playerId) === i);
      if (!players.length) continue;
      const roundId = await api.startRound(leagueId, eventId, g.teeSlot, players);
      const entries = g.players.flatMap((p) => Object.entries(p.scores).map(([hole, strokes]) => ({ playerId: idOf(p.name)!, holeNumber: Number(hole), strokes })));
      if (entries.length) await api.saveScores(leagueId, roundId, entries);
      for (const p of g.presses) await api.addPress(leagueId, roundId, p.startHole, p.calledBy);
      for (const [hole, who] of Object.entries(g.ctp)) {
        await api.saveCtp(leagueId, roundId, Number(hole), { playerId: who ? idOf(who) ?? null : null, beat: null });
      }
      await api.submitRound(roundId);
      result.groupsAdded++;
    }
    result.weeksAdded.push(w.week);

    if (input.settle) {
      try {
        const layout = layouts.find((l) => l.id === w.layoutId)!;
        ev = (await api.event(eventId)) ?? ev;
        const rounds = await api.eventRounds(eventId);
        const settlement = settleWeek(rounds, layout, weekRules(season, ev));
        await api.settleEvent(eventId, settlement.entries);
        result.settled.push(w.week);
      } catch (e) {
        result.problems.push(`Week ${w.week} was imported but not settled: ${(e as Error).message}`);
      }
    }
  }
  return result;
}

/** "2026-05-07", "5/7/2026" or "May 7, 2026" → "2026-05-07"; anything else → null. */
export function toIsoDate(s: string | null): string | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3]!.length === 2 ? `20${us[3]}` : us[3]!;
    return `${y}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

import { recapText, weeklyRecap, withPostedResults, type LedgerEntry, type WeeklyRecap } from '@golfscorehq/engine';
import { asBestBall, toEngineRound } from './scoring';
import type { Layout, LeagueEvent, LedgerRow, Player, RoundData, Season } from './types';

const toEntry = (e: LedgerRow): LedgerEntry => ({
  playerId: e.playerId, amount: e.amountCents, kind: e.kind, ...(e.holeNumber ? { holeNumber: e.holeNumber } : {}),
});

/**
 * The same recap the email uses: engine results for the week, with money and
 * CTP winners from what the commissioner posted.
 */
export function buildWeekRecap(input: {
  leagueName: string;
  event: LeagueEvent;
  season: Season;
  layout: Layout;
  rounds: RoundData[];
  weekLedger: LedgerRow[];
  seasonLedger: LedgerRow[];
  players: Pick<Player, 'id' | 'displayName'>[];
  hideMoney?: boolean;
}): { recap: WeeklyRecap; text: string } {
  const rules = input.season.rules.format === 'scramble' ? asBestBall(input.season.rules) : input.season.rules;
  const recap = withPostedResults(
    weeklyRecap(input.event.weekNumber, input.rounds.map((r) => toEngineRound(r, input.layout)), { id: input.layout.id, name: input.layout.name, holes: input.layout.holes }, rules),
    input.weekLedger.map(toEntry),
    input.seasonLedger.map(toEntry),
  );
  const names = new Map(input.players.map((p) => [p.id, p.displayName]));
  return { recap, text: recapText(recap, (id) => names.get(id) ?? '?', { leagueName: input.leagueName, hideMoney: input.hideMoney }) };
}

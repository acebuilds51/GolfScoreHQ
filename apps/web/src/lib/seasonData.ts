import { api } from './backend';
import { allLayouts } from './scoring';
import { buildStandings } from './standings';

/** Everything the standings, player and awards pages need for the league's current season. */
export async function loadSeasonData(leagueId: string) {
  const [seasons, courses, players] = await Promise.all([api.seasons(leagueId), api.courses(leagueId), api.players(leagueId)]);
  const season = seasons[0];
  if (!season) return null;
  const [events, rounds, ledger] = await Promise.all([api.events(season.id), api.seasonRounds(season.id), api.seasonLedger(season.id)]);
  const layouts = allLayouts(courses);
  return { season, events, rounds, ledger, players, layouts, standings: buildStandings({ season, events, rounds, ledger, layouts, players }) };
}

export type SeasonData = NonNullable<Awaited<ReturnType<typeof loadSeasonData>>>;

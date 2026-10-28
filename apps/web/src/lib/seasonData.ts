import { useSearchParams } from 'react-router-dom';
import { api } from './backend';
import { useLeague } from './hooks';
import { allLayouts } from './scoring';
import { buildStandings } from './standings';

/**
 * Everything the standings, player and awards pages need for one season: the
 * one asked for, else the league's current (newest) season.
 */
export async function loadSeasonData(leagueId: string, seasonId?: string | null) {
  const [seasons, courses, players] = await Promise.all([api.seasons(leagueId), api.courses(leagueId), api.players(leagueId)]);
  const season = seasons.find((s) => s.id === seasonId) ?? seasons[0];
  if (!season) return null;
  const [events, rounds, ledger] = await Promise.all([api.events(season.id), api.seasonRounds(season.id), api.seasonLedger(season.id)]);
  const layouts = allLayouts(courses);
  return { seasons, season, events, rounds, ledger, players, layouts, standings: buildStandings({ season, events, rounds, ledger, layouts, players }) };
}

export type SeasonData = NonNullable<Awaited<ReturnType<typeof loadSeasonData>>>;

/**
 * The season picked on the standings, awards and player pages (?season=…).
 * Past seasons are Pro ("history"); free leagues always see the current one.
 * `query` keeps the pick on links between those pages.
 */
export function useSeasonChoice(): { seasonId: string | null; query: string } {
  const { league } = useLeague();
  const [params] = useSearchParams();
  const seasonId = league.features.includes('history') ? params.get('season') : null;
  return { seasonId, query: seasonId ? `?season=${encodeURIComponent(seasonId)}` : '' };
}

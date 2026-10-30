import { resizeBanner, resizeLogo } from './brand';
import type { DemoApi } from './demoApi';
import { saveDemoTvToken } from './demoSite';
import { courseHandicapFor } from './handicaps';
import { OCBC_STYLE_FORM, rulesFromForm, weekRules } from './scoring';
import { settleWeek } from './settlement';
import type { Layout, RoundPlayer, TvPanel } from './types';

// golfscorehq.app/demo: a made-up league that fills itself in, in this browser
// only, so a golf pro can tap around a real-looking season. Every write goes
// through the normal demo API, so the same rules apply as for a real league.

export const DEMO_SLUG = 'demo-thursday-league';

/**
 * A demo dressed up for one course, from the /demo link
 * (?league=…&course=…&city=…&state=…&color=…&accent=…) plus pictures picked on this device.
 */
export interface DemoLook {
  league?: string;
  course?: string;
  city?: string;
  state?: string;
  /** League colors as hex, e.g. "0b5d3b" or "#0b5d3b". */
  color?: string;
  accent?: string;
  logo?: File | null;
  photo?: File | null;
}

const hex = (s?: string) => (s && /^#?[0-9a-f]{6}$/i.test(s.trim()) ? `#${s.trim().replace(/^#/, '').toLowerCase()}` : null);
const text = (s: string | undefined, max: number) => s?.trim().replace(/\s+/g, ' ').slice(0, max) || null;

/** Read a personalized demo from the link's query string. */
export function demoLookFromSearch(search: string): DemoLook {
  const q = new URLSearchParams(search);
  return {
    league: text(q.get('league') ?? undefined, 60) ?? undefined,
    course: text(q.get('course') ?? undefined, 60) ?? undefined,
    city: text(q.get('city') ?? undefined, 40) ?? undefined,
    state: text(q.get('state') ?? undefined, 2)?.toUpperCase() ?? undefined,
    color: hex(q.get('color') ?? undefined) ?? undefined,
    accent: hex(q.get('accent') ?? undefined) ?? undefined,
  };
}

const GOLFERS: [string, number][] = [
  ['Mike Russo', 6.2], ['Dave Keller', 14.8], ['Tom Brennan', 9.1], ['Gary Lindqvist', 18.4],
  ['Steve Ortiz', 11.7], ['Bob Hanley', 21.3], ['Rick Patel', 4.9], ['Jim McAllister', 16.0],
  ['Frank DeLuca', 12.5], ['Chuck Wagner', 19.6], ['Paul Simmons', 8.3], ['Ken Yamada', 15.2],
  ['Larry Novak', 10.4], ['Dan Whitfield', 22.7], ['Joe Castellano', 7.6], ['Ron Baxter', 13.9],
];
/** Partners for the season (two-man teams); opponents rotate each week. */
const TEAMS: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]];
const WEEKS_PLAYED = 6;
const TV_PANELS: TvPanel[] = ['live', 'matches', 'skins', 'ctp', 'highlights', 'standings'];

// Front and back nine of a made-up par-72 course (White tees).
const FRONT = { pars: [4, 5, 3, 4, 4, 4, 3, 5, 4], si: [7, 3, 17, 1, 11, 5, 15, 9, 13], rating: 35.1, slope: 126 };
const BACK = { pars: [4, 5, 3, 4, 4, 3, 4, 5, 4], si: [8, 2, 18, 6, 10, 16, 4, 12, 14], rating: 35.0, slope: 126 };

/** Same numbers every time, so every demo looks the same. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Round-robin of the 8 teams: week w's four matches as [team, team]. */
function pairings(week: number): [number, number][] {
  const order = [0, ...Array.from({ length: 7 }, (_, i) => 1 + ((i + week) % 7))];
  return [0, 1, 2, 3].map((i) => [order[i]!, order[7 - i]!]);
}

/**
 * Wipe this browser's demo data and build the sample league: course, 16
 * golfers with handicaps, a best-ball season with skins/CTP/presses, six
 * settled weeks, tonight's week with three groups on the course, and a TV link.
 * Returns the league's slug.
 */
export async function seedDemoLeague(api: DemoApi, onProgress: (text: string) => void = () => {}, look: DemoLook = {}): Promise<string> {
  const rand = rng(2027);
  api.reset();
  await api.signIn('commissioner@demo.golfscorehq.app', '/');

  onProgress('Setting up the league…');
  const leagueId = await api.createLeague(look.league || "Thursday Men's League", DEMO_SLUG);
  // The Course plan, so the TV shows the sponsor screen a course can sell.
  await api.setPlan(leagueId, 'club');
  await api.updateLeague(leagueId, {
    timezone: 'America/New_York', showMoney: true,
    ...(look.color ? { brandColor: hex(look.color) } : {}), ...(look.accent ? { accentColor: hex(look.accent) } : {}),
  });
  // Pictures that can't be read are skipped: the demo still works without them.
  if (look.logo) await api.uploadLogo(leagueId, await resizeLogo(look.logo)).catch(() => {});
  if (look.photo) await api.uploadBanner(leagueId, await resizeBanner(look.photo)).catch(() => {});

  await api.createCourse(leagueId, {
    name: look.course || 'Demo Golf Club', city: look.city || 'Cape Coral', state: look.state || 'FL',
    layouts: [FRONT, BACK].map((n, k) => ({
      name: k ? 'Back 9' : 'Front 9', tees: 'White', rating: n.rating, slope: n.slope,
      holes: n.pars.map((par, i) => ({ number: k * 9 + i + 1, par, strokeIndex: n.si[i]! })),
    })),
  });
  const layouts: Layout[] = (await api.courses(leagueId)).find((c) => c.leagueId === leagueId)!.layouts;

  onProgress('Adding golfers…');
  await api.addPlayers(leagueId, GOLFERS.map(([displayName]) => ({ displayName, isSub: false })));
  const roster = await api.players(leagueId);
  const idOf = (i: number) => roster.find((p) => p.displayName === GOLFERS[i]![0])!.id;
  for (let i = 0; i < GOLFERS.length; i++) await api.updatePlayer(idOf(i), { handicapIndex: GOLFERS[i]![1] });

  const today = new Date();
  const seasonId = await api.createSeason(leagueId, {
    year: today.getFullYear(), name: '',
    rules: rulesFromForm({ ...OCBC_STYLE_FORM, hcpEnabled: true }),
    startDate: isoDay(new Date(today.getTime() - WEEKS_PLAYED * 7 * 864e5)), leagueDay: today.getDay(),
  });
  await api.setSeasonTeeTimes(seasonId, ['16:30', '16:39', '16:48', '16:57']);
  const season = (await api.seasons(leagueId)).find((s) => s.id === seasonId)!;

  /** A believable score: par, plus the golfer's strokes on the hole, plus some luck. */
  const strokes = (par: number, si: number, courseHcp: number) => {
    const hcp = Math.max(0, courseHcp);
    const extra = Math.floor(hcp / 9) + (si <= hcp % 9 ? 1 : 0);
    const r = rand();
    const luck = r < 0.01 ? -2 : r < 0.12 ? -1 : r > 0.95 ? 2 : r > 0.72 ? 1 : 0;
    // No aces: a demo full of holes-in-one looks fake.
    return Math.max(par === 3 ? 2 : par - 2, Math.min(par + 4, par + extra + luck));
  };

  async function playWeek(week: number, holesPlayed: number[] | null) {
    const layout = layouts[(week - 1) % 2]!;
    const date = new Date(today.getTime() - (WEEKS_PLAYED + 1 - week) * 7 * 864e5);
    const eventId = await api.createEvent(leagueId, seasonId, { weekNumber: week, eventDate: isoDay(date), layoutId: layout.id });
    const groups = pairings(week);
    // One closest-to-the-pin winner per par 3 for the week, in a random group.
    const ctpGroup = new Map(layout.holes.filter((h) => h.par === 3).map((h) => [h.number, Math.floor(rand() * groups.length)]));

    for (let g = 0; g < groups.length; g++) {
      const done = holesPlayed ? holesPlayed[g] ?? 0 : layout.holes.length;
      if (holesPlayed && !done) continue;
      const who = groups[g]!.flatMap((t) => TEAMS[t]!);
      const golfers = who.map(idOf);
      const hcps = who.map((i) => courseHandicapFor(GOLFERS[i]![1], layout));
      const players: RoundPlayer[] = golfers.map((playerId, i) => ({ playerId, side: i < 2 ? 'A' : 'B', position: i, courseHandicap: hcps[i]! }));
      const roundId = await api.startRound(leagueId, eventId, g + 1, players);
      const holes = layout.holes.slice(0, done);
      await api.saveScores(leagueId, roundId, golfers.flatMap((playerId, i) =>
        holes.map((h) => ({ playerId, holeNumber: h.number, strokes: strokes(h.par, Math.ceil((h.strokeIndex ?? 9) / 2), hcps[i]!) }))));
      if (rand() < 0.35 && done > 5) await api.addPress(leagueId, roundId, holes[4]!.number, rand() < 0.5 ? 'A' : 'B');
      for (const h of holes.filter((x) => x.par === 3)) {
        const winner = ctpGroup.get(h.number) === g ? golfers[Math.floor(rand() * golfers.length)]! : null;
        await api.saveCtp(leagueId, roundId, h.number, { playerId: winner, beat: null });
      }
      if (holesPlayed) await api.setCurrentHole(roundId, done);
      else await api.submitRound(roundId);
    }

    if (!holesPlayed) {
      const ev = (await api.event(eventId))!;
      const settlement = settleWeek(await api.eventRounds(eventId), layout, weekRules(season, ev));
      await api.settleEvent(eventId, settlement.entries);
    }
  }

  for (let w = 1; w <= WEEKS_PLAYED; w++) {
    onProgress(`Playing week ${w}…`);
    await playWeek(w, null);
  }
  onProgress('Teeing off tonight…');
  // Tonight: three groups out on the course, the last one about to tee off.
  await playWeek(WEEKS_PLAYED + 1, [6, 4, 2, 0]);

  const tv = await api.createTvDisplay(leagueId, 'Grill room TV', {
    hideMoney: false, secondsPerPanel: 12, panels: TV_PANELS,
    sponsor: { name: `${look.course || 'Demo Golf Club'} Pro Shop`.slice(0, 60), message: 'League members: 10% off balls and gloves this week', logoUrl: null },
  });
  saveDemoTvToken(tv);
  return DEMO_SLUG;
}

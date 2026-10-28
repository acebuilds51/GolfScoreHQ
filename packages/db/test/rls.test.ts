import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, freshDb, rows, type Db } from './harness';

const FRONT_HOLES = JSON.stringify([4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })));

// Engine FormatRules: a basic match with no money (Free) and OCBC's full format (Pro).
const NO_MONEY = { enabled: false, tieRule: 'noSkin', payout: 'splitPot', pot: 0 };
const FREE_RULES = JSON.stringify({
  format: 'bestBallMatch', holeScoring: 'bestBall', match: { stake: 0 }, presses: { enabled: false, stake: 0 },
  skins: NO_MONEY, ctp: { enabled: false, amountPerHole: 0, resolution: 'markerChain' },
});
const PRO_RULES = JSON.stringify({
  format: 'bestBallMatch', holeScoring: 'bestBall', match: { stake: 500 }, presses: { enabled: true, stake: 1000 },
  skins: { enabled: true, tieRule: 'noSkin', payout: 'splitPot', pot: 18000 },
  ctp: { enabled: true, amountPerHole: 3600, resolution: 'markerChain' },
});

/** What the billing webhook (service role) does when a league subscribes. */
async function setPlan(leagueId: string, plan: string, expiresAt: string | null = null) {
  await db.query('update leagues set plan = $2, plan_expires_at = $3 where id = $1', [leagueId, plan, expiresAt]);
}

const logoUrl = (leagueId: string) => `https://foxthtwxgfnoqxrcbxfc.supabase.co/storage/v1/object/public/league-logos/${leagueId}/logo-1.png`;

let db: Db;
let tony: string; // commissioner of Oak Creek
let joe: string; //  player in Oak Creek
let sam: string; //  commissioner of a different league
let oak: string;
let pine: string;

async function league(user: string, name: string, slug: string): Promise<string> {
  return as(db, user, async () => (await rows<{ id: string }>(db, 'select create_league($1, $2) as id', [name, slug]))[0]!.id);
}

async function addPlayer(user: string, leagueId: string, name: string, isSub = false): Promise<string> {
  return as(db, user, async () =>
    (await rows<{ id: string }>(db, 'insert into players (league_id, display_name, is_sub) values ($1, $2, $3) returning id', [leagueId, name, isSub]))[0]!.id,
  );
}

/** A season, one week on a front nine, and a round in it. Returns ids. */
async function weekWithRound(user: string, leagueId: string, rules = FREE_RULES, year = 2027) {
  return as(db, user, async () => {
    const [season] = await rows<{ id: string }>(db, `insert into seasons (league_id, year, rules) values ($1, $2, $3) returning id`, [leagueId, year, rules]);
    const [course] = await rows<{ id: string }>(db, `insert into courses (league_id, name) values ($1, 'Home Course') returning id`, [leagueId]);
    const [layout] = await rows<{ id: string }>(db, `insert into layouts (course_id, name, holes) values ($1, 'Front 9', $2) returning id`, [course!.id, FRONT_HOLES]);
    const [event] = await rows<{ id: string }>(db, `insert into events (league_id, season_id, week_number, layout_id) values ($1, $2, 1, $3) returning id`, [leagueId, season!.id, layout!.id]);
    const [round] = await rows<{ id: string }>(db, `insert into rounds (league_id, event_id, tee_slot) values ($1, $2, 1) returning id`, [leagueId, event!.id]);
    return { eventId: event!.id, roundId: round!.id };
  });
}

beforeEach(async () => {
  db = await freshDb();
  tony = await createUser(db, 'tony@example.com');
  joe = await createUser(db, 'joe@example.com');
  sam = await createUser(db, 'sam@example.com');
  oak = await league(tony, 'Oak Creek Men', 'oak-creek');
  pine = await league(sam, 'Pine Valley Seniors', 'pine-valley');
  await db.query(`insert into league_members (league_id, user_id, role) values ($1, $2, 'player')`, [oak, joe]);
});

describe('tenant isolation', () => {
  it('shows each user only the leagues they belong to', async () => {
    const tonySees = await as(db, tony, () => rows<{ slug: string }>(db, 'select slug from leagues'));
    const samSees = await as(db, sam, () => rows<{ slug: string }>(db, 'select slug from leagues'));
    expect(tonySees.map((l) => l.slug)).toEqual(['oak-creek']);
    expect(samSees.map((l) => l.slug)).toEqual(['pine-valley']);
    expect(await as(db, null, () => rows(db, 'select * from leagues'))).toEqual([]);
  });

  it("hides another league's roster and blocks writing to it", async () => {
    await addPlayer(tony, oak, 'Al Oak');
    expect(await as(db, sam, () => rows(db, 'select * from players where league_id = $1', [oak]))).toEqual([]);
    await expect(addPlayer(sam, oak, 'Sneaky Sam')).rejects.toThrow(/row-level security/);
  });

  it("won't let a round in one league reference another league's player", async () => {
    const alOak = await addPlayer(tony, oak, 'Al Oak');
    const { roundId } = await weekWithRound(sam, pine);
    await expect(
      as(db, sam, () => db.query(`insert into round_players (round_id, player_id, league_id, side) values ($1, $2, $3, 'A')`, [roundId, alOak, pine])),
    ).rejects.toThrow();
  });
});

describe('roles', () => {
  it('lets only commissioners and the golfer themselves read contact details', async () => {
    const joePlayer = await addPlayer(tony, oak, 'Joe Golfer');
    const otherPlayer = await addPlayer(tony, oak, 'Other Golfer');
    await db.query('update players set user_id = $1 where id = $2', [joe, joePlayer]);
    await as(db, tony, () => db.query(`insert into player_contacts (player_id, league_id, email) values ($1, $2, 'joe@x.com'), ($3, $2, 'other@x.com')`, [joePlayer, oak, otherPlayer]));

    expect(await as(db, tony, () => rows(db, 'select email from player_contacts'))).toHaveLength(2);
    expect(await as(db, joe, () => rows(db, 'select email from player_contacts'))).toEqual([{ email: 'joe@x.com' }]);
    expect(await as(db, joe, () => rows(db, 'select display_name from players'))).toHaveLength(2); // roster names are visible
  });

  it('lets members score until the week is settled, then only commissioners', async () => {
    const al = await addPlayer(tony, oak, 'Al');
    const { eventId, roundId } = await weekWithRound(tony, oak);
    await as(db, tony, () => db.query(`insert into round_players (round_id, player_id, league_id, side) values ($1, $2, $3, 'A')`, [roundId, al, oak]));

    const score = (user: string, hole: number) =>
      as(db, user, () =>
        db.query(
          `insert into hole_scores (round_id, player_id, league_id, hole_number, strokes, entered_by) values ($1, $2, $3, $4, 4, $5)
           on conflict (round_id, player_id, hole_number) do update set strokes = excluded.strokes`,
          [roundId, al, oak, hole, user],
        ),
      );

    await score(joe, 1); // any member may score an open week
    await score(joe, 1); // retried upsert is harmless
    await as(db, tony, () => db.query(`update events set status = 'settled' where id = $1`, [eventId]));
    await expect(score(joe, 2)).rejects.toThrow(/row-level security/);
    await score(tony, 2); // commissioner correction still allowed
    expect(await rows(db, 'select hole_number from hole_scores order by 1')).toEqual([{ hole_number: 1 }, { hole_number: 2 }]);
  });

  it('records whose CTP marker a group beat, only within the same league', async () => {
    await setPlan(oak, 'pro');
    const al = await addPlayer(tony, oak, 'Al');
    const bob = await addPlayer(tony, oak, 'Bob');
    const pineGuy = await addPlayer(sam, pine, 'Pine Guy');
    const { roundId } = await weekWithRound(tony, oak);
    await as(db, joe, () => db.query(`insert into ctp_reports (round_id, league_id, hole_number, player_id, beat_player_id) values ($1, $2, 2, $3, $4)`, [roundId, oak, bob, al]));
    await expect(
      as(db, joe, () => db.query(`update ctp_reports set beat_player_id = $1 where round_id = $2`, [pineGuy, roundId])),
    ).rejects.toThrow();
    await expect(
      as(db, joe, () => db.query(`update ctp_reports set beat_player_id = player_id where round_id = $1`, [roundId])),
    ).rejects.toThrow(/ctp_reports_not_self/);
    expect(await rows(db, 'select beat_player_id from ctp_reports')).toEqual([{ beat_player_id: al }]);
  });

  it('lets any member add a sub from the first tee, reusing a matching name', async () => {
    const first = await as(db, joe, async () => (await rows<{ id: string }>(db, `select add_sub_player($1, '  Pete   Price ') as id`, [oak]))[0]!.id);
    const again = await as(db, joe, async () => (await rows<{ id: string }>(db, `select add_sub_player($1, 'pete price') as id`, [oak]))[0]!.id);
    expect(again).toBe(first);
    expect(await rows(db, 'select display_name, is_sub from players where id = $1', [first])).toEqual([{ display_name: 'Pete Price', is_sub: true }]);
    await expect(as(db, sam, () => db.query(`select add_sub_player($1, 'Sneaky')`, [oak]))).rejects.toThrow(/members only/);
  });

  it('allows one week number per season', async () => {
    const { eventId } = await weekWithRound(tony, oak);
    const [ev] = await rows<{ season_id: string }>(db, 'select season_id from events where id = $1', [eventId]);
    await expect(as(db, tony, () => db.query('insert into events (league_id, season_id, week_number) values ($1, $2, 1)', [oak, ev!.season_id]))).rejects.toThrow(/events_season_week_unique/);
  });

  it('lets only the commissioner settle, only with golfers from that week, and money only on Pro', async () => {
    const al = await addPlayer(tony, oak, 'Al');
    const notPlaying = await addPlayer(tony, oak, 'Stayed Home');
    const { eventId, roundId } = await weekWithRound(tony, oak);
    await as(db, tony, () => db.query(`insert into round_players (round_id, player_id, league_id, side) values ($1, $2, $3, 'A')`, [roundId, al, oak]));
    const entries = (player: string) => JSON.stringify([{ player_id: player, round_id: roundId, kind: 'skin', amount_cents: 9000, hole_number: 3 }]);
    const settle = (user: string, json: string) => as(db, user, () => db.query('select settle_event($1, $2::jsonb)', [eventId, json]));

    await expect(settle(tony, entries(al))).rejects.toThrow(/plan_feature: Side games/); // Free: no money
    await settle(tony, '[]'); // Free can still make the week final
    expect(await rows(db, 'select status from events where id = $1', [eventId])).toEqual([{ status: 'settled' }]);
    await as(db, tony, () => db.query('select reopen_event($1)', [eventId]));

    await setPlan(oak, 'pro');
    await expect(settle(joe, entries(al))).rejects.toThrow(/commissioners only/);
    await expect(settle(tony, entries(notPlaying))).rejects.toThrow(/not in this week/);
    await settle(tony, entries(al));
    expect(await as(db, joe, () => rows(db, 'select player_id, kind, amount_cents from ledger_entries'))).toEqual([{ player_id: al, kind: 'skin', amount_cents: 9000 }]);
    await settle(tony, entries(al)); // settling again replaces, never doubles
    expect(await rows(db, 'select count(*)::int as n from ledger_entries')).toEqual([{ n: 1 }]);

    await as(db, tony, () => db.query('select reopen_event($1)', [eventId]));
    expect(await rows(db, 'select count(*)::int as n from ledger_entries')).toEqual([{ n: 0 }]);
    expect(await rows(db, 'select status from events where id = $1', [eventId])).toEqual([{ status: 'scheduled' }]);
  });

  it('lets only commissioners record a decision on a disputed CTP', async () => {
    const al = await addPlayer(tony, oak, 'Al');
    const { eventId } = await weekWithRound(tony, oak);
    const decide = (user: string) => as(db, user, () => db.query('insert into ctp_decisions (event_id, league_id, hole_number, player_id, decided_by) values ($1, $2, 2, $3, $4)', [eventId, oak, al, user]));
    await expect(decide(joe)).rejects.toThrow(/row-level security/);
    await decide(tony);
    expect(await as(db, joe, () => rows(db, 'select hole_number from ctp_decisions'))).toEqual([{ hole_number: 2 }]);
  });

  it('keeps the ledger read-only for users', async () => {
    const al = await addPlayer(tony, oak, 'Al');
    const { eventId } = await weekWithRound(tony, oak);
    await expect(
      as(db, tony, () => db.query(`insert into ledger_entries (league_id, event_id, player_id, kind, amount_cents) values ($1, $2, $3, 'skin', 9000)`, [oak, eventId, al])),
    ).rejects.toThrow(/row-level security/);
  });

  it("doesn't let a commissioner change their own plan", async () => {
    await expect(as(db, tony, () => db.query(`update leagues set plan = 'club' where id = $1`, [oak]))).rejects.toThrow(/permission denied/);
    await as(db, tony, () => db.query(`update leagues set name = 'Oak Creek Mens League' where id = $1`, [oak]));
  });
});

describe('plans (by feature, never by size)', () => {
  it('publishes Free $0, Pro $149 and Club $299 with every golfer allowed', async () => {
    const plans = await as(db, null, () => rows<{ code: string; price_cents: number }>(db, `select code, price_cents from plans where code in ('free','pro','club') order by price_cents`));
    expect(plans).toEqual([{ code: 'free', price_cents: 0 }, { code: 'pro', price_cents: 14900 }, { code: 'club', price_cents: 29900 }]);
    for (let i = 1; i <= 45; i++) await addPlayer(tony, oak, `Player ${i}`); // no size cap on Free
    expect(await rows(db, 'select count(*)::int as n from players where league_id = $1', [oak])).toEqual([{ n: 45 }]);
  });

  it('allows one free league per owner', async () => {
    await expect(league(tony, 'Second League', 'second-league')).rejects.toThrow(/plan_limit/);
    await setPlan(oak, 'pro');
    await league(tony, 'Second League', 'second-league'); // the first league is paid, so a new free one is fine
  });

  it('keeps side games and money for Pro', async () => {
    await expect(weekWithRound(tony, oak, PRO_RULES)).rejects.toThrow(/plan_feature: Side games/);
    const { roundId } = await weekWithRound(tony, oak); // basic match with no money is fine on Free
    const al = await addPlayer(tony, oak, 'Al');
    await expect(
      as(db, joe, () => db.query(`insert into ctp_reports (round_id, league_id, hole_number, player_id) values ($1, $2, 2, $3)`, [roundId, oak, al])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(db, joe, () => db.query(`insert into presses (round_id, league_id, start_hole_number, called_by) values ($1, $2, 3, 'A')`, [roundId, oak])),
    ).rejects.toThrow(/row-level security/);

    await setPlan(oak, 'pro');
    await weekWithRound(tony, oak, PRO_RULES, 2028);
    await as(db, joe, () => db.query(`insert into presses (round_id, league_id, start_hole_number, called_by) values ($1, $2, 3, 'A')`, [roundId, oak]));
  });

  it('keeps scramble and other advanced formats for Pro', async () => {
    const scramble = JSON.stringify({ format: 'scramble', teamPot: 0, skins: NO_MONEY, ctp: { enabled: false, amountPerHole: 0, resolution: 'markerChain' } });
    await expect(weekWithRound(tony, oak, scramble)).rejects.toThrow(/plan_feature: This format/);
    await setPlan(oak, 'pilot'); // 2027 pilots get Pro features
    await weekWithRound(tony, oak, scramble);
  });

  it('lets Free play stroke play without prize money; Stableford and prize money need Pro', async () => {
    const individual = (format: string, payouts: number[]) => JSON.stringify({
      format, payouts, ...(format === 'stableford' ? { points: { albatross: 5, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0 } } : {}),
      skins: NO_MONEY, ctp: { enabled: false, amountPerHole: 0, resolution: 'markerChain' },
    });
    const { eventId, roundId } = await weekWithRound(tony, oak, individual('strokePlay', []));
    await expect(weekWithRound(tony, oak, individual('strokePlay', [3000, 2000]), 2028)).rejects.toThrow(/plan_feature: Side games/);
    await expect(weekWithRound(tony, oak, individual('stableford', []), 2029)).rejects.toThrow(/plan_feature: This format/);

    await setPlan(oak, 'pro');
    await weekWithRound(tony, oak, individual('stableford', [3000, 2000]), 2030);
    // Prize money for a place can be posted for a golfer in the week.
    const al = await addPlayer(tony, oak, 'Al');
    await as(db, tony, () => db.query(`insert into round_players (round_id, player_id, league_id) values ($1, $2, $3)`, [roundId, al, oak]));
    await as(db, tony, () => db.query('select settle_event($1, $2::jsonb)', [eventId, JSON.stringify([{ player_id: al, round_id: roundId, kind: 'place', amount_cents: 3000, hole_number: null }])]));
    expect(await rows(db, 'select kind, amount_cents from ledger_entries where event_id = $1', [eventId])).toEqual([{ kind: 'place', amount_cents: 3000 }]);
  });

  it('treats a lapsed Pro league as Free without deleting anything', async () => {
    await setPlan(oak, 'pro', '2020-01-01T00:00:00Z');
    expect(await as(db, tony, () => rows(db, `select effective_plan($1) as p`, [oak]))).toEqual([{ p: 'free' }]);
    await expect(weekWithRound(tony, oak, PRO_RULES)).rejects.toThrow(/plan_feature/);
  });

  it('keeps co-commissioners, payments and a league logo for Pro', async () => {
    const al = await addPlayer(tony, oak, 'Al');
    await expect(as(db, tony, () => db.query(`update league_members set role = 'commissioner' where league_id = $1 and user_id = $2`, [oak, joe]))).rejects.toThrow(/plan_feature: Co-commissioners/);
    await expect(as(db, tony, () => db.query(`insert into payments (league_id, player_id, amount_cents, method, recorded_by) values ($1, $2, 4000, 'venmo', $3)`, [oak, al, tony]))).rejects.toThrow(/row-level security/);
    await expect(as(db, tony, () => db.query(`update leagues set logo_url = $2 where id = $1`, [oak, logoUrl(oak)]))).rejects.toThrow(/plan_feature: League logo and colors/);

    await setPlan(oak, 'pro');
    await as(db, tony, () => db.query(`update league_members set role = 'commissioner' where league_id = $1 and user_id = $2`, [oak, joe]));
    await as(db, tony, () => db.query(`insert into payments (league_id, player_id, amount_cents, method, recorded_by) values ($1, $2, 4000, 'venmo', $3)`, [oak, al, tony]));
    await as(db, tony, () => db.query(`update leagues set logo_url = $2 where id = $1`, [oak, logoUrl(oak)]));
  });

  it('shows Free leagues their current season only; Pro sees every season', async () => {
    await weekWithRound(tony, oak, FREE_RULES, 2027);
    await weekWithRound(tony, oak, FREE_RULES, 2028);
    const seasonsSeen = () => as(db, joe, () => rows<{ year: number }>(db, 'select year from seasons order by year'));
    const roundsSeen = () => as(db, joe, () => rows(db, 'select id from rounds'));
    expect(await seasonsSeen()).toEqual([{ year: 2028 }]);
    expect(await roundsSeen()).toHaveLength(1);
    await setPlan(oak, 'pro');
    expect(await seasonsSeen()).toEqual([{ year: 2027 }, { year: 2028 }]);
    expect(await roundsSeen()).toHaveLength(2);
  });

  it('lets one Club cover up to 5 leagues, each with Pro features', async () => {
    const [club] = await rows<{ id: string }>(db, `insert into clubs (name, owner_id) values ('Crystal Lake Golf', $1) returning id`, [tony]);
    const ids = [oak];
    await setPlan(oak, 'club');
    for (let i = 2; i <= 6; i++) {
      await db.query(`insert into leagues (name, slug, owner_id, plan) values ($1, $2, $3, 'club') returning id`, [`League ${i}`, `league-${i}`, tony]);
      ids.push((await rows<{ id: string }>(db, 'select id from leagues where slug = $1', [`league-${i}`]))[0]!.id);
    }
    for (const id of ids.slice(0, 5)) await db.query('update leagues set club_id = $1 where id = $2', [club!.id, id]);
    await expect(db.query('update leagues set club_id = $1 where id = $2', [club!.id, ids[5]])).rejects.toThrow(/plan_limit: a Club covers up to 5/);

    await weekWithRound(tony, oak, PRO_RULES); // club league has Pro features
    await db.query(`update clubs set plan_expires_at = '2020-01-01' where id = $1`, [club!.id]);
    expect(await as(db, tony, () => rows(db, `select effective_plan($1) as p`, [oak]))).toEqual([{ p: 'free' }]);
  });
});

describe('Pro features: RSVP, sub finder, TV, setup, notifications', () => {
  async function linkedPlayer(user: string, name: string) {
    const id = await addPlayer(tony, oak, name);
    await db.query('update players set user_id = $1 where id = $2', [user, id]);
    return id;
  }

  it('lets a golfer answer their own RSVP on Pro, not anyone else’s', async () => {
    const { eventId } = await weekWithRound(tony, oak);
    const joeSpot = await linkedPlayer(joe, 'Joe');
    const other = await addPlayer(tony, oak, 'Other');
    const rsvp = (user: string, player: string, status = 'in') =>
      as(db, user, () => db.query(`insert into event_rsvps (event_id, player_id, league_id, status, responded_by) values ($1, $2, $3, $4, $5)
        on conflict (event_id, player_id) do update set status = excluded.status, responded_by = excluded.responded_by`, [eventId, player, oak, status, user]));

    await expect(rsvp(joe, joeSpot)).rejects.toThrow(/row-level security/); // Free league
    await setPlan(oak, 'pro');
    await rsvp(joe, joeSpot);
    await rsvp(joe, joeSpot, 'out'); // can change their answer
    await expect(rsvp(joe, other)).rejects.toThrow(/row-level security/);
    await rsvp(tony, other, 'maybe'); // commissioner can answer for anyone
    expect(await rows(db, 'select status from event_rsvps order by status')).toEqual([{ status: 'maybe' }, { status: 'out' }]);
  });

  it('gives an open spot to the first sub who accepts', async () => {
    await setPlan(oak, 'pro');
    const { eventId } = await weekWithRound(tony, oak);
    const subA = await createUser(db, 'suba@example.com');
    const subB = await createUser(db, 'subb@example.com');
    for (const u of [subA, subB]) await db.query(`insert into league_members (league_id, user_id) values ($1, $2)`, [oak, u]);
    const spotA = await linkedPlayer(subA, 'Sub A');
    const spotB = await linkedPlayer(subB, 'Sub B');

    const [req] = await as(db, tony, () => rows<{ id: string }>(db, `insert into sub_requests (league_id, event_id, tee_slot, spots, created_by) values ($1, $2, 4, 1, $3) returning id`, [oak, eventId, tony]));
    await as(db, tony, () => db.query(`insert into sub_offers (request_id, player_id, league_id) values ($1, $2, $4), ($1, $3, $4)`, [req!.id, spotA, spotB, oak]));

    const respond = (user: string, spot: string, yes: boolean) =>
      as(db, user, async () => (await rows<{ r: string }>(db, 'select respond_to_sub_offer($1, $2, $3) as r', [req!.id, spot, yes]))[0]!.r);

    await expect(respond(subA, spotB, true)).rejects.toThrow(/not your offer/);
    expect(await respond(subB, spotB, true)).toBe('accepted');
    expect(await respond(subA, spotA, true)).toBe('too_late');
    expect(await rows(db, 'select filled, closed_at is not null as closed from sub_requests')).toEqual([{ filled: 1, closed: true }]);
    expect(await rows(db, 'select player_id, status from event_rsvps')).toEqual([{ player_id: spotB, status: 'in' }]);
  });

  it('keeps Clubhouse TV links and the setup service for Pro commissioners', async () => {
    const addTv = (user: string) => as(db, user, () => db.query(`insert into tv_displays (league_id, token_hash, created_by) values ($1, md5(random()::text), $2)`, [oak, user]));
    const askSetup = (user: string) => as(db, user, () => db.query(`insert into setup_requests (league_id, requested_by, notes) values ($1, $2, 'Our 2026 spreadsheet')`, [oak, user]));
    await expect(addTv(tony)).rejects.toThrow(/row-level security/);
    await expect(askSetup(tony)).rejects.toThrow(/row-level security/);
    await setPlan(oak, 'pro');
    await addTv(tony);
    await askSetup(tony);
    await expect(addTv(joe)).rejects.toThrow(/row-level security/); // players can't
    expect(await as(db, joe, () => rows(db, 'select * from tv_displays'))).toEqual([]); // and can't see the links
  });

  it('lets golfers manage their own notification settings only', async () => {
    const joeSpot = await linkedPlayer(joe, 'Joe');
    const other = await addPlayer(tony, oak, 'Other');
    await as(db, joe, () => db.query(`insert into notification_prefs (player_id, league_id, weekly_recap) values ($1, $2, false)`, [joeSpot, oak]));
    await expect(as(db, joe, () => db.query(`insert into notification_prefs (player_id, league_id) values ($1, $2)`, [other, oak]))).rejects.toThrow(/row-level security/);
    expect(await as(db, joe, () => rows(db, 'select weekly_recap from notification_prefs'))).toEqual([{ weekly_recap: false }]);
  });

  it('runs the setup service: upload, staff queue, staff joins with consent, done removes access', async () => {
    const staff = await createUser(db, 'staff@example.com');
    await db.query('insert into staff_users (user_id) values ($1)', [staff]);
    await setPlan(oak, 'pro');
    const upload = (user: string, leagueId: string) =>
      as(db, user, () => db.query(`insert into storage.objects (bucket_id, name) values ('setup-uploads', $1)`, [`${leagueId}/abc-roster.xlsx`]));
    await upload(tony, oak);
    await expect(upload(joe, oak)).rejects.toThrow(/row-level security/); // players can't
    await expect(upload(sam, oak)).rejects.toThrow(/row-level security/); // other commissioners can't
    await expect(upload(sam, pine)).rejects.toThrow(/row-level security/); // Free league

    // A commissioner can't sneak in a staff reply.
    const [req] = await as(db, tony, () => rows<{ id: string; staff_reply: string | null }>(db,
      `insert into setup_requests (league_id, requested_by, notes, wants, files, staff_reply) values ($1, $2, 'Our 2026 sheet', '{roster,history}', $3, 'fake') returning id, staff_reply`,
      [oak, tony, JSON.stringify([{ path: `${oak}/abc-roster.xlsx`, name: 'roster.xlsx', size: 1000 }])]));
    expect(req!.staff_reply).toBeNull();

    // Only staff see the queue and the files.
    await expect(as(db, joe, () => db.query('select * from staff_setup_queue()'))).rejects.toThrow(/staff only/);
    const queue = await as(db, staff, () => rows<{ league_name: string; requested_by_email: string; status: string }>(db, 'select league_name, requested_by_email, status from staff_setup_queue()'));
    expect(queue).toEqual([{ league_name: 'Oak Creek Men', requested_by_email: 'tony@example.com', status: 'requested' }]);
    expect(await as(db, staff, () => rows(db, `select name from storage.objects where bucket_id = 'setup-uploads'`))).toHaveLength(1);
    expect(await as(db, joe, () => rows(db, `select name from storage.objects where bucket_id = 'setup-uploads'`))).toEqual([]);

    // Staff joins as a commissioner, replies, and loses access when it's done.
    await as(db, staff, () => db.query('select staff_join_league($1)', [req!.id]));
    expect(await as(db, staff, () => rows(db, 'select is_commissioner($1) as c', [oak]))).toEqual([{ c: true }]);
    await as(db, staff, () => db.query(`select staff_update_setup_request($1, 'needs_info', 'Which nine do you play first?')`, [req!.id]));
    // The commissioner answers, which puts it back in the queue; they can't touch the reply.
    await as(db, tony, () => db.query(`update setup_requests set notes = 'Front nine first', status = 'requested' where id = $1`, [req!.id]));
    await expect(as(db, tony, () => db.query(`update setup_requests set staff_reply = 'x' where id = $1`, [req!.id]))).rejects.toThrow(/staff/);
    await as(db, staff, () => db.query(`select staff_update_setup_request($1, 'done', 'All set up!')`, [req!.id]));
    expect(await as(db, staff, () => rows(db, 'select is_commissioner($1) as c', [oak]))).toEqual([{ c: false }]);
    expect(await as(db, tony, () => rows(db, 'select status, staff_reply from setup_requests'))).toEqual([{ status: 'done', staff_reply: 'All set up!' }]);
    await expect(as(db, staff, () => db.query('select staff_join_league($1)', [req!.id]))).rejects.toThrow(/done/);
  });

  it('merges a duplicate golfer into the one kept, history and all', async () => {
    const keep = await addPlayer(tony, oak, 'Aaron Seal', true);
    const dup = await addPlayer(tony, oak, 'Aaron  Seal', true);
    const other = await addPlayer(tony, oak, 'Bob');
    const { eventId, roundId } = await weekWithRound(tony, oak);
    // Set up the duplicate's history directly (what an import leaves behind).
    await db.query(`insert into round_players (round_id, player_id, league_id, side, position) values ($1, $2, $3, 'A', 0), ($1, $4, $3, 'B', 1)`, [roundId, dup, oak, other]);
    await db.query(`insert into hole_scores (round_id, player_id, league_id, hole_number, strokes) values ($1, $2, $3, 1, 4), ($1, $2, $3, 2, 3)`, [roundId, dup, oak]);
    await db.query(`insert into ctp_reports (round_id, league_id, hole_number, player_id) values ($1, $2, 2, $3)`, [roundId, oak, dup]);
    await db.query(`insert into player_contacts (player_id, league_id, email) values ($1, $2, 'aaron@example.com')`, [dup, oak]);
    await db.query(`insert into ledger_entries (league_id, event_id, round_id, player_id, kind, amount_cents) values ($1, $2, $3, $4, 'skin', 900)`, [oak, eventId, roundId, dup]);

    await expect(as(db, joe, () => db.query('select merge_players($1, $2)', [keep, dup]))).rejects.toThrow(/commissioners only/);
    await as(db, tony, () => db.query('select merge_players($1, $2)', [keep, dup]));

    expect(await rows(db, 'select count(*)::int as n from players where id = $1', [dup])).toEqual([{ n: 0 }]);
    expect(await rows(db, 'select display_name from players where id = $1', [keep])).toEqual([{ display_name: 'Aaron Seal' }]);
    expect(await rows(db, 'select side, position from round_players where player_id = $1', [keep])).toEqual([{ side: 'A', position: 0 }]);
    expect(await rows(db, 'select hole_number, strokes from hole_scores where player_id = $1 order by hole_number', [keep])).toEqual([{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 3 }]);
    expect(await rows(db, 'select player_id from ctp_reports')).toEqual([{ player_id: keep }]);
    expect(await rows(db, 'select player_id, amount_cents from ledger_entries')).toEqual([{ player_id: keep, amount_cents: 900 }]);
    expect(await rows(db, 'select email from player_contacts where player_id = $1', [keep])).toEqual([{ email: 'aaron@example.com' }]);

    // Two golfers who played in the same group can't be merged.
    await expect(as(db, tony, () => db.query('select merge_players($1, $2)', [keep, other]))).rejects.toThrow(/same group/);
  });

  it('shares phone numbers with members only when the commissioner turns it on', async () => {
    const al = await addPlayer(tony, oak, 'Al');
    await db.query(`insert into player_contacts (player_id, league_id, email, phone) values ($1, $2, 'al@example.com', '248-555-0100')`, [al, oak]);
    const book = (user: string | null) => as(db, user, () => rows<{ player_id: string; phone: string }>(db, 'select * from league_phone_book($1)', [oak]));
    expect(await book(tony)).toEqual([{ player_id: al, phone: '248-555-0100' }]); // commissioners always
    expect(await book(joe)).toEqual([]); // members: not until it's turned on
    await expect(as(db, joe, () => db.query('update leagues set share_phones = true where id = $1 returning id', [oak]))).resolves.toMatchObject({ rows: [] });
    await as(db, tony, () => db.query('update leagues set share_phones = true where id = $1', [oak]));
    expect(await book(joe)).toEqual([{ player_id: al, phone: '248-555-0100' }]);
    expect(await book(sam)).toEqual([]); // other leagues never
    await expect(book(null)).rejects.toThrow(/permission denied/);
    expect(await as(db, joe, () => rows(db, 'select * from player_contacts'))).toEqual([]); // emails stay private
  });

  it('runs the tee sheet: captains, joining, full groups, partners and matches', async () => {
    const { eventId } = await weekWithRound(tony, oak);
    const joeSpot = await linkedPlayer(joe, 'Joe');
    const [bob, cy, dee, ed] = await Promise.all(['Bob', 'Cy', 'Dee', 'Ed'].map((n) => addPlayer(tony, oak, n)));
    const call = (user: string, sql: string, params: unknown[]) => as(db, user, () => db.query(sql, params));
    const times = JSON.stringify([{ slot: 1, time: '17:10', captainId: joeSpot }, { slot: 2, time: '17:17', captainId: null }]);
    const lineup = () => rows<{ player_id: string; slot: number | null; looking: string | null; partner_id: string | null }>(db,
      'select player_id, slot, looking, partner_id from event_lineup where event_id = $1 order by slot nulls last, player_id', [eventId]);

    await expect(call(tony, 'select set_tee_times($1, $2::jsonb)', [eventId, times])).rejects.toThrow(/plan_feature/); // Free
    await setPlan(oak, 'pro');
    await expect(call(joe, 'select set_tee_times($1, $2::jsonb)', [eventId, times])).rejects.toThrow(/commissioners only/);
    await call(tony, 'select set_tee_times($1, $2::jsonb)', [eventId, times]);
    expect(await lineup()).toEqual([{ player_id: joeSpot, slot: 1, looking: null, partner_id: null }]); // captain plays in their group
    expect(await rows(db, 'select status from event_rsvps where player_id = $1', [joeSpot])).toEqual([{ status: 'in' }]);

    // A captain fills their own group, but can't place golfers elsewhere or change their status.
    await call(joe, 'select lineup_join($1, $2, 1::smallint)', [eventId, bob]);
    await expect(call(joe, 'select lineup_join($1, $2, 2::smallint)', [eventId, cy])).rejects.toThrow(/group you captain/);
    await expect(call(joe, `select lineup_status($1, $2, 'out')`, [eventId, bob])).rejects.toThrow(/your own status/);

    // Full at four (a commissioner can add a fifth).
    await call(tony, 'select lineup_join($1, $2, 1::smallint)', [eventId, cy]);
    await call(tony, 'select lineup_join($1, $2, 1::smallint)', [eventId, dee]);
    await expect(call(joe, 'select lineup_join($1, $2, 1::smallint)', [eventId, ed])).rejects.toThrow(/full/);
    await call(tony, 'select lineup_join($1, $2, 1::smallint)', [eventId, ed]);
    await expect(call(tony, 'select lineup_join($1, $2, 1::smallint)', [eventId, bob])).resolves.toBeTruthy(); // already there: no change

    // Cy and Dee leave to look for a match together; then Cy drops out and Dee needs a partner again.
    await call(tony, `select lineup_status($1, $2, 'match', $3)`, [eventId, cy, dee]);
    expect((await lineup()).filter((r) => r.looking)).toEqual(
      [{ player_id: cy, slot: null, looking: 'match', partner_id: dee }, { player_id: dee, slot: null, looking: 'match', partner_id: cy }].sort((a, b) => a.player_id.localeCompare(b.player_id)),
    );
    await call(tony, `select lineup_status($1, $2, 'out')`, [eventId, cy]);
    expect((await lineup()).find((r) => r.player_id === dee)).toMatchObject({ looking: 'partner', partner_id: null });
    expect(await rows(db, 'select status from event_rsvps where player_id = $1', [cy])).toEqual([{ status: 'out' }]);

    // The captain going to another tee time leaves tee time 1 without a captain; the first to join tee time 2 runs it.
    await call(joe, 'select lineup_join($1, $2, 2::smallint)', [eventId, joeSpot]);
    expect(await rows(db, 'select slot, captain_id from event_tee_times where event_id = $1 order by slot', [eventId])).toEqual([{ slot: 1, captain_id: null }, { slot: 2, captain_id: joeSpot }]);

    // Other leagues can't see it; nobody writes to it directly.
    expect(await as(db, sam, () => rows(db, 'select * from event_lineup'))).toEqual([]);
    await expect(call(joe, 'insert into event_lineup (event_id, player_id, league_id, slot) values ($1, $2, $3, 1)', [eventId, ed, oak])).rejects.toThrow(/permission denied/);
  });

  it('lists the new features on every paid plan', async () => {
    const feats = await rows<{ code: string; f: string[] }>(db, `select code, features as f from plans order by code`);
    for (const p of feats) {
      const has = ['weekly_recap', 'rsvp', 'setup_service', 'awards', 'tv_mode'].every((x) => p.f.includes(x));
      expect([p.code, has]).toEqual([p.code, p.code !== 'free']);
    }
  });
});

describe('Clubhouse TV feed', () => {
  it('serves the week to a valid TV link without sign-in, and nothing else', async () => {
    await setPlan(oak, 'pro');
    const al = await addPlayer(tony, oak, 'Al');
    await as(db, tony, () => db.query(`insert into player_contacts (player_id, league_id, email, phone) values ($1, $2, 'al@secret.com', '555-0100')`, [al, oak]));
    const { roundId } = await weekWithRound(tony, oak, PRO_RULES);
    await as(db, tony, () => db.query(`insert into round_players (round_id, player_id, league_id, side) values ($1, $2, $3, 'A')`, [roundId, al, oak]));
    await as(db, joe, () => db.query(`insert into hole_scores (round_id, player_id, league_id, hole_number, strokes, entered_by) values ($1, $2, $3, 1, 3, $4)`, [roundId, al, oak, joe]));

    const token = 'tv-token-0123456789abcdef';
    const hash = createHash('sha256').update(token).digest('hex');
    await as(db, tony, () => db.query('insert into tv_displays (league_id, token_hash, created_by) values ($1, $2, $3)', [oak, hash, tony]));

    const feed = async (t: string) => (await as(db, null, () => rows<{ f: any }>(db, 'select tv_feed($1) as f', [t])))[0]!.f;
    const f = await feed(token);
    expect(f.league.name).toBe('Oak Creek Men');
    expect(f.event.weekNumber).toBe(1);
    expect(f.layout.holes).toHaveLength(9);
    expect(f.rounds[0].scores[al]).toEqual({ '1': 3 });
    expect(f.display.settings.hideMoney).toBe(true);
    expect(JSON.stringify(f)).not.toMatch(/secret\.com|555-0100/); // never contact details

    expect(await feed('wrong-token-0123456789')).toBeNull();
    await as(db, tony, () => db.query('update tv_displays set revoked_at = now()'));
    expect(await feed(token)).toBeNull();
  });

  it('shows nothing for a league without Pro', async () => {
    const token = 'tv-token-free-0123456789';
    await db.query('insert into tv_displays (league_id, token_hash, created_by) values ($1, $2, $3)', [oak, createHash('sha256').update(token).digest('hex'), tony]);
    const [r] = await as(db, null, () => rows<{ f: any }>(db, 'select tv_feed($1) as f', [token]));
    expect(r!.f).toEqual({ error: 'plan', league: { name: 'Oak Creek Men' } });
  });
});

describe('handicaps', () => {
  it('lets commissioners set GHIN details, and fixes each golfer’s course handicap on the round', async () => {
    const al = await addPlayer(tony, oak, 'Al');
    await as(db, tony, () => db.query(`update players set ghin_number = '1234567', handicap_index = 12.4, handicap_index_updated_at = now() where id = $1`, [al]));
    await as(db, joe, () => db.query(`update players set handicap_index = 2.0 where id = $1`, [al])); // golfers can't change it (no rows updated)
    expect(await rows(db, 'select ghin_number, handicap_index::text as idx from players where id = $1', [al])).toEqual([{ ghin_number: '1234567', idx: '12.4' }]);
    await expect(as(db, tony, () => db.query(`update players set handicap_index = 60 where id = $1`, [al]))).rejects.toThrow(/check constraint/);
    await expect(as(db, tony, () => db.query(`update players set ghin_number = 'abc' where id = $1`, [al]))).rejects.toThrow(/check constraint/);

    await setPlan(oak, 'pro');
    const { roundId } = await weekWithRound(tony, oak, PRO_RULES);
    await as(db, joe, () => db.query(`insert into round_players (round_id, player_id, league_id, side, course_handicap) values ($1, $2, $3, 'A', 7)`, [roundId, al, oak]));
    const token = 'tv-token-hcp-0123456789';
    await as(db, tony, () => db.query('insert into tv_displays (league_id, token_hash, created_by) values ($1, $2, $3)', [oak, createHash('sha256').update(token).digest('hex'), tony]));
    const f = (await as(db, null, () => rows<{ f: any }>(db, 'select tv_feed($1) as f', [token])))[0]!.f;
    expect(f.rounds[0].players[0]).toMatchObject({ playerId: al, courseHandicap: 7 });
  });
});

describe('billing', () => {
  /** What the Stripe webhook (service role) records after a payment. */
  async function paid(sub: string, owner: string, target: { league?: string; club?: string }, status = 'active') {
    await db.query(
      `insert into billing_subscriptions (stripe_subscription_id, owner_id, league_id, club_id, plan, status, current_period_end)
       values ($1, $2, $3, $4, $5, $6, now() + interval '1 year')`,
      [sub, owner, target.league ?? null, target.club ?? null, target.league ? 'pro' : 'club', status],
    );
  }

  it('lets payers and commissioners see a league’s billing, but nobody can write it', async () => {
    await paid('sub_1', tony, { league: oak });
    expect(await as(db, tony, () => rows(db, 'select stripe_subscription_id from billing_subscriptions'))).toHaveLength(1);
    expect(await as(db, joe, () => rows(db, 'select stripe_subscription_id from billing_subscriptions'))).toHaveLength(0);
    expect(await as(db, sam, () => rows(db, 'select stripe_subscription_id from billing_subscriptions'))).toHaveLength(0);
    await expect(as(db, tony, () => db.query(`update billing_subscriptions set status = 'active'`))).rejects.toThrow(/permission denied/);
    await expect(as(db, tony, () => db.query(`insert into billing_customers (user_id, stripe_customer_id) values ($1, 'cus_x')`, [tony]))).rejects.toThrow(/permission denied/);

    const [b] = await as(db, tony, () => rows<{ b: any }>(db, 'select league_billing($1) as b', [oak]));
    expect(b!.b).toMatchObject({ plan: 'free', isOwner: true, subscription: { status: 'active', paidByMe: true, cancelAtPeriodEnd: false } });
    expect((await as(db, joe, () => rows<{ b: any }>(db, 'select league_billing($1) as b', [oak])))[0]!.b).toBeNull();
  });

  it('lets an owner put their leagues under their paid Club, up to the rules', async () => {
    const club = (await as(db, tony, () => rows<{ id: string }>(db, `select create_club('Crystal Lake Golf') as id`)))[0]!.id;
    await expect(as(db, tony, () => db.query('select set_league_club($1, $2)', [oak, club]))).rejects.toThrow(/Start the Club plan first/);

    await db.query(`update clubs set plan_expires_at = now() + interval '1 year' where id = $1`, [club]);
    await expect(as(db, sam, () => db.query('select set_league_club($1, $2)', [pine, club]))).rejects.toThrow(/club isn't yours/);
    await expect(as(db, joe, () => db.query('select set_league_club($1, $2)', [oak, club]))).rejects.toThrow(/Only the league's owner/);

    await as(db, tony, () => db.query('select set_league_club($1, $2)', [oak, club]));
    expect(await as(db, tony, () => rows(db, 'select effective_plan($1) as p', [oak]))).toEqual([{ p: 'club' }]);
    expect((await as(db, tony, () => rows<{ b: any }>(db, 'select league_billing($1) as b', [oak])))[0]!.b).toMatchObject({ clubName: 'Crystal Lake Golf', effectivePlan: 'club' });

    await as(db, tony, () => db.query('select set_league_club($1, null)', [oak]));
    expect(await as(db, tony, () => rows(db, 'select plan, club_id from leagues where id = $1', [oak]))).toEqual([{ plan: 'free', club_id: null }]);
  });

  it("won't add a league that already pays for Pro, or a free Pilot league", async () => {
    const club = (await as(db, tony, () => rows<{ id: string }>(db, `select create_club('Crystal Lake Golf') as id`)))[0]!.id;
    await db.query(`update clubs set plan_expires_at = now() + interval '1 year' where id = $1`, [club]);
    await paid('sub_2', tony, { league: oak });
    await expect(as(db, tony, () => db.query('select set_league_club($1, $2)', [oak, club]))).rejects.toThrow(/pays for its own Pro/);
    await db.query(`delete from billing_subscriptions`);
    await setPlan(oak, 'pilot');
    await expect(as(db, tony, () => db.query('select set_league_club($1, $2)', [oak, club]))).rejects.toThrow(/already has GolfScoreHQ free/);
  });
});

describe('scoring a round from the phone', () => {
  it('saves what the app sends: scores, changed scores, CTP answers (changed too), current hole', async () => {
    await setPlan(oak, 'pilot');
    const [a, b, c, d] = [await addPlayer(tony, oak, 'Al'), await addPlayer(tony, oak, 'Bob'), await addPlayer(tony, oak, 'Cal'), await addPlayer(tony, oak, 'Dan')];
    const other = await addPlayer(tony, oak, 'Eve');
    const { roundId } = await weekWithRound(tony, oak, PRO_RULES);
    await as(db, tony, async () => {
      for (const [i, p] of [a, b, c, d].entries()) {
        await db.query(`insert into round_players (round_id, player_id, league_id, side, position) values ($1, $2, $3, $4, $5)`, [roundId, p, oak, i < 2 ? 'A' : 'B', i]);
      }
      const upsertScores = (hole: number, strokes: number) =>
        db.query(
          `insert into hole_scores (round_id, player_id, league_id, hole_number, strokes, entered_by, updated_at)
           select $1, p, $2, $3, $4, $5, now() from unnest($6::uuid[]) p
           on conflict (round_id, player_id, hole_number) do update set strokes = excluded.strokes, entered_by = excluded.entered_by, updated_at = excluded.updated_at`,
          [roundId, oak, hole, strokes, tony, [a, b, c, d]],
        );
      const upsertCtp = (hole: number, player: string | null, beat: string | null) =>
        db.query(
          `insert into ctp_reports (round_id, league_id, hole_number, player_id, beat_player_id) values ($1, $2, $3, $4, $5)
           on conflict (round_id, hole_number) do update set player_id = excluded.player_id, beat_player_id = excluded.beat_player_id`,
          [roundId, oak, hole, player, beat],
        );
      const setHole = (i: number) => db.query(`update rounds set current_hole = $2, updated_at = now() where id = $1`, [roundId, i]);

      for (let h = 1; h <= 5; h++) { await upsertScores(h, 4); await setHole(h); }
      await upsertCtp(2, null, null);         // nobody
      await upsertCtp(5, a, null);            // Al, first ball on the green
      await upsertScores(5, 3);               // went back and fixed hole 5
      await upsertCtp(5, b, other);           // changed answer: Bob, inside Eve's marker
      for (let h = 6; h <= 9; h++) { await upsertScores(h, 5); await setHole(h - 1); }
    });
    const [{ n }] = await rows<{ n: number }>(db, 'select count(*)::int as n from hole_scores where round_id = $1', [roundId]);
    expect(n).toBe(36);
    expect(await rows(db, 'select hole_number, player_id, beat_player_id from ctp_reports where round_id = $1 order by hole_number', [roundId])).toEqual([
      { hole_number: 2, player_id: null, beat_player_id: null },
      { hole_number: 5, player_id: b, beat_player_id: other },
    ]);
    // Still can't be "inside your own ball", or name a marker with no winner.
    await expect(as(db, tony, () => db.query(`insert into ctp_reports (round_id, league_id, hole_number, player_id, beat_player_id) values ($1, $2, 7, $3, $3)`, [roundId, oak, a]))).rejects.toThrow(/ctp_reports_not_self/);
    await expect(as(db, tony, () => db.query(`insert into ctp_reports (round_id, league_id, hole_number, player_id, beat_player_id) values ($1, $2, 7, null, $3)`, [roundId, oak, a]))).rejects.toThrow(/ctp_reports_beat_needs_winner/);
  });
});

describe('league branding', () => {
  const setColors = (user: string, lid: string, brand: string, accent: string) =>
    as(db, user, () => db.query('update leagues set brand_color = $2, accent_color = $3 where id = $1', [lid, brand, accent]));
  const upload = (user: string, path: string) =>
    as(db, user, () => db.query(`insert into storage.objects (bucket_id, name) values ('league-logos', $1)`, [path]));

  it('lets a Pro commissioner set colors and upload a logo for their own league only', async () => {
    await expect(setColors(tony, oak, '#0b5d3b', '#d4a017')).rejects.toThrow(/plan_feature: League logo and colors/);
    await expect(upload(tony, `${oak}/logo-1.png`)).rejects.toThrow(/row-level security/);

    await setPlan(oak, 'pilot');
    await setColors(tony, oak, '#0b5d3b', '#d4a017');
    await upload(tony, `${oak}/logo-1.png`);
    await as(db, tony, () => db.query('update leagues set logo_url = $2 where id = $1', [oak, logoUrl(oak)]));
    const [l] = await rows(db, 'select brand_color, accent_color, logo_url from leagues where id = $1', [oak]);
    expect(l).toEqual({ brand_color: '#0b5d3b', accent_color: '#d4a017', logo_url: logoUrl(oak) });

    // Not a golfer, not another league's commissioner, not a bad path.
    await expect(upload(joe, `${oak}/logo-2.png`)).rejects.toThrow(/row-level security/);
    await expect(upload(sam, `${oak}/logo-2.png`)).rejects.toThrow(/row-level security/);
    await expect(upload(tony, `${pine}/logo.png`)).rejects.toThrow(/row-level security/);
    await expect(upload(tony, 'not-a-league/logo.png')).rejects.toThrow(/row-level security/);
    await expect(setColors(joe, oak, '#000000', '#ffffff')).resolves.toBeTruthy(); // RLS: no rows updated for a golfer
    expect((await rows(db, 'select brand_color from leagues where id = $1', [oak]))[0]).toEqual({ brand_color: '#0b5d3b' });
  });

  it('lets a Pro commissioner set a banner photo from the bucket only', async () => {
    const banner = logoUrl(oak).replace('logo-1.png', 'banner-1.jpg');
    await expect(as(db, tony, () => db.query('update leagues set banner_url = $2 where id = $1', [oak, banner]))).rejects.toThrow(/plan_feature: League logo and colors/);
    await setPlan(oak, 'pro');
    await as(db, tony, () => db.query('update leagues set banner_url = $2 where id = $1', [oak, banner]));
    expect((await rows(db, 'select banner_url from leagues where id = $1', [oak]))[0]).toEqual({ banner_url: banner });
    await expect(as(db, tony, () => db.query(`update leagues set banner_url = 'https://evil.example.com/x.jpg' where id = $1`, [oak]))).rejects.toThrow(/leagues_banner_url_storage/);
  });

  it('only accepts real colors and logos from the league-logos bucket', async () => {
    await setPlan(oak, 'pro');
    await expect(setColors(tony, oak, 'red', '#d4a017')).rejects.toThrow(/check constraint/);
    await expect(as(db, tony, () => db.query(`update leagues set logo_url = 'https://evil.example.com/pixel.png' where id = $1`, [oak]))).rejects.toThrow(/leagues_logo_url_storage/);
  });

  it('sends colors to Clubhouse TV only while the league has branding', async () => {
    await setPlan(oak, 'pro');
    await setColors(tony, oak, '#0b5d3b', '#d4a017');
    const token = 'tv-token-brand-0123456789';
    await as(db, tony, () => db.query('insert into tv_displays (league_id, token_hash, created_by) values ($1, $2, $3)', [oak, createHash('sha256').update(token).digest('hex'), tony]));
    const feed = async () => (await as(db, null, () => rows<{ f: any }>(db, 'select tv_feed($1) as f', [token])))[0]!.f;
    expect((await feed()).league).toMatchObject({ brandColor: '#0b5d3b', accentColor: '#d4a017' });
  });
});

describe('joining', () => {
  it('accepts an invite link and links the golfer to their roster spot', async () => {
    const newbie = await createUser(db, 'newbie@example.com');
    const spot = await addPlayer(tony, oak, 'Newbie Golfer');
    const token = 'test-token-123';
    const hash = createHash('sha256').update(token).digest('hex');
    await as(db, tony, () => db.query(`insert into invites (league_id, token_hash, player_id, created_by) values ($1, $2, $3, $4)`, [oak, hash, spot, tony]));

    await as(db, newbie, () => db.query('select accept_invite($1)', [token]));
    expect(await rows(db, 'select user_id from players where id = $1', [spot])).toEqual([{ user_id: newbie }]);
    expect(await as(db, newbie, () => rows<{ slug: string }>(db, 'select slug from leagues'))).toEqual([{ slug: 'oak-creek' }]);
    await expect(as(db, sam, () => db.query('select accept_invite($1)', [token]))).rejects.toThrow(/invalid or expired/);
  });

  it("shows the commissioner who's asking, and approving adds them as a member", async () => {
    await db.query(`update auth.users set email = 'sam@example.com' where id = $1`, [sam]);
    await as(db, tony, () => db.query(`update leagues set join_code = 'OAK123' where id = $1`, [oak]));
    await as(db, sam, () => db.query(`select request_to_join(' oak123 ', null, 'Sam Pine')`));
    expect(await as(db, tony, () => rows(db, 'select requester_email, requester_name from join_requests'))).toEqual([{ requester_email: 'sam@example.com', requester_name: 'Sam Pine' }]);
    await expect(as(db, joe, () => db.query('select decide_join_request($1, $2, true)', [oak, sam]))).rejects.toThrow(/commissioners only/);
    await as(db, tony, () => db.query('select decide_join_request($1, $2, true)', [oak, sam]));
    expect(await as(db, sam, () => rows<{ slug: string }>(db, 'select slug from leagues order by slug'))).toEqual([{ slug: 'oak-creek' }, { slug: 'pine-valley' }]);
    await expect(as(db, tony, () => db.query('select decide_join_request($1, $2, true)', [oak, sam]))).rejects.toThrow(/no pending request/);
  });

  it('turns a league code into a pending request the commissioner sees', async () => {
    await as(db, tony, () => db.query(`update leagues set join_code = 'OAK123' where id = $1`, [oak]));
    await as(db, sam, () => db.query(`select request_to_join('oak123', 'Can I sub?')`));
    expect(await as(db, sam, () => rows(db, 'select slug from leagues where id = $1', [oak]))).toEqual([]); // not a member yet
    expect(await as(db, tony, () => rows(db, 'select status from join_requests'))).toEqual([{ status: 'pending' }]);
  });
});

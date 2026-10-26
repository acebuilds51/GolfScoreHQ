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

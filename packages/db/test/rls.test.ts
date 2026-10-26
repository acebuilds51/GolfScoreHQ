import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, freshDb, rows, type Db } from './harness';

const FRONT_HOLES = JSON.stringify([4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })));

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
async function weekWithRound(user: string, leagueId: string) {
  return as(db, user, async () => {
    const [season] = await rows<{ id: string }>(db, `insert into seasons (league_id, year, rules) values ($1, 2027, '{}') returning id`, [leagueId]);
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

describe('plan limits', () => {
  it('caps the free plan at 20 regular players but allows subs', async () => {
    for (let i = 1; i <= 20; i++) await addPlayer(tony, oak, `Player ${i}`);
    await expect(addPlayer(tony, oak, 'Player 21')).rejects.toThrow(/plan_limit/);
    await addPlayer(tony, oak, 'Weekly Sub', true);
    await db.query(`update leagues set plan = 'pilot' where id = $1`, [oak]); // as the billing webhook would
    await addPlayer(tony, oak, 'Player 21');
  });

  it('allows one free league per owner', async () => {
    await expect(league(tony, 'Second League', 'second-league')).rejects.toThrow(/plan_limit/);
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

  it('turns a league code into a pending request the commissioner sees', async () => {
    await as(db, tony, () => db.query(`update leagues set join_code = 'OAK123' where id = $1`, [oak]));
    await as(db, sam, () => db.query(`select request_to_join('oak123', 'Can I sub?')`));
    expect(await as(db, sam, () => rows(db, 'select slug from leagues where id = $1', [oak]))).toEqual([]); // not a member yet
    expect(await as(db, tony, () => rows(db, 'select status from join_requests'))).toEqual([{ status: 'pending' }]);
  });
});

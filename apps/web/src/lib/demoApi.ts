import type { Api } from './api';
import type { Contact, Course, JoinRequest, League, LeagueEvent, LedgerRow, Plan, Role, RoundData, Season, User } from './types';
import { isCommissioner } from './types';
import { DEMO_COURSES } from './demoCourses';
import { sha256Hex, randomToken } from './util';

// Demo mode keeps everything in this browser's storage. It follows the same
// rules as the database where they shape the screens (who can do what,
// plan features, one free league per owner), so the app behaves the same.

const KEY = 'gshq-demo-v1';

const PRO_FEATURES = ['side_games', 'payments', 'all_formats', 'lineup', 'history', 'co_commissioners', 'export', 'branding', 'weekly_recap', 'rsvp', 'setup_service', 'awards', 'tv_mode'];
const FEATURES: Record<Plan, string[]> = {
  free: [], pro: PRO_FEATURES, pilot: PRO_FEATURES,
  club: [...PRO_FEATURES, 'multi_league', 'priority_support'], comp: [...PRO_FEATURES, 'multi_league', 'priority_support'],
};

interface Db {
  session: string | null;
  users: Record<string, User>;
  leagues: { id: string; name: string; slug: string; ownerId: string; plan: Plan; joinCode: string | null; timezone: string }[];
  members: { leagueId: string; userId: string; role: Role }[];
  players: { id: string; leagueId: string; displayName: string; isSub: boolean; active: boolean; userId: string | null }[];
  contacts: Record<string, Contact & { leagueId: string }>;
  invites: { leagueId: string; tokenHash: string; playerId: string | null; role: Role; expiresAt: number; acceptedAt: number | null }[];
  joinRequests: (JoinRequest & { leagueId: string; status: 'pending' | 'approved' | 'declined' })[];
  courses: Course[];
  seasons: Season[];
  events: (LeagueEvent & { leagueId: string })[];
  rounds: (RoundData & { leagueId: string })[];
  ledger: (LedgerRow & { eventId: string })[];
  ctpDecisions: Record<string, Record<number, string>>;
}

const empty = (): Db => ({
  session: null, users: {}, leagues: [], members: [], players: [], contacts: {}, invites: [], joinRequests: [], courses: [],
  seasons: [], events: [], rounds: [], ledger: [], ctpDecisions: {},
});

/** Mirrors the database's plan check on season rules. */
function usesSideGames(r: Season['rules']): boolean {
  const any = r as unknown as Record<string, any>;
  return !!(any.skins?.enabled || any.ctp?.enabled || any.presses?.enabled || any.match?.stake > 0 || any.teamPot > 0);
}

function load(): Db {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return empty();
  }
}
function save(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked: demo keeps working for this page view */
  }
}
const id = () => crypto.randomUUID();

export interface DemoApi extends Api {
  /** Demo only: switch a league's plan to see Free vs Pro behavior. */
  setPlan(leagueId: string, plan: Plan): Promise<void>;
  reset(): void;
}

export function demoApi(): DemoApi {
  const listeners = new Set<(u: User | null) => void>();
  const notify = (db: Db) => listeners.forEach((cb) => cb(db.session ? db.users[db.session]! : null));

  function me(db: Db): User {
    const u = db.session && db.users[db.session];
    if (!u) throw new Error('Sign in first.');
    return u;
  }
  function roleIn(db: Db, leagueId: string): Role | undefined {
    const u = db.session;
    return db.members.find((m) => m.leagueId === leagueId && m.userId === u)?.role;
  }
  function requireCommissioner(db: Db, leagueId: string) {
    if (!isCommissioner(roleIn(db, leagueId))) throw new Error("You don't have permission to do that.");
  }
  function requireMember(db: Db, leagueId: string) {
    if (!roleIn(db, leagueId)) throw new Error("You don't have permission to do that.");
  }
  const has = (db: Db, leagueId: string, feature: string) =>
    FEATURES[db.leagues.find((l) => l.id === leagueId)?.plan ?? 'free'].includes(feature);
  /** Same rule as the database: members score until the week is settled, then only commissioners. */
  function scorable(db: Db, roundId: string) {
    const r = db.rounds.find((x) => x.id === roundId);
    if (!r) throw new Error('Round not found.');
    const ev = db.events.find((e) => e.id === r.eventId);
    const role = roleIn(db, r.leagueId);
    if (!role || ((ev?.status === 'settled' || ev?.status === 'rainout') && !isCommissioner(role))) {
      throw new Error("You don't have permission to do that.");
    }
    return r;
  }

  return {
    mode: 'demo',

    async currentUser() {
      const db = load();
      return db.session ? db.users[db.session] ?? null : null;
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signIn(email) {
      const db = load();
      const e = email.trim().toLowerCase();
      let user = Object.values(db.users).find((u) => u.email === e);
      if (!user) {
        user = { id: id(), email: e };
        db.users[user.id] = user;
      }
      db.session = user.id;
      save(db);
      notify(db);
      return 'signed-in';
    },
    async signOut() {
      const db = load();
      db.session = null;
      save(db);
      notify(db);
    },

    async myLeagues() {
      const db = load();
      const u = me(db);
      return db.members
        .filter((m) => m.userId === u.id)
        .map((m) => {
          const l = db.leagues.find((x) => x.id === m.leagueId)!;
          return { id: l.id, name: l.name, slug: l.slug, plan: l.plan, role: m.role };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async createLeague(name, slug) {
      const db = load();
      const u = me(db);
      if (db.leagues.some((l) => l.slug === slug)) throw new Error('duplicate key value violates unique constraint "leagues_slug_key"');
      if (db.leagues.some((l) => l.ownerId === u.id && l.plan === 'free')) throw new Error('plan_limit: the free plan includes one league');
      const league = { id: id(), name, slug, ownerId: u.id, plan: 'free' as Plan, joinCode: null, timezone: 'America/Detroit' };
      db.leagues.push(league);
      db.members.push({ leagueId: league.id, userId: u.id, role: 'owner' });
      save(db);
      return league.id;
    },
    async league(slug) {
      const db = load();
      const l = db.leagues.find((x) => x.slug === slug);
      if (!l) return null;
      const role = roleIn(db, l.id);
      if (!role) return null;
      const league: League = { id: l.id, name: l.name, slug: l.slug, plan: l.plan, role, joinCode: l.joinCode, timezone: l.timezone, effectivePlan: l.plan, features: FEATURES[l.plan] };
      return league;
    },
    async updateLeague(leagueId, patch) {
      const db = load();
      requireCommissioner(db, leagueId);
      const l = db.leagues.find((x) => x.id === leagueId)!;
      if (patch.joinCode && db.leagues.some((x) => x.id !== leagueId && x.joinCode === patch.joinCode)) {
        throw new Error('duplicate key value violates unique constraint "leagues_join_code_key"');
      }
      if (patch.name !== undefined) l.name = patch.name;
      if (patch.joinCode !== undefined) l.joinCode = patch.joinCode;
      if (patch.timezone !== undefined) l.timezone = patch.timezone;
      save(db);
    },

    async players(leagueId) {
      const db = load();
      requireMember(db, leagueId);
      return db.players
        .filter((p) => p.leagueId === leagueId)
        .map(({ leagueId: _l, ...p }) => p)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    async contacts(leagueId) {
      const db = load();
      const u = me(db);
      const commish = isCommissioner(roleIn(db, leagueId));
      const out: Record<string, Contact> = {};
      for (const [pid, c] of Object.entries(db.contacts)) {
        if (c.leagueId !== leagueId) continue;
        const own = db.players.find((p) => p.id === pid)?.userId === u.id;
        if (commish || own) out[pid] = { email: c.email, phone: c.phone };
      }
      return out;
    },
    async addPlayers(leagueId, players) {
      const db = load();
      requireCommissioner(db, leagueId);
      for (const p of players) {
        const pid = id();
        db.players.push({ id: pid, leagueId, displayName: p.displayName, isSub: p.isSub, active: true, userId: null });
        if (p.email || p.phone) db.contacts[pid] = { leagueId, email: p.email ?? null, phone: p.phone ?? null };
      }
      save(db);
    },
    async updatePlayer(pid, patch) {
      const db = load();
      const p = db.players.find((x) => x.id === pid)!;
      requireCommissioner(db, p.leagueId);
      Object.assign(p, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      save(db);
    },
    async saveContact(leagueId, playerId, c) {
      const db = load();
      requireCommissioner(db, leagueId);
      db.contacts[playerId] = { leagueId, email: c.email || null, phone: c.phone || null };
      save(db);
    },

    async createInvite(leagueId, opts) {
      const db = load();
      requireCommissioner(db, leagueId);
      const token = randomToken();
      db.invites.push({ leagueId, tokenHash: await sha256Hex(token), playerId: opts.playerId ?? null, role: opts.role ?? 'player', expiresAt: Date.now() + 30 * 864e5, acceptedAt: null });
      save(db);
      return token;
    },
    async acceptInvite(token) {
      const db = load();
      const u = me(db);
      const hash = await sha256Hex(token);
      const inv = db.invites.find((i) => i.tokenHash === hash);
      if (!inv || inv.acceptedAt || inv.expiresAt < Date.now()) throw new Error('invite is invalid or expired');
      if (!db.members.some((m) => m.leagueId === inv.leagueId && m.userId === u.id)) db.members.push({ leagueId: inv.leagueId, userId: u.id, role: inv.role });
      const spot = inv.playerId && db.players.find((p) => p.id === inv.playerId);
      if (spot && !spot.userId) spot.userId = u.id;
      inv.acceptedAt = Date.now();
      save(db);
      return inv.leagueId;
    },
    async requestToJoin(code, name, message) {
      const db = load();
      const u = me(db);
      const l = db.leagues.find((x) => x.joinCode === code.trim().toUpperCase());
      if (!l) throw new Error('no league with that code');
      if (db.members.some((m) => m.leagueId === l.id && m.userId === u.id)) return;
      db.joinRequests = db.joinRequests.filter((r) => !(r.leagueId === l.id && r.userId === u.id));
      db.joinRequests.push({ leagueId: l.id, userId: u.id, email: u.email, name: name || null, message: message || null, createdAt: new Date().toISOString(), status: 'pending' });
      save(db);
    },
    async joinRequests(leagueId) {
      const db = load();
      requireCommissioner(db, leagueId);
      return db.joinRequests.filter((r) => r.leagueId === leagueId && r.status === 'pending').map(({ leagueId: _l, status: _s, ...r }) => r);
    },
    async decideJoinRequest(leagueId, userId, approve) {
      const db = load();
      requireCommissioner(db, leagueId);
      const r = db.joinRequests.find((x) => x.leagueId === leagueId && x.userId === userId && x.status === 'pending');
      if (!r) throw new Error('No pending request.');
      r.status = approve ? 'approved' : 'declined';
      if (approve && !db.members.some((m) => m.leagueId === leagueId && m.userId === userId)) db.members.push({ leagueId, userId, role: 'player' });
      save(db);
    },
    async members(leagueId) {
      const db = load();
      requireMember(db, leagueId);
      return db.members
        .filter((m) => m.leagueId === leagueId)
        .map((m) => ({
          userId: m.userId,
          role: m.role,
          playerName: db.players.find((p) => p.leagueId === leagueId && p.userId === m.userId)?.displayName ?? db.users[m.userId]?.email ?? null,
        }));
    },
    async setMemberRole(leagueId, userId, role) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (role === 'commissioner' && !has(db, leagueId, 'co_commissioners')) throw new Error('plan_feature: Co-commissioners needs GolfScoreHQ Pro');
      const m = db.members.find((x) => x.leagueId === leagueId && x.userId === userId);
      if (!m || m.role === 'owner') throw new Error("You don't have permission to do that.");
      m.role = role;
      save(db);
    },

    async searchCourses(query) {
      const q = query.trim().toLowerCase();
      if (q.length < 3) throw new Error('Type at least 3 letters of the course name.');
      return DEMO_COURSES.filter((c) => `${c.clubName} ${c.courseName} ${c.city}`.toLowerCase().includes(q)).map(({ tees: _t, ...s }) => s);
    },
    async lookupCourse(courseId) {
      const c = DEMO_COURSES.find((x) => x.id === courseId);
      if (!c) throw new Error("That course wasn't found.");
      return c;
    },

    async courses(leagueId) {
      const db = load();
      requireMember(db, leagueId);
      return db.courses.filter((c) => c.leagueId === leagueId || c.leagueId === null).sort((a, b) => a.name.localeCompare(b.name));
    },
    async createCourse(leagueId, course) {
      const db = load();
      requireCommissioner(db, leagueId);
      const c: Course = {
        id: id(), name: course.name, city: course.city || null, state: course.state || null, leagueId,
        layouts: course.layouts.map((l) => ({ ...l, id: id() })),
      };
      db.courses.push(c);
      save(db);
      return c.id;
    },
    async deleteCourse(courseId) {
      const db = load();
      const c = db.courses.find((x) => x.id === courseId);
      if (!c || !c.leagueId) return;
      requireCommissioner(db, c.leagueId);
      db.courses = db.courses.filter((x) => x.id !== courseId);
      save(db);
    },

    async seasons(leagueId) {
      const db = load();
      requireMember(db, leagueId);
      return db.seasons.filter((s) => s.leagueId === leagueId).sort((a, b) => b.year - a.year);
    },
    async createSeason(leagueId, s) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (usesSideGames(s.rules) && !has(db, leagueId, 'side_games')) throw new Error('plan_feature: Side games and money needs GolfScoreHQ Pro');
      const season: Season = { ...s, id: id(), leagueId };
      db.seasons.push(season);
      save(db);
      return season.id;
    },
    async updateSeasonRules(seasonId, rules) {
      const db = load();
      const s = db.seasons.find((x) => x.id === seasonId)!;
      requireCommissioner(db, s.leagueId);
      if (usesSideGames(rules) && !has(db, s.leagueId, 'side_games')) throw new Error('plan_feature: Side games and money needs GolfScoreHQ Pro');
      s.rules = rules;
      save(db);
    },
    async events(seasonId) {
      const db = load();
      return db.events.filter((e) => e.seasonId === seasonId).sort((a, b) => a.weekNumber - b.weekNumber).map(({ leagueId: _l, ...e }) => e);
    },
    async event(eventId) {
      const db = load();
      const e = db.events.find((x) => x.id === eventId);
      if (!e || !roleIn(db, e.leagueId)) return null;
      const { leagueId: _l, ...rest } = e;
      return rest;
    },
    async createEvent(leagueId, seasonId, e) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (db.events.some((x) => x.seasonId === seasonId && x.weekNumber === e.weekNumber)) throw new Error(`Week ${e.weekNumber} already exists.`);
      const ev = { id: id(), leagueId, seasonId, weekNumber: e.weekNumber, eventDate: e.eventDate, layoutId: e.layoutId, status: 'scheduled' as const };
      db.events.push(ev);
      save(db);
      return ev.id;
    },
    async updateEvent(eventId, patch) {
      const db = load();
      const e = db.events.find((x) => x.id === eventId)!;
      requireCommissioner(db, e.leagueId);
      Object.assign(e, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      save(db);
    },

    async eventRounds(eventId) {
      const db = load();
      return db.rounds.filter((r) => r.eventId === eventId).sort((a, b) => a.teeSlot - b.teeSlot).map(({ leagueId: _l, ...r }) => r);
    },
    async round(roundId) {
      const db = load();
      const r = db.rounds.find((x) => x.id === roundId);
      if (!r || !roleIn(db, r.leagueId)) return null;
      const { leagueId: _l, ...rest } = r;
      return rest;
    },
    async startRound(leagueId, eventId, teeSlot, players) {
      const db = load();
      requireMember(db, leagueId);
      const r = { id: id(), leagueId, eventId, teeSlot, status: 'live' as const, currentHole: 0, players, scores: {}, presses: [], ctp: {}, submittedAt: null };
      db.rounds.push(r);
      save(db);
      return r.id;
    },
    async saveScores(_leagueId, roundId, entries) {
      const db = load();
      const r = scorable(db, roundId);
      for (const e of entries) (r.scores[e.playerId] ??= {})[e.holeNumber] = e.strokes;
      save(db);
    },
    async setCurrentHole(roundId, holeIndex) {
      const db = load();
      scorable(db, roundId).currentHole = holeIndex;
      save(db);
    },
    async saveCtp(leagueId, roundId, holeNumber, entry) {
      const db = load();
      if (!has(db, leagueId, 'side_games')) throw new Error("You don't have permission to do that.");
      scorable(db, roundId).ctp[holeNumber] = { playerId: entry.playerId, beat: entry.playerId ? entry.beat : null };
      save(db);
    },
    async addPress(leagueId, roundId, startHole, calledBy) {
      const db = load();
      if (!has(db, leagueId, 'side_games')) throw new Error("You don't have permission to do that.");
      const p = { id: id(), startHole, calledBy };
      scorable(db, roundId).presses.push(p);
      save(db);
      return p.id;
    },
    async removePress(pressId) {
      const db = load();
      const r = db.rounds.find((x) => x.presses.some((p) => p.id === pressId));
      if (!r) return;
      scorable(db, r.id).presses = r.presses.filter((p) => p.id !== pressId);
      save(db);
    },
    async submitRound(roundId) {
      const db = load();
      const r = scorable(db, roundId);
      r.status = 'submitted';
      r.submittedAt = new Date().toISOString();
      save(db);
    },
    async addSub(leagueId, name) {
      const db = load();
      requireMember(db, leagueId);
      const nm = name.trim().replace(/\s+/g, ' ');
      if (!nm || nm.length > 60) throw new Error('Enter a name up to 60 characters.');
      const existing = db.players.find((p) => p.leagueId === leagueId && p.displayName.toLowerCase() === nm.toLowerCase());
      if (existing) {
        existing.active = true;
        save(db);
        return existing.id;
      }
      const p = { id: id(), leagueId, displayName: nm, isSub: true, active: true, userId: null };
      db.players.push(p);
      save(db);
      return p.id;
    },

    async ledger(eventId) {
      const db = load();
      return db.ledger.filter((e) => e.eventId === eventId).map(({ eventId: _e, ...r }) => r);
    },
    async seasonRounds(seasonId) {
      const db = load();
      const events = new Set(db.events.filter((e) => e.seasonId === seasonId).map((e) => e.id));
      return db.rounds.filter((r) => events.has(r.eventId)).map(({ leagueId: _l, ...r }) => r);
    },
    async seasonLedger(seasonId) {
      const db = load();
      const events = new Set(db.events.filter((e) => e.seasonId === seasonId).map((e) => e.id));
      return db.ledger.filter((e) => events.has(e.eventId));
    },
    async settleEvent(eventId, entries) {
      const db = load();
      const ev = db.events.find((e) => e.id === eventId);
      if (!ev) throw new Error('no such week');
      if (!isCommissioner(roleIn(db, ev.leagueId))) throw new Error('commissioners only');
      if (entries.length && !has(db, ev.leagueId, 'side_games')) throw new Error('plan_feature: Side games and money needs GolfScoreHQ Pro');
      const weekRounds = db.rounds.filter((r) => r.eventId === eventId);
      const ok = entries.every((e) => weekRounds.some((r) => (!e.roundId || r.id === e.roundId) && r.players.some((p) => p.playerId === e.playerId)));
      if (!ok) throw new Error('settlement includes a golfer or group that is not in this week');
      db.ledger = [...db.ledger.filter((e) => e.eventId !== eventId), ...entries.map((e) => ({ ...e, eventId }))];
      ev.status = 'settled';
      save(db);
    },
    async reopenEvent(eventId) {
      const db = load();
      const ev = db.events.find((e) => e.id === eventId)!;
      if (!isCommissioner(roleIn(db, ev.leagueId))) throw new Error('commissioners only');
      db.ledger = db.ledger.filter((e) => e.eventId !== eventId);
      ev.status = 'scheduled';
      save(db);
    },
    async ctpDecisions(eventId) {
      const db = load();
      return { ...(db.ctpDecisions[eventId] ?? {}) };
    },
    async setCtpDecision(leagueId, eventId, holeNumber, playerId) {
      const db = load();
      requireCommissioner(db, leagueId);
      const d = (db.ctpDecisions[eventId] ??= {});
      if (playerId) d[holeNumber] = playerId;
      else delete d[holeNumber];
      save(db);
    },

    async setPlan(leagueId, plan) {
      const db = load();
      const l = db.leagues.find((x) => x.id === leagueId);
      if (l) l.plan = plan;
      save(db);
    },
    reset() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

import type { Api } from './api';
import type { Contact, Course, JoinRequest, League, LeagueBilling, LeagueEvent, LedgerRow, PaymentHandles, Plan, RecapPreview, Role, RoundData, RsvpStatus, Season, SetupRequest, SubRequest, TeeSheet, TeeTime, TvDisplay, User } from './types';
import { isCommissioner } from './types';
import type { WeeklyRecap } from '@golfscorehq/engine';
import { buildRecapEmail } from '../../../../supabase/functions/send-recap/email';
import { cleanStory } from '../../../../supabase/functions/send-recap/story';
import { buildWeekRecap } from './recap';
import { BASIC_FORMATS, playsForMoney, weekRules, type FormatKey } from './scoring';
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
  leagues: {
    id: string; name: string; slug: string; ownerId: string; plan: Plan; joinCode: string | null; timezone: string;
    logoUrl?: string | null; bannerUrl?: string | null; brandColor?: string | null; accentColor?: string | null;
    planExpiresAt?: string | null; clubId?: string | null; demoSub?: LeagueBilling['subscription']; sharePhones?: boolean;
    rsvpReminderDays?: number | null;
  }[];
  clubs: { id: string; ownerId: string; name: string; expiresAt: string | null }[];
  members: { leagueId: string; userId: string; role: Role }[];
  players: {
    id: string; leagueId: string; displayName: string; isSub: boolean; active: boolean; userId: string | null;
    handicapIndex?: number | null; ghinNumber?: string | null; handicapIndexUpdatedAt?: string | null;
  }[];
  contacts: Record<string, Contact & { leagueId: string }>;
  invites: { leagueId: string; tokenHash: string; playerId: string | null; role: Role; expiresAt: number; acceptedAt: number | null }[];
  joinRequests: (JoinRequest & { leagueId: string; status: 'pending' | 'approved' | 'declined' })[];
  courses: Course[];
  seasons: Season[];
  events: (LeagueEvent & { leagueId: string })[];
  rounds: (RoundData & { leagueId: string })[];
  ledger: (LedgerRow & { eventId: string })[];
  ctpDecisions: Record<string, Record<number, string>>;
  tvDisplays: (TvDisplay & { leagueId: string; tokenHash: string; revokedAt: string | null })[];
  rsvps: Record<string, Record<string, RsvpStatus>>;
  subRequests: (SubRequest & { leagueId: string; eventId: string })[];
  recapSends: Record<string, NonNullable<RecapPreview['alreadySent']>>;
  recapPrefs: Record<string, boolean>;
  paymentHandles: Record<string, PaymentHandles>;
  setupRequests: (SetupRequest & { requestedBy: string; staffUserId: string | null })[];
  /** eventId → the week's tee sheet. */
  teeSheets: Record<string, TeeSheet>;
  /** seasonId → the season's tee times ("17:10", …, tee time 1 first). */
  seasonTeeTimes: Record<string, string[]>;
  /** eventId → when its reminder email went out (demo never emails anyone). */
  reminderSends: Record<string, { sent_at: string; recipients: number }>;
}

const empty = (): Db => ({
  session: null, users: {}, leagues: [], members: [], players: [], contacts: {}, invites: [], joinRequests: [], courses: [],
  seasons: [], events: [], rounds: [], ledger: [], ctpDecisions: {}, tvDisplays: [], rsvps: {}, subRequests: [],
  recapSends: {}, recapPrefs: {}, paymentHandles: {}, clubs: [], setupRequests: [], teeSheets: {}, seasonTeeTimes: {}, reminderSends: {},
});

/** Demo uploads live only for this page view (too big for the browser's saved demo data). */
const demoFiles = new Map<string, string>();

/** Mirrors the database's plan check on season rules. */
function usesSideGames(r: Season['rules']): boolean {
  const any = r as unknown as Record<string, any>;
  return !!(any.skins?.enabled || any.ctp?.enabled || any.presses?.enabled || any.match?.stake > 0 || any.teamPot > 0
    || (Array.isArray(any.payouts) && any.payouts.some((c: number) => c > 0)));
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
  /** The tee sheet for a week, after the same checks as lineup_guard(). */
  function lineupDb(eventId: string) {
    const db = load();
    const ev = db.events.find((e) => e.id === eventId)!;
    requireMember(db, ev.leagueId);
    if (!has(db, ev.leagueId, 'lineup')) throw new Error('plan_feature: The tee sheet needs GolfScoreHQ Pro');
    if (ev.status === 'settled' || ev.status === 'rainout') throw new Error('This week is over.');
    const sheet = (db.teeSheets[eventId] ??= { times: [], lineup: [], custom: false, seasonTimes: 0 });
    return { db, ev, sheet };
  }
  /** Same as sync_week_tee_times(): an upcoming week follows its season's tee times (captains and groups stay put). */
  function demoSyncWeek(db: Db, eventId: string) {
    const ev = db.events.find((e) => e.id === eventId);
    const sheet = (db.teeSheets[eventId] ??= { times: [], lineup: [], custom: false, seasonTimes: 0 });
    if (!ev || sheet.custom || ev.status !== 'scheduled' || db.rounds.some((r) => r.eventId === eventId)) return;
    const season = db.seasonTeeTimes[ev.seasonId] ?? [];
    for (const l of sheet.lineup) if (l.slot !== null && l.slot > season.length) l.slot = null;
    sheet.times = season.map((time, i) => ({ slot: i + 1, time, captainId: sheet.times.find((t) => t.slot === i + 1)?.captainId ?? null }));
  }
  /** Golfer themselves, anyone in the group (or its captain), or a commissioner. */
  function demoCanPlace(db: Db, leagueId: string, sheet: TeeSheet, playerId: string, slot: number | null) {
    const u = me(db);
    if (isCommissioner(roleIn(db, leagueId)) || db.players.find((p) => p.id === playerId)?.userId === u.id) return true;
    if (slot === null) return false;
    const mine = (id: string | null | undefined) => !!id && db.players.find((p) => p.id === id)?.userId === u.id;
    return mine(sheet.times.find((t) => t.slot === slot)?.captainId) || sheet.lineup.some((l) => l.slot === slot && mine(l.playerId));
  }
  /** Out of any group and captaincy; a paired-up partner needs a partner again. */
  function demoClear(sheet: TeeSheet, playerId: string) {
    for (const t of sheet.times) if (t.captainId === playerId) t.captainId = null;
    for (const l of sheet.lineup) if (l.partnerId === playerId) { l.looking = 'partner'; l.partnerId = null; }
    sheet.lineup = sheet.lineup.filter((l) => l.playerId !== playerId);
  }
  /** Same as rules_are_basic_format() in the database: other formats need Pro. */
  const checkFormat = (db: Db, leagueId: string, r: Season['rules']) => {
    if (!BASIC_FORMATS.includes(r.format as FormatKey) && !has(db, leagueId, 'all_formats')) throw new Error('plan_feature: This format needs GolfScoreHQ Pro');
  };
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

  /** Logo or banner: demo keeps the picture in this browser as a data URL. null removes it. */
  async function demoBrandFile(leagueId: string, field: 'logoUrl' | 'bannerUrl', blob: Blob | null): Promise<string> {
    const db = load();
    requireCommissioner(db, leagueId);
    if (blob && !has(db, leagueId, 'branding')) throw new Error('plan_feature: League logo and colors needs GolfScoreHQ Pro');
    const url = blob
      ? await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("That picture couldn't be read."));
          r.readAsDataURL(blob);
        })
      : null;
    const fresh = load();
    fresh.leagues.find((x) => x.id === leagueId)![field] = url;
    save(fresh);
    return url ?? '';
  }

  /** Same checks and output as the send-recap server function. */
  function demoRecap(db: Db, eventId: string, story?: string | null): { preview: RecapPreview; recap: WeeklyRecap } {
    const ev = db.events.find((e) => e.id === eventId);
    if (!ev) throw new Error("That week wasn't found.");
    if (!isCommissioner(roleIn(db, ev.leagueId))) throw new Error('Only commissioners can send the recap.');
    if (!has(db, ev.leagueId, 'weekly_recap')) throw new Error('The weekly recap email needs GolfScoreHQ Pro.');
    if (ev.status !== 'settled') throw new Error('Settle the week first, then send the recap.');
    const seasonRow = db.seasons.find((s) => s.id === ev.seasonId)!;
    const season = { ...seasonRow, rules: weekRules(seasonRow, ev) };
    const layout = db.courses.flatMap((c) => c.layouts).find((l) => l.id === ev.layoutId);
    if (!layout) throw new Error('This week has no course.');
    const league = db.leagues.find((l) => l.id === ev.leagueId)!;
    const players = db.players.filter((p) => p.leagueId === league.id);
    const earlier = new Set(db.events.filter((e) => e.seasonId === ev.seasonId && e.status === 'settled' && e.weekNumber <= ev.weekNumber).map((e) => e.id));
    const { recap, text } = buildWeekRecap({
      leagueName: league.name, event: ev, season, layout, players,
      rounds: db.rounds.filter((r) => r.eventId === eventId),
      weekLedger: db.ledger.filter((e) => e.eventId === eventId),
      seasonLedger: db.ledger.filter((e) => earlier.has(e.eventId)),
    });
    const forMoney = playsForMoney(season.rules);

    const recipients: typeof players = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const p of players) {
      if (!p.active || db.recapPrefs[p.id] === false) continue;
      const email = db.contacts[p.id]?.email || (p.userId ? db.users[p.userId]?.email : null) || null;
      if (!email) { missing.push(p.displayName); continue; }
      if (seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      recipients.push(p);
    }
    const first = recipients[0];
    const sample = buildRecapEmail({
      leagueName: league.name, weekNumber: ev.weekNumber, leagueUrl: `${location.origin}/l/${league.slug}`, recapBody: text,
      playerName: first?.displayName ?? 'Golfer', payment: db.paymentHandles[league.id] ?? { venmo: null, paypalMe: null, zelle: null },
      weekCents: forMoney && first ? recap.weekBalances[first.id] ?? 0 : null,
      seasonCents: forMoney && first ? recap.seasonBalances[first.id] ?? 0 : null,
      story: story ? cleanStory(story) : null,
    });
    return { recap, preview: { subject: sample.subject, text: sample.text, recipients: recipients.length, missing, alreadySent: db.recapSends[eventId] ?? null } };
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
    async verifyCode() {
      // Demo signs in straight away, so there's never a code to check.
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
      const league: League = { id: l.id, name: l.name, slug: l.slug, plan: l.plan, role, joinCode: l.joinCode, timezone: l.timezone, effectivePlan: l.plan, features: FEATURES[l.plan],
        logoUrl: l.logoUrl ?? null, bannerUrl: l.bannerUrl ?? null, brandColor: l.brandColor ?? null, accentColor: l.accentColor ?? null, sharePhones: !!l.sharePhones,
        rsvpReminderDays: l.rsvpReminderDays ?? null };
      return league;
    },
    uploadLogo: (leagueId, png) => demoBrandFile(leagueId, 'logoUrl', png),
    removeLogo: async (leagueId) => void (await demoBrandFile(leagueId, 'logoUrl', null)),
    uploadBanner: (leagueId, jpeg) => demoBrandFile(leagueId, 'bannerUrl', jpeg),
    removeBanner: async (leagueId) => void (await demoBrandFile(leagueId, 'bannerUrl', null)),
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
      if ((patch.brandColor || patch.accentColor) && !has(db, leagueId, 'branding')) throw new Error('plan_feature: League logo and colors needs GolfScoreHQ Pro');
      if (patch.brandColor !== undefined) l.brandColor = patch.brandColor;
      if (patch.accentColor !== undefined) l.accentColor = patch.accentColor;
      if (patch.sharePhones !== undefined) l.sharePhones = patch.sharePhones;
      if (patch.rsvpReminderDays !== undefined) l.rsvpReminderDays = patch.rsvpReminderDays;
      save(db);
    },
    async phoneBook(leagueId) {
      // Same rule as league_phone_book(): commissioners always; golfers when the league shares numbers.
      const db = load();
      const l = db.leagues.find((x) => x.id === leagueId)!;
      if (!isCommissioner(roleIn(db, leagueId)) && !(l.sharePhones && roleIn(db, leagueId))) return {};
      const active = new Set(db.players.filter((p) => p.leagueId === leagueId && p.active).map((p) => p.id));
      return Object.fromEntries(Object.entries(db.contacts).filter(([pid, c]) => active.has(pid) && c.phone).map(([pid, c]) => [pid, c.phone!]));
    },

    async players(leagueId) {
      const db = load();
      requireMember(db, leagueId);
      return db.players
        .filter((p) => p.leagueId === leagueId)
        .map(({ leagueId: _l, ...p }) => ({ ...p, handicapIndex: p.handicapIndex ?? null, ghinNumber: p.ghinNumber ?? null, handicapIndexUpdatedAt: p.handicapIndexUpdatedAt ?? null }))
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
      // Same limits as the database.
      if (patch.handicapIndex != null && !(patch.handicapIndex >= -10 && patch.handicapIndex <= 54)) throw new Error('A Handicap Index is between +10 and 54.');
      if (patch.ghinNumber && !/^[0-9]{5,10}$/.test(patch.ghinNumber)) throw new Error('A GHIN number is 5 to 10 digits.');
      Object.assign(p, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
      if (patch.handicapIndex !== undefined) p.handicapIndexUpdatedAt = new Date().toISOString();
      save(db);
    },
    async mergePlayers(keepId, dropId) {
      // Same rules as merge_players() in the database.
      const db = load();
      if (keepId === dropId) throw new Error('Pick two different golfers.');
      const k = db.players.find((x) => x.id === keepId)!;
      const d = db.players.find((x) => x.id === dropId)!;
      requireCommissioner(db, k.leagueId);
      if (k.userId && d.userId && k.userId !== d.userId) throw new Error('Both golfers have their own app accounts, so they are different people.');
      const both = db.rounds.find((r) => r.players.some((p) => p.playerId === keepId) && r.players.some((p) => p.playerId === dropId));
      if (both) throw new Error('They played in the same group, so they are different golfers.');
      for (const r of db.rounds) {
        for (const p of r.players) if (p.playerId === dropId) p.playerId = keepId;
        if (r.scores[dropId]) { r.scores[keepId] = r.scores[dropId]!; delete r.scores[dropId]; }
        for (const c of Object.values(r.ctp)) {
          if (c.playerId === dropId) c.playerId = keepId;
          if (c.beat === dropId) c.beat = c.playerId === keepId ? null : keepId;
        }
      }
      for (const e of db.ledger) if (e.playerId === dropId) e.playerId = keepId;
      const dc = db.contacts[dropId];
      if (dc) {
        const kc = db.contacts[keepId];
        db.contacts[keepId] = { ...dc, ...kc, email: kc?.email || dc.email, phone: kc?.phone || dc.phone };
        delete db.contacts[dropId];
      }
      Object.assign(k, {
        displayName: k.displayName.trim().replace(/\s+/g, ' '),
        userId: k.userId ?? d.userId, handicapIndex: k.handicapIndex ?? d.handicapIndex ?? null,
        ghinNumber: k.ghinNumber ?? d.ghinNumber ?? null, active: k.active || d.active,
      });
      db.players = db.players.filter((x) => x.id !== dropId);
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
      checkFormat(db, leagueId, s.rules);
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
      checkFormat(db, s.leagueId, rules);
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
      demoSyncWeek(db, ev.id);
      save(db);
      return ev.id;
    },
    async updateEvent(eventId, patch) {
      const db = load();
      const e = db.events.find((x) => x.id === eventId)!;
      requireCommissioner(db, e.leagueId);
      if (patch.rulesOverride) {
        // Same as the events_override_plan trigger: special weeks need Pro.
        if (!has(db, e.leagueId, 'all_formats')) throw new Error('plan_feature: Special weeks needs GolfScoreHQ Pro');
        if (usesSideGames(patch.rulesOverride) && !has(db, e.leagueId, 'side_games')) throw new Error('plan_feature: Side games and money needs GolfScoreHQ Pro');
      }
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
      const r = { id: id(), leagueId, eventId, teeSlot, status: 'live' as const, currentHole: 0, players: players.map((p) => ({ ...p, courseHandicap: p.courseHandicap ?? null })), scores: {}, presses: [], ctp: {}, submittedAt: null };
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
    // Billing: demo pretends checkout succeeded straight away (Stripe isn't involved).
    async leagueBilling(leagueId) {
      const db = load();
      if (!isCommissioner(roleIn(db, leagueId))) return null;
      const l = db.leagues.find((x) => x.id === leagueId)!;
      const club = l.clubId ? db.clubs.find((c) => c.id === l.clubId) : undefined;
      return {
        plan: l.plan, effectivePlan: l.plan, clubName: club?.name ?? null, isOwner: l.ownerId === db.session,
        expiresAt: l.plan === 'club' ? club?.expiresAt ?? null : l.planExpiresAt ?? null,
        subscription: l.demoSub ?? null,
      };
    },
    async startCheckout(target) {
      const db = load();
      const yearOut = new Date(Date.now() + 365 * 86_400_000).toISOString();
      if ('leagueId' in target) {
        requireCommissioner(db, target.leagueId);
        const l = db.leagues.find((x) => x.id === target.leagueId)!;
        if (l.plan === 'pilot' || l.plan === 'comp') throw new Error('This league already has GolfScoreHQ Pro free.');
        if (l.plan === 'club') throw new Error('This league is covered by a Club plan.');
        Object.assign(l, { plan: 'pro', planExpiresAt: yearOut, demoSub: { status: 'active', renewsAt: yearOut, cancelAtPeriodEnd: false, paidByMe: true } });
        save(db);
        return `/l/${l.slug}/settings?billing=done`;
      }
      const c = db.clubs.find((x) => x.id === target.clubId && x.ownerId === db.session);
      if (!c) throw new Error("That club isn't yours.");
      c.expiresAt = yearOut;
      save(db);
      return '/leagues?billing=done';
    },
    async billingPortal() {
      throw new Error("Demo mode: Stripe's billing page isn't available here. The live site opens it.");
    },
    async myClubs() {
      const db = load();
      return db.clubs.filter((c) => c.ownerId === db.session).map((c) => ({
        id: c.id, name: c.name, expiresAt: c.expiresAt,
        leagues: db.leagues.filter((l) => l.clubId === c.id).map((l) => ({ id: l.id, name: l.name, slug: l.slug })),
      }));
    },
    async createClub(name) {
      const db = load();
      const u = me(db);
      if (name.trim().length < 2) throw new Error('Give the club a name.');
      const c = { id: id(), ownerId: u.id, name: name.trim(), expiresAt: null };
      db.clubs.push(c);
      save(db);
      return c.id;
    },
    async setLeagueClub(leagueId, clubId) {
      // Same rules as set_league_club() in the database.
      const db = load();
      const l = db.leagues.find((x) => x.id === leagueId);
      if (!l || l.ownerId !== db.session) throw new Error("Only the league's owner can do that.");
      if (!clubId) {
        if (l.plan === 'club') l.plan = 'free';
        l.clubId = null;
        save(db);
        return;
      }
      const c = db.clubs.find((x) => x.id === clubId && x.ownerId === db.session);
      if (!c) throw new Error("That club isn't yours.");
      if (!c.expiresAt || new Date(c.expiresAt) < new Date()) throw new Error('Start the Club plan first.');
      if (l.plan === 'pilot' || l.plan === 'comp') throw new Error("This league already has GolfScoreHQ free; it doesn't need the Club.");
      if (l.demoSub && !l.demoSub.cancelAtPeriodEnd) throw new Error("This league pays for its own Pro plan. Cancel it under Manage billing first, so you aren't charged twice.");
      if (db.leagues.filter((x) => x.clubId === clubId && x.id !== leagueId).length >= 5) throw new Error('A Club covers up to 5 leagues.');
      Object.assign(l, { clubId, plan: 'club', planExpiresAt: null });
      save(db);
    },

    async recapPreview(eventId, story) {
      return demoRecap(load(), eventId, story).preview;
    },
    async draftRecapStory(eventId) {
      // Demo has no AI: a fill-in-the-blanks sample built from the same results.
      const db = load();
      const { recap } = demoRecap(db, eventId);
      const first = (pid: string) => (db.players.find((p) => p.id === pid)?.displayName ?? '?').split(' ')[0];
      const lines: string[] = [];
      const best = recap.highlights[0];
      if (best) lines.push(`${first(best.playerId)} got things going with ${best.kind === 'birdie' ? 'a birdie' : `an ${best.kind}`} on ${best.holeNumber}, and the rest of the field spent the night trying to catch up.`);
      const winners = recap.leaderboard.filter((l) => l.place === 1);
      if (winners.length) {
        const how = recap.format === 'stableford' ? `${winners[0]!.points} points` : recap.net ? `a net ${winners[0]!.score - winners[0]!.grossToPar + winners[0]!.toPar}` : `a ${winners[0]!.score}`;
        const who = winners.map((w) => w.playerIds.map(first).join(', ')).join(' and ');
        lines.push(`${recap.format === 'scramble' ? `The team of ${who}` : who} ${winners.length > 1 ? 'shared the top spot' : 'took the week'} with ${how}.`);
      } else if (recap.lowRound) lines.push(`${recap.lowRound.playerIds.map(first).join(' and ')} posted the low round, a ${recap.lowRound.score}.`);
      const skins = new Map<string, number>();
      for (const s of recap.skins) for (const p of s.playerIds) skins.set(p, (skins.get(p) ?? 0) + 1);
      const topSkins = recap.format === 'scramble' ? undefined : [...skins].sort((a, b) => b[1] - a[1])[0];
      const close = recap.matches.find((m) => m.winner === null);
      const second = [
        topSkins ? (topSkins[1] > 1 ? `${first(topSkins[0])} cleaned up with ${topSkins[1]} skins.` : `${first(topSkins[0])} grabbed a skin.`) : '',
        close ? `${close.teamA.map(first).join(' & ')} and ${close.teamB.map(first).join(' & ')} couldn't be separated, so nobody gets bragging rights until next week.` : '',
      ].filter(Boolean).join(' ');
      return [lines.join(' ') || `Week ${recap.week} is in the books.`, second].filter(Boolean).join('\n\n');
    },
    async sendRecap(eventId, opts = {}) {
      // Demo never emails anyone; it records the send so the screens behave the same.
      const db = load();
      const { preview } = demoRecap(db, eventId, opts.story);
      if (preview.alreadySent && !opts.force) throw new Error('already_sent');
      db.recapSends[eventId] = { sent_at: new Date().toISOString(), recipients: preview.recipients };
      save(db);
      return { sent: preview.recipients, missing: preview.missing };
    },
    async recapPref(playerId) {
      return load().recapPrefs[playerId] ?? true;
    },
    async setRecapPref(leagueId, playerId, on) {
      const db = load();
      const u = me(db);
      const spot = db.players.find((p) => p.id === playerId);
      if (!(isCommissioner(roleIn(db, leagueId)) || spot?.userId === u.id)) throw new Error("You don't have permission to do that.");
      db.recapPrefs[playerId] = on;
      save(db);
    },
    async paymentHandles(leagueId) {
      const db = load();
      requireMember(db, leagueId);
      return { ...(db.paymentHandles[leagueId] ?? { venmo: null, paypalMe: null, zelle: null }) };
    },
    async savePaymentHandles(leagueId, h) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (!has(db, leagueId, 'payments')) throw new Error('plan_feature: Payment links need GolfScoreHQ Pro');
      db.paymentHandles[leagueId] = { ...h };
      save(db);
    },

    async rsvps(eventId) {
      const db = load();
      return { ...(db.rsvps[eventId] ?? {}) };
    },
    async reminderPreview(eventId) {
      const db = load();
      const ev = db.events.find((e) => e.id === eventId)!;
      requireCommissioner(db, ev.leagueId);
      if (!has(db, ev.leagueId, 'rsvp')) throw new Error('Reminder emails need GolfScoreHQ Pro.');
      const answered = new Set([...Object.keys(db.rsvps[eventId] ?? {}), ...(db.teeSheets[eventId]?.lineup ?? []).map((l) => l.playerId)]);
      const due = db.players.filter((p) => p.leagueId === ev.leagueId && p.active && !p.isSub && !answered.has(p.id));
      const email = (p: { id: string; userId: string | null }) => db.contacts[p.id]?.email || (p.userId ? db.users[p.userId]?.email : null);
      return { recipients: due.filter(email).length, missing: due.filter((p) => !email(p)).map((p) => p.displayName), alreadySent: db.reminderSends[eventId] ?? null };
    },
    async sendReminder(eventId) {
      // Demo never emails anyone; it records the send so the screens behave the same.
      const { recipients } = await this.reminderPreview(eventId);
      const db = load();
      db.reminderSends[eventId] = { sent_at: new Date().toISOString(), recipients };
      save(db);
      return { sent: recipients };
    },
    async rsvpByLink() {
      return null; // the links are in real emails only
    },
    async setRsvp(leagueId, eventId, playerId, status) {
      const db = load();
      const u = me(db);
      const spot = db.players.find((p) => p.id === playerId);
      if (!has(db, leagueId, 'rsvp') || !(isCommissioner(roleIn(db, leagueId)) || spot?.userId === u.id)) throw new Error("You don't have permission to do that.");
      (db.rsvps[eventId] ??= {})[playerId] = status;
      save(db);
    },
    async subRequests(eventId) {
      const db = load();
      return db.subRequests.filter((r) => r.eventId === eventId).map(({ eventId: _e, leagueId: _l, ...r }) => ({ ...r, offers: r.offers.map((o) => ({ ...o })) }));
    },
    async createSubRequest(leagueId, eventId, opts, askPlayerIds) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (!has(db, leagueId, 'rsvp')) throw new Error("You don't have permission to do that.");
      const r = { id: id(), leagueId, eventId, teeSlot: opts.teeSlot, spots: opts.spots, filled: 0, closed: false, offers: askPlayerIds.map((p) => ({ playerId: p, status: 'offered' as const })) };
      db.subRequests.push(r);
      save(db);
      return r.id;
    },
    async respondSubOffer(requestId, playerId, accept) {
      // Same rules as respond_to_sub_offer(): the golfer (or commissioner) answers; first to accept wins.
      const db = load();
      const u = me(db);
      const r = db.subRequests.find((x) => x.id === requestId);
      const spot = db.players.find((p) => p.id === playerId);
      if (!r || !(spot?.userId === u.id || isCommissioner(roleIn(db, r.leagueId)))) throw new Error('not your offer');
      const offer = r.offers.find((o) => o.playerId === playerId);
      if (!offer) throw new Error('no such offer');
      if (offer.status !== 'offered') return offer.status;
      if (!accept) offer.status = 'declined';
      else if (r.closed || r.filled >= r.spots) offer.status = 'too_late';
      else {
        offer.status = 'accepted';
        r.filled++;
        if (r.filled >= r.spots) r.closed = true;
        (db.rsvps[r.eventId] ??= {})[playerId] = 'in';
      }
      save(db);
      return offer.status;
    },
    async closeSubRequest(requestId) {
      const db = load();
      const r = db.subRequests.find((x) => x.id === requestId)!;
      requireCommissioner(db, r.leagueId);
      r.closed = true;
      save(db);
    },
    // ── Tee sheet: same rules as the database functions ──
    async teeSheet(eventId) {
      const db = load();
      const ev = db.events.find((e) => e.id === eventId)!;
      requireMember(db, ev.leagueId);
      const sheet: TeeSheet = JSON.parse(JSON.stringify(db.teeSheets[eventId] ?? { times: [], lineup: [] }));
      return { ...sheet, custom: !!sheet.custom, seasonTimes: (db.seasonTeeTimes[ev.seasonId] ?? []).length };
    },
    async seasonTeeTimes(seasonId) {
      const db = load();
      const s = db.seasons.find((x) => x.id === seasonId)!;
      requireMember(db, s.leagueId);
      return [...(db.seasonTeeTimes[seasonId] ?? [])];
    },
    async setSeasonTeeTimes(seasonId, times) {
      const db = load();
      const s = db.seasons.find((x) => x.id === seasonId)!;
      requireCommissioner(db, s.leagueId);
      if (!has(db, s.leagueId, 'lineup')) throw new Error('plan_feature: The tee sheet needs GolfScoreHQ Pro');
      if (times.length > 30) throw new Error('Up to 30 tee times.');
      if (times.some((t) => !t)) throw new Error('Every tee time needs a time.');
      db.seasonTeeTimes[seasonId] = [...times];
      for (const e of db.events.filter((x) => x.seasonId === seasonId)) demoSyncWeek(db, e.id);
      save(db);
    },
    async useSeasonTeeTimes(eventId) {
      const { db, ev, sheet } = lineupDb(eventId);
      requireCommissioner(db, ev.leagueId);
      sheet.custom = false;
      demoSyncWeek(db, eventId);
      save(db);
    },
    async setTeeTimes(eventId, times) {
      const { db, ev, sheet } = lineupDb(eventId);
      requireCommissioner(db, ev.leagueId);
      const season = db.seasonTeeTimes[ev.seasonId] ?? [];
      sheet.custom = times.map((t) => `${t.slot}@${t.time}`).sort().join() !== season.map((t, i) => `${i + 1}@${t}`).sort().join();
      sheet.times = times.map((t) => ({ ...t }));
      for (const l of sheet.lineup) if (l.slot !== null && !times.some((t) => t.slot === l.slot)) l.slot = null;
      for (const t of times) {
        if (!t.captainId) continue;
        sheet.lineup = sheet.lineup.filter((l) => l.playerId !== t.captainId);
        sheet.lineup.push({ playerId: t.captainId, slot: t.slot, looking: null, partnerId: null });
        (db.rsvps[eventId] ??= {})[t.captainId] = 'in';
      }
      save(db);
    },
    async lineupJoin(eventId, playerId, slot) {
      const { db, ev, sheet } = lineupDb(eventId);
      const t = sheet.times.find((x) => x.slot === slot);
      if (!t) throw new Error('No such tee time.');
      if (!demoCanPlace(db, ev.leagueId, sheet, playerId, slot)) throw new Error('You can add yourself, or golfers to your own group.');
      const n = sheet.lineup.filter((l) => l.slot === slot && l.playerId !== playerId).length;
      if (n >= 5 || (n >= 4 && !isCommissioner(roleIn(db, ev.leagueId)))) throw new Error('That group is full.');
      if (!sheet.lineup.some((l) => l.playerId === playerId && l.slot === slot)) {
        demoClear(sheet, playerId);
        sheet.lineup.push({ playerId, slot, looking: null, partnerId: null });
      }
      (db.rsvps[eventId] ??= {})[playerId] = 'in';
      save(db);
    },
    async lineupLeave(eventId, playerId) {
      const { db, ev, sheet } = lineupDb(eventId);
      const slot = sheet.lineup.find((l) => l.playerId === playerId)?.slot ?? null;
      if (!demoCanPlace(db, ev.leagueId, sheet, playerId, slot)) throw new Error('You can only take yourself out, or golfers from a group you captain.');
      demoClear(sheet, playerId);
      save(db);
    },
    async lineupStatus(eventId, playerId, status, partnerId) {
      const { db, ev, sheet } = lineupDb(eventId);
      const u = me(db);
      const actsFor = (pid: string) => isCommissioner(roleIn(db, ev.leagueId)) || db.players.find((p) => p.id === pid)?.userId === u.id;
      if (!actsFor(playerId)) throw new Error('You can only change your own status.');
      if (status === 'match' && (!partnerId || partnerId === playerId)) throw new Error('Pick your partner.');
      demoClear(sheet, playerId);
      const rsvps = (db.rsvps[eventId] ??= {});
      if (status === 'out') rsvps[playerId] = 'out';
      if (status === 'partner') { sheet.lineup.push({ playerId, slot: null, looking: 'partner', partnerId: null }); rsvps[playerId] = 'in'; }
      if (status === 'match' && partnerId) {
        demoClear(sheet, partnerId);
        sheet.lineup.push({ playerId, slot: null, looking: 'match', partnerId }, { playerId: partnerId, slot: null, looking: 'match', partnerId: playerId });
        rsvps[playerId] = 'in';
        rsvps[partnerId] = 'in';
      }
      save(db);
    },

    async tvDisplays(leagueId) {
      const db = load();
      requireCommissioner(db, leagueId);
      return db.tvDisplays.filter((d) => d.leagueId === leagueId && !d.revokedAt).map(({ id: did, name, settings, createdAt }) => ({ id: did, name, settings, createdAt }));
    },
    async createTvDisplay(leagueId, name, settings) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (!has(db, leagueId, 'tv_mode')) throw new Error("You don't have permission to do that.");
      const token = randomToken();
      db.tvDisplays.push({ id: id(), leagueId, name, settings, tokenHash: await sha256Hex(token), createdAt: new Date().toISOString(), revokedAt: null });
      save(db);
      return token;
    },
    async updateTvDisplay(did, patch) {
      const db = load();
      const d = db.tvDisplays.find((x) => x.id === did)!;
      requireCommissioner(db, d.leagueId);
      if (patch.name !== undefined) d.name = patch.name;
      if (patch.settings !== undefined) d.settings = patch.settings;
      save(db);
    },
    async revokeTvDisplay(did) {
      const db = load();
      const d = db.tvDisplays.find((x) => x.id === did)!;
      requireCommissioner(db, d.leagueId);
      d.revokedAt = new Date().toISOString();
      save(db);
    },
    async setupRequests(leagueId) {
      const db = load();
      requireCommissioner(db, leagueId);
      return db.setupRequests.filter((r) => r.leagueId === leagueId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ requestedBy: _r, staffUserId: _s, ...r }) => r);
    },
    async uploadSetupFile(leagueId, file) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (!has(db, leagueId, 'setup_service')) throw new Error('plan_feature: We set up your league needs GolfScoreHQ Pro');
      if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is over 20 MB.`);
      const path = `${leagueId}/${id().slice(0, 10)}-${file.name}`;
      demoFiles.set(path, URL.createObjectURL(file));
      return { path, name: file.name, size: file.size };
    },
    async removeSetupFile(path) {
      const url = demoFiles.get(path);
      if (url) URL.revokeObjectURL(url);
      demoFiles.delete(path);
    },
    async createSetupRequest(leagueId, r) {
      const db = load();
      requireCommissioner(db, leagueId);
      if (!has(db, leagueId, 'setup_service')) throw new Error('plan_feature: We set up your league needs GolfScoreHQ Pro');
      const now = new Date().toISOString();
      const req = { ...r, id: id(), leagueId, status: 'requested' as const, staffReply: null, createdAt: now, updatedAt: now, requestedBy: me(db).id, staffUserId: null };
      db.setupRequests.push(req);
      save(db);
      return { id: req.id, emailError: null };
    },
    async updateSetupRequest(reqId, patch) {
      const db = load();
      const r = db.setupRequests.find((x) => x.id === reqId)!;
      requireCommissioner(db, r.leagueId);
      if (r.status === 'in_progress' || r.status === 'done') throw new Error("This request can't be changed now.");
      Object.assign(r, { notes: patch.notes, files: patch.files, status: 'requested', updatedAt: new Date().toISOString() });
      save(db);
      return { emailError: null };
    },
    async setupFileUrl(path) {
      const url = demoFiles.get(path);
      if (!url) throw new Error('Demo uploads only last until the page is reloaded.');
      return url;
    },
    // Demo: you're GolfScoreHQ staff too, so the staff page can be tried.
    async isStaff() {
      return !!load().session;
    },
    async staffSetupQueue() {
      const db = load();
      me(db);
      return db.setupRequests
        .map((r) => {
          const lg = db.leagues.find((l) => l.id === r.leagueId)!;
          const { requestedBy, ...rest } = r;
          return { ...rest, leagueName: lg.name, leagueSlug: lg.slug, leaguePlan: lg.plan, requestedByEmail: db.users[requestedBy]?.email ?? null };
        })
        .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.createdAt.localeCompare(a.createdAt));
    },
    async staffJoinLeague(reqId) {
      const db = load();
      const r = db.setupRequests.find((x) => x.id === reqId)!;
      if (!r.staffAccess) throw new Error("This commissioner didn't give support access to the league.");
      if (r.status === 'done') throw new Error('This request is done.');
      const uid = me(db).id;
      if (!db.members.some((m) => m.leagueId === r.leagueId && m.userId === uid)) db.members.push({ leagueId: r.leagueId, userId: uid, role: 'commissioner' });
      r.staffUserId = uid;
      if (r.status === 'requested') r.status = 'in_progress';
      save(db);
      return db.leagues.find((l) => l.id === r.leagueId)!.slug;
    },
    async staffUpdateSetupRequest(reqId, status, reply) {
      const db = load();
      const r = db.setupRequests.find((x) => x.id === reqId)!;
      Object.assign(r, { status, staffReply: reply.trim() || null, updatedAt: new Date().toISOString() });
      // Same as the database: done takes away the access staff got for this request.
      if (status === 'done' && r.staffUserId) {
        db.members = db.members.filter((m) => !(m.leagueId === r.leagueId && m.userId === r.staffUserId && m.role === 'commissioner'));
      }
      save(db);
    },

    async tvFeed(token) {
      // Same shape as the database's tv_feed(); no sign-in needed.
      const db = load();
      const hash = await sha256Hex(token);
      const d = db.tvDisplays.find((x) => x.tokenHash === hash && !x.revokedAt);
      if (!d) return null;
      const lg = db.leagues.find((l) => l.id === d.leagueId)!;
      if (!has(db, lg.id, 'tv_mode')) return { error: 'plan', league: { name: lg.name } };
      const season = db.seasons.filter((s) => s.leagueId === lg.id).sort((a, b) => b.year - a.year)[0];
      const events = season ? db.events.filter((e) => e.seasonId === season.id).sort((a, b) => b.weekNumber - a.weekNumber) : [];
      const ev = events.find((e) => (e.status === 'scheduled' || e.status === 'in_progress') && db.rounds.some((r) => r.eventId === e.id)) ?? events[0];
      const layout = ev?.layoutId ? db.courses.flatMap((c) => c.layouts.map((l) => ({ ...l, courseName: c.name }))).find((l) => l.id === ev.layoutId) ?? null : null;
      const settled = new Set(events.filter((e) => e.status === 'settled').map((e) => e.id));
      const totals = new Map<string, { playerId: string; money: number; skins: number; ctps: number }>();
      for (const e of db.ledger.filter((x) => settled.has(x.eventId))) {
        const t = totals.get(e.playerId) ?? { playerId: e.playerId, money: 0, skins: 0, ctps: 0 };
        t.money += e.amountCents;
        if (e.kind === 'skin') t.skins++;
        if (e.kind === 'ctp') t.ctps++;
        totals.set(e.playerId, t);
      }
      return {
        league: has(db, lg.id, 'branding')
          ? { name: lg.name, slug: lg.slug, logoUrl: lg.logoUrl ?? null, brandColor: lg.brandColor ?? null, accentColor: lg.accentColor ?? null }
          : { name: lg.name, slug: lg.slug, logoUrl: null, brandColor: null, accentColor: null },
        display: { name: d.name, settings: d.settings },
        season: season ? { year: season.year, name: season.name, rules: season.rules } : null,
        event: ev ? { id: ev.id, weekNumber: ev.weekNumber, eventDate: ev.eventDate, status: ev.status, rulesOverride: ev.rulesOverride ?? null } : null,
        layout,
        players: db.players.filter((p) => p.leagueId === lg.id).map((p) => ({ id: p.id, displayName: p.displayName, isSub: p.isSub })),
        rounds: ev ? db.rounds.filter((r) => r.eventId === ev.id).map(({ leagueId: _l, ...r }) => ({ ...r, presses: [] })) : [],
        standings: [...totals.values()].sort((a, b) => b.money - a.money),
        generatedAt: new Date().toISOString(),
      };
    },
    watchLeague(_leagueId, onChange) {
      // Demo data lives in this browser: other tabs signal changes through storage events.
      const onStorage = (e: StorageEvent) => { if (e.key === KEY) onChange(); };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
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

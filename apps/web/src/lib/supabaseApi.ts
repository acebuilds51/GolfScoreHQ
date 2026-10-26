import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, CourseSummary, LookupCourse } from './api';
import type { Contact, Course, Layout, League, LeagueEvent, LeagueSummary, Plan, Role, RoundData, Season, TvFeed, User } from './types';
import { randomToken, sha256Hex } from './util';

type Row = Record<string, any>;

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Call the course-lookup server function and surface its message on failure. */
async function invokeLookup(sb: SupabaseClient, body: Record<string, string>): Promise<unknown> {
  const { data, error } = await sb.functions.invoke('course-lookup', { body });
  if (!error) return data;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    const detail = await ctx.json().catch(() => null);
    if (detail?.error) throw new Error(detail.error);
    if (ctx.status === 404) throw new Error("Course lookup isn't set up yet. Enter the pars by hand for now.");
  }
  throw new Error("Course lookup isn't available right now. Enter the pars by hand for now.");
}

const toUser =(u: { id: string; email?: string | null } | null | undefined): User | null =>
  u ? { id: u.id, email: u.email ?? '' } : null;

export function supabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });

  async function uid(): Promise<string> {
    const { data } = await sb.auth.getUser();
    if (!data.user) throw new Error('Sign in first.');
    return data.user.id;
  }

  return {
    mode: 'supabase',

    async currentUser() {
      const { data } = await sb.auth.getSession();
      return toUser(data.session?.user);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => cb(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, redirectTo) {
      check(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } }));
      return 'link-sent';
    },
    async signOut() {
      await sb.auth.signOut();
    },

    async myLeagues() {
      const me = await uid();
      const rows = check(await sb.from('league_members').select('role, leagues(id, name, slug, plan)').eq('user_id', me)) as Row[];
      return rows
        .filter((r) => r.leagues)
        .map((r): LeagueSummary => ({ id: r.leagues.id, name: r.leagues.name, slug: r.leagues.slug, plan: r.leagues.plan, role: r.role }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async createLeague(name, slug) {
      return check(await sb.rpc('create_league', { p_name: name, p_slug: slug })) as string;
    },
    async league(slug) {
      const me = await uid();
      const l = check(await sb.from('leagues').select('id, name, slug, plan, join_code, timezone').eq('slug', slug).maybeSingle()) as Row | null;
      if (!l) return null;
      const [member, eff] = await Promise.all([
        sb.from('league_members').select('role').eq('league_id', l.id).eq('user_id', me).maybeSingle(),
        sb.rpc('effective_plan', { lid: l.id }),
      ]);
      const effectivePlan = (check(eff) as Plan) ?? 'free';
      const plan = check(await sb.from('plans').select('features').eq('code', effectivePlan).maybeSingle()) as Row | null;
      const league: League = {
        id: l.id, name: l.name, slug: l.slug, plan: l.plan, joinCode: l.join_code, timezone: l.timezone,
        role: ((check(member) as Row | null)?.role ?? 'player') as Role,
        effectivePlan, features: plan?.features ?? [],
      };
      return league;
    },
    async updateLeague(id, patch) {
      const row: Row = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.joinCode !== undefined) row.join_code = patch.joinCode;
      if (patch.timezone !== undefined) row.timezone = patch.timezone;
      check(await sb.from('leagues').update(row).eq('id', id));
    },

    async players(leagueId) {
      const rows = check(await sb.from('players').select('id, display_name, is_sub, active, user_id').eq('league_id', leagueId).order('display_name')) as Row[];
      return rows.map((r) => ({ id: r.id, displayName: r.display_name, isSub: r.is_sub, active: r.active, userId: r.user_id }));
    },
    async contacts(leagueId) {
      const rows = check(await sb.from('player_contacts').select('player_id, email, phone').eq('league_id', leagueId)) as Row[];
      return Object.fromEntries(rows.map((r) => [r.player_id, { email: r.email, phone: r.phone } as Contact]));
    },
    async addPlayers(leagueId, players) {
      if (!players.length) return;
      const inserted = check(
        await sb.from('players').insert(players.map((p) => ({ league_id: leagueId, display_name: p.displayName, is_sub: p.isSub }))).select('id, display_name'),
      ) as Row[];
      const byName = new Map(inserted.map((r) => [r.display_name, r.id]));
      const contacts = players
        .filter((p) => p.email || p.phone)
        .map((p) => ({ player_id: byName.get(p.displayName), league_id: leagueId, email: p.email ?? null, phone: p.phone ?? null }))
        .filter((c) => c.player_id);
      if (contacts.length) check(await sb.from('player_contacts').insert(contacts));
    },
    async updatePlayer(id, patch) {
      const row: Row = {};
      if (patch.displayName !== undefined) row.display_name = patch.displayName;
      if (patch.isSub !== undefined) row.is_sub = patch.isSub;
      if (patch.active !== undefined) row.active = patch.active;
      check(await sb.from('players').update(row).eq('id', id));
    },
    async saveContact(leagueId, playerId, c) {
      check(await sb.from('player_contacts').upsert({ player_id: playerId, league_id: leagueId, email: c.email || null, phone: c.phone || null }));
    },

    async createInvite(leagueId, opts) {
      const token = randomToken();
      check(
        await sb.from('invites').insert({
          league_id: leagueId, token_hash: await sha256Hex(token), player_id: opts.playerId ?? null,
          email: opts.email ?? null, role: opts.role ?? 'player', created_by: await uid(),
        }),
      );
      return token;
    },
    async acceptInvite(token) {
      return check(await sb.rpc('accept_invite', { p_token: token })) as string;
    },
    async requestToJoin(code, name, message) {
      check(await sb.rpc('request_to_join', { p_code: code, p_message: message ?? null, p_name: name }));
    },
    async joinRequests(leagueId) {
      const rows = check(
        await sb.from('join_requests').select('user_id, requester_email, requester_name, message, created_at').eq('league_id', leagueId).eq('status', 'pending').order('created_at'),
      ) as Row[];
      return rows.map((r) => ({ userId: r.user_id, email: r.requester_email, name: r.requester_name, message: r.message, createdAt: r.created_at }));
    },
    async decideJoinRequest(leagueId, userId, approve) {
      check(await sb.rpc('decide_join_request', { p_league: leagueId, p_user: userId, p_approve: approve }));
    },
    async members(leagueId) {
      const [m, p] = await Promise.all([
        sb.from('league_members').select('user_id, role').eq('league_id', leagueId),
        sb.from('players').select('display_name, user_id').eq('league_id', leagueId).not('user_id', 'is', null),
      ]);
      const names = new Map((check(p) as Row[]).map((r) => [r.user_id, r.display_name]));
      return (check(m) as Row[]).map((r) => ({ userId: r.user_id, role: r.role, playerName: names.get(r.user_id) ?? null }));
    },
    async setMemberRole(leagueId, userId, role) {
      check(await sb.from('league_members').update({ role }).eq('league_id', leagueId).eq('user_id', userId));
    },

    async searchCourses(query) {
      return ((await invokeLookup(sb, { action: 'search', query })) as { courses: CourseSummary[] }).courses;
    },
    async lookupCourse(id) {
      return ((await invokeLookup(sb, { action: 'course', id })) as { course: LookupCourse }).course;
    },

    async courses(leagueId) {
      const rows = check(
        await sb.from('courses').select('id, name, city, state, league_id, layouts(id, name, tees, holes, rating, slope)').or(`league_id.eq.${leagueId},league_id.is.null`).order('name'),
      ) as Row[];
      return rows.map(
        (r): Course => ({
          id: r.id, name: r.name, city: r.city, state: r.state, leagueId: r.league_id,
          layouts: (r.layouts as Row[]).map((l): Layout => ({ id: l.id, name: l.name, tees: l.tees, holes: l.holes, rating: l.rating, slope: l.slope })),
        }),
      );
    },
    async createCourse(leagueId, course) {
      const c = check(
        await sb
          .from('courses')
          .insert({
            league_id: leagueId, name: course.name, city: course.city || null, state: course.state || null,
            external_source: course.source?.provider ?? null, external_id: course.source?.id ?? null,
          })
          .select('id')
          .single(),
      ) as Row;
      check(await sb.from('layouts').insert(course.layouts.map((l) => ({ course_id: c.id, name: l.name, tees: l.tees, holes: l.holes, rating: l.rating, slope: l.slope }))));
      return c.id;
    },
    async deleteCourse(courseId) {
      check(await sb.from('courses').delete().eq('id', courseId));
    },

    async seasons(leagueId) {
      const rows = check(await sb.from('seasons').select('id, league_id, year, name, rules, start_date, league_day').eq('league_id', leagueId).order('year', { ascending: false }).order('created_at', { ascending: false })) as Row[];
      return rows.map(toSeason);
    },
    async createSeason(leagueId, s) {
      const r = check(
        await sb.from('seasons').insert({ league_id: leagueId, year: s.year, name: s.name, rules: s.rules, start_date: s.startDate, league_day: s.leagueDay }).select('id').single(),
      ) as Row;
      return r.id;
    },
    async updateSeasonRules(seasonId, rules) {
      check(await sb.from('seasons').update({ rules }).eq('id', seasonId));
    },
    async events(seasonId) {
      const rows = check(await sb.from('events').select('id, season_id, week_number, event_date, layout_id, status').eq('season_id', seasonId).order('week_number')) as Row[];
      return rows.map(toEvent);
    },
    async event(eventId) {
      const r = check(await sb.from('events').select('id, season_id, week_number, event_date, layout_id, status').eq('id', eventId).maybeSingle()) as Row | null;
      return r ? toEvent(r) : null;
    },
    async createEvent(leagueId, seasonId, e) {
      const r = check(
        await sb.from('events').insert({ league_id: leagueId, season_id: seasonId, week_number: e.weekNumber, event_date: e.eventDate, layout_id: e.layoutId }).select('id').single(),
      ) as Row;
      return r.id;
    },
    async updateEvent(eventId, patch) {
      const row: Row = {};
      if (patch.layoutId !== undefined) row.layout_id = patch.layoutId;
      if (patch.eventDate !== undefined) row.event_date = patch.eventDate;
      if (patch.status !== undefined) row.status = patch.status;
      check(await sb.from('events').update(row).eq('id', eventId));
    },

    async eventRounds(eventId) {
      const rows = check(await sb.from('rounds').select(ROUND_SELECT).eq('event_id', eventId).order('tee_slot')) as Row[];
      return rows.map(toRound);
    },
    async round(roundId) {
      const r = check(await sb.from('rounds').select(ROUND_SELECT).eq('id', roundId).maybeSingle()) as Row | null;
      return r ? toRound(r) : null;
    },
    async startRound(leagueId, eventId, teeSlot, players) {
      const r = check(await sb.from('rounds').insert({ league_id: leagueId, event_id: eventId, tee_slot: teeSlot }).select('id').single()) as Row;
      check(await sb.from('round_players').insert(players.map((p) => ({ round_id: r.id, league_id: leagueId, player_id: p.playerId, side: p.side, position: p.position }))));
      return r.id;
    },
    async saveScores(leagueId, roundId, entries) {
      if (!entries.length) return;
      const me = await uid();
      check(
        await sb.from('hole_scores').upsert(
          entries.map((e) => ({ round_id: roundId, league_id: leagueId, player_id: e.playerId, hole_number: e.holeNumber, strokes: e.strokes, entered_by: me, updated_at: new Date().toISOString() })),
          { onConflict: 'round_id,player_id,hole_number' },
        ),
      );
    },
    async setCurrentHole(roundId, holeIndex) {
      check(await sb.from('rounds').update({ current_hole: holeIndex, updated_at: new Date().toISOString() }).eq('id', roundId));
    },
    async saveCtp(leagueId, roundId, holeNumber, entry) {
      check(
        await sb.from('ctp_reports').upsert(
          { round_id: roundId, league_id: leagueId, hole_number: holeNumber, player_id: entry.playerId, beat_player_id: entry.playerId ? entry.beat : null },
          { onConflict: 'round_id,hole_number' },
        ),
      );
    },
    async addPress(leagueId, roundId, startHole, calledBy) {
      const r = check(await sb.from('presses').insert({ round_id: roundId, league_id: leagueId, start_hole_number: startHole, called_by: calledBy }).select('id').single()) as Row;
      return r.id;
    },
    async removePress(pressId) {
      check(await sb.from('presses').delete().eq('id', pressId));
    },
    async submitRound(roundId) {
      check(await sb.from('rounds').update({ status: 'submitted', submitted_by: await uid(), submitted_at: new Date().toISOString() }).eq('id', roundId));
    },
    async addSub(leagueId, name) {
      return check(await sb.rpc('add_sub_player', { p_league: leagueId, p_name: name })) as string;
    },

    async ledger(eventId) {
      const rows = check(await sb.from('ledger_entries').select('player_id, round_id, kind, amount_cents, hole_number').eq('event_id', eventId)) as Row[];
      return rows.map((r) => ({ playerId: r.player_id, roundId: r.round_id, kind: r.kind, amountCents: r.amount_cents, holeNumber: r.hole_number }));
    },
    async tvDisplays(leagueId) {
      const rows = check(await sb.from('tv_displays').select('id, name, settings, created_at').eq('league_id', leagueId).is('revoked_at', null).order('created_at')) as Row[];
      return rows.map((r) => ({ id: r.id, name: r.name, settings: r.settings, createdAt: r.created_at }));
    },
    async createTvDisplay(leagueId, name, settings) {
      const token = randomToken();
      check(await sb.from('tv_displays').insert({ league_id: leagueId, name, settings, token_hash: await sha256Hex(token), created_by: await uid() }));
      return token;
    },
    async updateTvDisplay(id, patch) {
      const row: Row = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.settings !== undefined) row.settings = patch.settings;
      check(await sb.from('tv_displays').update(row).eq('id', id));
    },
    async revokeTvDisplay(id) {
      check(await sb.from('tv_displays').update({ revoked_at: new Date().toISOString() }).eq('id', id));
    },
    async tvFeed(token) {
      return (check(await sb.rpc('tv_feed', { p_token: token })) as TvFeed | null) ?? null;
    },
    watchLeague(leagueId, onChange) {
      const channel = sb.channel(`league-${leagueId}-${Math.random().toString(36).slice(2)}`);
      for (const table of ['hole_scores', 'rounds', 'ctp_reports', 'presses', 'events']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `league_id=eq.${leagueId}` }, () => onChange());
      }
      channel.subscribe();
      return () => { sb.removeChannel(channel); };
    },
    async seasonRounds(seasonId) {
      const rows = check(await sb.from('rounds').select(`${ROUND_SELECT}, events!inner(season_id)`).eq('events.season_id', seasonId)) as Row[];
      return rows.map(toRound);
    },
    async seasonLedger(seasonId) {
      const rows = check(
        await sb.from('ledger_entries').select('event_id, player_id, round_id, kind, amount_cents, hole_number, events!inner(season_id)').eq('events.season_id', seasonId),
      ) as Row[];
      return rows.map((r) => ({ eventId: r.event_id, playerId: r.player_id, roundId: r.round_id, kind: r.kind, amountCents: r.amount_cents, holeNumber: r.hole_number }));
    },
    async settleEvent(eventId, entries) {
      check(
        await sb.rpc('settle_event', {
          p_event: eventId,
          p_entries: entries.map((e) => ({ player_id: e.playerId, round_id: e.roundId, kind: e.kind, amount_cents: e.amountCents, hole_number: e.holeNumber })),
        }),
      );
    },
    async reopenEvent(eventId) {
      check(await sb.rpc('reopen_event', { p_event: eventId }));
    },
    async ctpDecisions(eventId) {
      const rows = check(await sb.from('ctp_decisions').select('hole_number, player_id').eq('event_id', eventId)) as Row[];
      return Object.fromEntries(rows.map((r) => [r.hole_number, r.player_id]));
    },
    async setCtpDecision(leagueId, eventId, holeNumber, playerId) {
      if (!playerId) {
        check(await sb.from('ctp_decisions').delete().eq('event_id', eventId).eq('hole_number', holeNumber));
        return;
      }
      check(await sb.from('ctp_decisions').upsert({ event_id: eventId, league_id: leagueId, hole_number: holeNumber, player_id: playerId, decided_by: await uid(), decided_at: new Date().toISOString() }));
    },
  };
}

const ROUND_SELECT =
  'id, event_id, tee_slot, status, current_hole, submitted_at, round_players(player_id, side, position), hole_scores(player_id, hole_number, strokes), presses(id, start_hole_number, called_by, created_at), ctp_reports(hole_number, player_id, beat_player_id)';

function toSeason(r: Row): Season {
  return { id: r.id, leagueId: r.league_id, year: r.year, name: r.name, rules: r.rules, startDate: r.start_date, leagueDay: r.league_day };
}

function toEvent(r: Row): LeagueEvent {
  return { id: r.id, seasonId: r.season_id, weekNumber: r.week_number, eventDate: r.event_date, layoutId: r.layout_id, status: r.status };
}

function toRound(r: Row): RoundData {
  const scores: RoundData['scores'] = {};
  for (const s of (r.hole_scores ?? []) as Row[]) (scores[s.player_id] ??= {})[s.hole_number] = s.strokes;
  const ctp: RoundData['ctp'] = {};
  for (const c of (r.ctp_reports ?? []) as Row[]) ctp[c.hole_number] = { playerId: c.player_id, beat: c.beat_player_id };
  return {
    id: r.id, eventId: r.event_id, teeSlot: r.tee_slot, status: r.status, currentHole: r.current_hole, submittedAt: r.submitted_at,
    players: ((r.round_players ?? []) as Row[]).map((p) => ({ playerId: p.player_id, side: p.side, position: p.position })).sort((a, b) => a.position - b.position),
    scores,
    presses: ((r.presses ?? []) as Row[])
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((p) => ({ id: p.id, startHole: p.start_hole_number, calledBy: p.called_by })),
    ctp,
  };
}

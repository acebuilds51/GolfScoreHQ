import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, CourseSummary, LookupCourse } from './api';
import type { Contact, Course, Layout, League, LeagueSummary, Plan, Role, User } from './types';
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
  };
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, CourseSummary, HealthSnapshot, LookupCourse } from './api';
import type { CourseInvoice, CourseReport, Feedback, LeagueBilling, LessonResult, LessonsDone, PilotCode, StaffCourse, PilotCodeStatus, RecapPreview, ReminderPreview, RsvpLinkInfo, SetupRequest, SubOffer, TeeTime } from './types';
import type { Contact, Course, Layout, League, LeagueEvent, LeagueSummary, Plan, Role, RoundData, Season, TvFeed, User } from './types';
import { isNetworkError } from './offline';
import { randomToken, sha256Hex } from './util';

type Row = Record<string, any>;

const LOGO_BUCKET = 'league-logos';
const SETUP_BUCKET = 'setup-uploads';

function toSetupRequest(r: Row): SetupRequest {
  return {
    id: r.id, leagueId: r.league_id, notes: r.notes ?? '', wants: r.wants ?? [], files: r.files ?? [], contactPhone: r.contact_phone ?? null,
    staffAccess: r.staff_access ?? true, status: r.status, staffReply: r.staff_reply ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const toFeedback = (r: Row): Feedback => ({
  id: r.id, kind: r.kind, message: r.message, status: r.status, reply: r.reply ?? null, repliedAt: r.replied_at ?? null,
  createdAt: r.created_at, leagueName: r.league_name ?? null, email: r.email ?? null, path: r.path ?? null,
});

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

/** Call a server function; its { error } message becomes the thrown message. */
async function invokeFn(sb: SupabaseClient, name: string, body: Record<string, unknown>, fallback: string): Promise<unknown> {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return data;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    const detail = await ctx.json().catch(() => null);
    if (detail?.error) throw new Error(detail.error);
  }
  throw new Error(fallback);
}

/** Call the send-recap server function; its { error } message becomes the thrown message. */
async function invokeRecap(sb: SupabaseClient, body: Record<string, unknown>, fn = 'send-recap', what = 'Recap emails'): Promise<unknown> {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (!error) return data;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    const detail = await ctx.json().catch(() => null);
    if (detail?.error) throw new Error(detail.error);
    if (ctx.status === 404) throw new Error(`${what} aren't set up yet (the ${fn} function isn't deployed).`);
  }
  throw new Error(`${what} aren't available right now. Try again in a minute.`);
}

const toUser =(u: { id: string; email?: string | null } | null | undefined): User | null =>
  u ? { id: u.id, email: u.email ?? '' } : null;

export function supabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  // Where supabase-js keeps the sign-in on this phone (its default name).
  const storedSession = (): { user?: { id: string; email?: string } } | null => {
    try { return JSON.parse(localStorage.getItem(`sb-${new URL(url).hostname.split('.')[0]}-auth-token`) ?? 'null'); } catch { return null; }
  };

  /** Tidy up replaced logo or banner files. Best effort: a leftover file is harmless. */
  async function removeOldFiles(leagueId: string, kind: 'logo' | 'banner', keep: string | null) {
    const { data } = await sb.storage.from(LOGO_BUCKET).list(leagueId);
    const old = (data ?? []).filter((f) => f.name.startsWith(`${kind}-`)).map((f) => `${leagueId}/${f.name}`).filter((p) => p !== keep);
    if (old.length) await sb.storage.from(LOGO_BUCKET).remove(old);
  }

  /** Email GolfScoreHQ support about a setup request. The request is already saved, so a failure is reported, not thrown. */
  async function notifySupport(requestId: string): Promise<string | null> {
    try {
      await invokeFn(sb, 'setup-notify', { requestId, event: 'created' }, "the email function didn't answer (is setup-notify deployed?)");
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  async function uploadBrandFile(leagueId: string, kind: 'logo' | 'banner', blob: Blob, type: 'image/png' | 'image/jpeg') {
    // A new file name each time, so browsers and email clients never show a stale picture.
    const path = `${leagueId}/${kind}-${Date.now()}.${type === 'image/png' ? 'png' : 'jpg'}`;
    const up = await sb.storage.from(LOGO_BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
    if (up.error) throw new Error(/row-level security|Unauthorized|403/i.test(up.error.message) ? 'plan_feature: League logo and colors needs GolfScoreHQ Pro' : up.error.message);
    const url = sb.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
    check(await sb.from('leagues').update(kind === 'logo' ? { logo_url: url } : { banner_url: url }).eq('id', leagueId));
    await removeOldFiles(leagueId, kind, path);
    return url;
  }

  // Who's signed in, from the session saved on this phone (no trip to the server: the
  // database checks the sign-in itself on every request, this is only for filtering).
  async function uid(): Promise<string> {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error('Sign in first.');
    return id;
  }

  return {
    mode: 'supabase',

    async currentUser() {
      const { data, error } = await sb.auth.getSession();
      if (data.session) return toUser(data.session.user);
      // The sign-in lasts an hour between renewals. If it ran out while the phone had no
      // signal, it can't renew until signal comes back, but the golfer is still signed in:
      // keep them in the app (scores wait on the phone) and the sign-in renews itself later.
      if (error && isNetworkError(error)) return toUser(storedSession()?.user);
      return null;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        // currentUser() answers the first check, including the no-signal case above.
        if (event === 'INITIAL_SESSION' && !session) return;
        cb(toUser(session?.user));
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, redirectTo) {
      check(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } }));
      return 'link-sent';
    },
    async verifyCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Check the newest email, or send a new code.' : error.message);
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
      const l = check(await sb.from('leagues').select('id, name, slug, plan, join_code, timezone, logo_url, banner_url, brand_color, accent_color, share_phones, share_emails, show_money, match_money, rsvp_reminder_days').eq('slug', slug).maybeSingle()) as Row | null;
      if (!l) return null;
      // All at once: the plans list is tiny, so fetch it rather than wait for the plan first.
      const [member, eff, plans] = await Promise.all([
        sb.from('league_members').select('role').eq('league_id', l.id).eq('user_id', me).maybeSingle(),
        sb.rpc('effective_plan', { lid: l.id }),
        sb.from('plans').select('code, features'),
      ]);
      const effectivePlan = (check(eff) as Plan) ?? 'free';
      const plan = (check(plans) as Row[]).find((p) => p.code === effectivePlan) ?? null;
      const league: League = {
        id: l.id, name: l.name, slug: l.slug, plan: l.plan, joinCode: l.join_code, timezone: l.timezone,
        role: ((check(member) as Row | null)?.role ?? 'player') as Role,
        effectivePlan, features: plan?.features ?? [],
        logoUrl: l.logo_url, bannerUrl: l.banner_url, brandColor: l.brand_color, accentColor: l.accent_color, sharePhones: !!l.share_phones,
        shareEmails: !!l.share_emails, showMoney: l.show_money !== false, matchMoney: l.match_money === 'commissioner' ? 'commissioner' : 'golfers',
        rsvpReminderDays: l.rsvp_reminder_days ?? null,
      };
      return league;
    },
    async updateLeague(id, patch) {
      const row: Row = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.joinCode !== undefined) row.join_code = patch.joinCode;
      if (patch.timezone !== undefined) row.timezone = patch.timezone;
      if (patch.brandColor !== undefined) row.brand_color = patch.brandColor;
      if (patch.accentColor !== undefined) row.accent_color = patch.accentColor;
      if (patch.sharePhones !== undefined) row.share_phones = patch.sharePhones;
      if (patch.shareEmails !== undefined) row.share_emails = patch.shareEmails;
      if (patch.showMoney !== undefined) row.show_money = patch.showMoney;
      if (patch.matchMoney !== undefined) row.match_money = patch.matchMoney;
      if (patch.rsvpReminderDays !== undefined) row.rsvp_reminder_days = patch.rsvpReminderDays;
      check(await sb.from('leagues').update(row).eq('id', id));
    },
    async phoneBook(leagueId) {
      const rows = check(await sb.rpc('league_phone_book', { lid: leagueId })) as Row[];
      return Object.fromEntries(rows.map((r) => [r.player_id, r.phone]));
    },
    async emailBook(leagueId) {
      const rows = check(await sb.rpc('league_email_book', { lid: leagueId })) as Row[];
      return Object.fromEntries(rows.map((r) => [r.player_id, r.email]));
    },
    uploadLogo: (leagueId, png) => uploadBrandFile(leagueId, 'logo', png, 'image/png'),
    async removeLogo(leagueId) {
      check(await sb.from('leagues').update({ logo_url: null }).eq('id', leagueId));
      await removeOldFiles(leagueId, 'logo', null);
    },
    uploadBanner: (leagueId, jpeg) => uploadBrandFile(leagueId, 'banner', jpeg, 'image/jpeg'),
    async removeBanner(leagueId) {
      check(await sb.from('leagues').update({ banner_url: null }).eq('id', leagueId));
      await removeOldFiles(leagueId, 'banner', null);
    },

    async players(leagueId) {
      const rows = check(
        await sb.from('players').select('id, display_name, is_sub, active, user_id, handicap_index, ghin_number, handicap_index_updated_at').eq('league_id', leagueId).order('display_name'),
      ) as Row[];
      return rows.map((r) => ({
        id: r.id, displayName: r.display_name, isSub: r.is_sub, active: r.active, userId: r.user_id,
        handicapIndex: r.handicap_index == null ? null : Number(r.handicap_index), ghinNumber: r.ghin_number, handicapIndexUpdatedAt: r.handicap_index_updated_at,
      }));
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
      if (patch.ghinNumber !== undefined) row.ghin_number = patch.ghinNumber;
      if (patch.handicapIndex !== undefined) {
        row.handicap_index = patch.handicapIndex;
        row.handicap_index_updated_at = new Date().toISOString();
      }
      check(await sb.from('players').update(row).eq('id', id));
    },
    async mergePlayers(keepId, dropId) {
      check(await sb.rpc('merge_players', { p_keep: keepId, p_drop: dropId }));
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
      const rows = check(await sb.from('seasons').select('id, league_id, year, name, rules, start_date, league_day, dues_cents').eq('league_id', leagueId).order('year', { ascending: false }).order('created_at', { ascending: false })) as Row[];
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
      const rows = check(await sb.from('events').select('id, season_id, week_number, event_date, layout_id, status, rules_override').eq('season_id', seasonId).order('week_number')) as Row[];
      return rows.map(toEvent);
    },
    async event(eventId) {
      const r = check(await sb.from('events').select('id, season_id, week_number, event_date, layout_id, status, rules_override').eq('id', eventId).maybeSingle()) as Row | null;
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
      if (patch.rulesOverride !== undefined) row.rules_override = patch.rulesOverride;
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
      check(await sb.from('round_players').insert(players.map((p) => ({ round_id: r.id, league_id: leagueId, player_id: p.playerId, side: p.side, position: p.position, course_handicap: p.courseHandicap ?? null }))));
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
    async leagueBilling(leagueId) {
      return (check(await sb.rpc('league_billing', { p_league: leagueId })) as LeagueBilling | null) ?? null;
    },
    async startCheckout(target) {
      return ((await invokeFn(sb, 'billing', { action: 'checkout', ...target }, "Payments aren't available right now. Try again in a minute.")) as { url: string }).url;
    },
    async billingPortal(returnPath) {
      return ((await invokeFn(sb, 'billing', { action: 'portal', returnPath }, "Payments aren't available right now. Try again in a minute.")) as { url: string }).url;
    },
    async myClubs() {
      const rows = check(await sb.from('clubs').select('id, name, plan_expires_at, leagues(id, name, slug)').eq('owner_id', await uid()).order('created_at')) as Row[];
      return rows.map((c) => ({ id: c.id, name: c.name, expiresAt: c.plan_expires_at, leagues: ((c.leagues ?? []) as Row[]).map((l) => ({ id: l.id, name: l.name, slug: l.slug })) }));
    },
    async createClub(name) {
      return check(await sb.rpc('create_club', { p_name: name })) as string;
    },
    async setLeagueClub(leagueId, clubId) {
      check(await sb.rpc('set_league_club', { p_league: leagueId, p_club: clubId }));
    },

    async recapPreview(eventId, story) {
      return (await invokeRecap(sb, { eventId, story: story ?? null })) as RecapPreview;
    },
    async draftRecapStory(eventId) {
      return ((await invokeRecap(sb, { eventId, draftStory: true })) as { story: string }).story;
    },
    async sendRecap(eventId, opts = {}) {
      return (await invokeRecap(sb, { eventId, send: true, force: !!opts.force, story: opts.story ?? null })) as { sent: number; missing: string[] };
    },
    async recapPref(playerId) {
      const row = check(await sb.from('notification_prefs').select('weekly_recap').eq('player_id', playerId).maybeSingle()) as Row | null;
      return row?.weekly_recap ?? true;
    },
    async setRecapPref(leagueId, playerId, on) {
      check(
        await sb.from('notification_prefs').upsert(
          { player_id: playerId, league_id: leagueId, weekly_recap: on, updated_at: new Date().toISOString() },
          { onConflict: 'player_id' },
        ),
      );
    },
    async paymentHandles(leagueId) {
      const row = check(await sb.from('league_payment_settings').select('venmo_username, paypal_me, zelle_contact').eq('league_id', leagueId).maybeSingle()) as Row | null;
      return { venmo: row?.venmo_username ?? null, paypalMe: row?.paypal_me ?? null, zelle: row?.zelle_contact ?? null };
    },
    async savePaymentHandles(leagueId, h) {
      check(
        await sb.from('league_payment_settings').upsert(
          { league_id: leagueId, venmo_username: h.venmo, paypal_me: h.paypalMe, zelle_contact: h.zelle, updated_at: new Date().toISOString() },
          { onConflict: 'league_id' },
        ),
      );
    },

    async rsvps(eventId) {
      const rows = check(await sb.from('event_rsvps').select('player_id, status').eq('event_id', eventId)) as Row[];
      return Object.fromEntries(rows.map((r) => [r.player_id, r.status]));
    },
    async reminderPreview(eventId) {
      return (await invokeRecap(sb, { eventId }, 'send-reminders', 'Reminder emails')) as ReminderPreview;
    },
    async sendReminder(eventId) {
      return (await invokeRecap(sb, { eventId, send: true }, 'send-reminders', 'Reminder emails')) as { sent: number };
    },
    async rsvpByLink(token, answer) {
      return (check(await sb.rpc('rsvp_by_link', { p_token: token, p_status: answer })) as RsvpLinkInfo | null) ?? null;
    },
    async pushKey() {
      return ((await invokeRecap(sb, { action: 'key' }, 'push', 'Phone notifications')) as { key: string | null }).key;
    },
    async savePushDevice(device) {
      // Same device again (e.g. after signing in as someone else): replace it.
      check(await sb.from('push_subscriptions').delete().eq('endpoint', device.endpoint));
      check(await sb.from('push_subscriptions').insert({ ...device, user_agent: navigator.userAgent.slice(0, 300) }));
    },
    async removePushDevice(endpoint) {
      check(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint));
    },
    async testPush() {
      return ((await invokeRecap(sb, { action: 'test' }, 'push', 'Phone notifications')) as { sent: number }).sent;
    },
    async setRsvp(leagueId, eventId, playerId, status) {
      check(
        await sb.from('event_rsvps').upsert(
          { event_id: eventId, player_id: playerId, league_id: leagueId, status, responded_by: await uid(), responded_at: new Date().toISOString() },
          { onConflict: 'event_id,player_id' },
        ),
      );
    },
    async subRequests(eventId) {
      const rows = check(
        await sb.from('sub_requests').select('id, tee_slot, spots, filled, closed_at, created_at, sub_offers(player_id, status)').eq('event_id', eventId).order('created_at'),
      ) as Row[];
      return rows.map((r) => ({
        id: r.id, teeSlot: r.tee_slot, spots: r.spots, filled: r.filled, closed: !!r.closed_at,
        offers: ((r.sub_offers ?? []) as Row[]).map((o) => ({ playerId: o.player_id, status: o.status })),
      }));
    },
    async createSubRequest(leagueId, eventId, opts, askPlayerIds) {
      const r = check(
        await sb.from('sub_requests').insert({ league_id: leagueId, event_id: eventId, spots: opts.spots, tee_slot: opts.teeSlot, created_by: await uid() }).select('id').single(),
      ) as Row;
      if (askPlayerIds.length) check(await sb.from('sub_offers').insert(askPlayerIds.map((p) => ({ request_id: r.id, league_id: leagueId, player_id: p }))));
      return r.id;
    },
    async respondSubOffer(requestId, playerId, accept) {
      return check(await sb.rpc('respond_to_sub_offer', { p_request: requestId, p_player: playerId, p_accept: accept })) as SubOffer['status'];
    },
    async closeSubRequest(requestId) {
      check(await sb.from('sub_requests').update({ closed_at: new Date().toISOString() }).eq('id', requestId));
    },
    async teeSheet(eventId) {
      const [times, lineup, ev, vacated] = await Promise.all([
        sb.from('event_tee_times').select('slot, tee_time, captain_id').eq('event_id', eventId).order('slot'),
        sb.from('event_lineup').select('player_id, slot, looking, partner_id').eq('event_id', eventId),
        sb.from('events').select('season_id, custom_tee_times').eq('id', eventId).single(),
        sb.from('event_vacated').select('player_id, original_slot, reason').eq('event_id', eventId).order('created_at'),
      ]);
      const e = check(ev) as Row;
      const season = await sb.from('season_tee_times').select('slot', { count: 'exact', head: true }).eq('season_id', e.season_id);
      if (season.error) throw new Error(season.error.message);
      return {
        times: (check(times) as Row[]).map(teeTimeRow),
        lineup: (check(lineup) as Row[]).map((r) => ({ playerId: r.player_id, slot: r.slot, looking: r.looking, partnerId: r.partner_id })),
        custom: !!e.custom_tee_times,
        seasonTimes: season.count ?? 0,
        vacated: (check(vacated) as Row[]).map((r) => ({ playerId: r.player_id, slot: r.original_slot, reason: r.reason })),
      };
    },
    async setTeeTimes(eventId, times) {
      check(await sb.rpc('set_tee_times', { p_event: eventId, p_times: times.map((t) => ({ slot: t.slot, time: t.time, captainId: t.captainId })) }));
    },
    async seasonTeeTimes(seasonId) {
      return (check(await sb.from('season_tee_times').select('tee_time').eq('season_id', seasonId).order('slot')) as Row[]).map((r) => String(r.tee_time).slice(0, 5));
    },
    async setSeasonTeeTimes(seasonId, times) {
      check(await sb.rpc('set_season_tee_times', { p_season: seasonId, p_times: times }));
    },
    async useSeasonTeeTimes(eventId) {
      check(await sb.rpc('use_season_tee_times', { p_event: eventId }));
    },
    async lineupJoin(eventId, playerId, slot) {
      check(await sb.rpc('lineup_join', { p_event: eventId, p_player: playerId, p_slot: slot }));
    },
    async lineupLeave(eventId, playerId) {
      check(await sb.rpc('lineup_leave', { p_event: eventId, p_player: playerId }));
    },
    async lineupRestoreCaptain(eventId, playerId, slot) {
      check(await sb.rpc('lineup_restore_captain', { p_event: eventId, p_player: playerId, p_slot: slot }));
    },
    async lineupStatus(eventId, playerId, status, partnerId) {
      check(await sb.rpc('lineup_status', { p_event: eventId, p_player: playerId, p_status: status, p_partner: partnerId ?? null }));
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

    async setupRequests(leagueId) {
      const rows = check(await sb.from('setup_requests').select('*').eq('league_id', leagueId).order('created_at', { ascending: false })) as Row[];
      return rows.map(toSetupRequest);
    },
    async uploadSetupFile(leagueId, file) {
      // Keep the name readable but safe for a storage path.
      const clean = file.name.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80) || 'file';
      const path = `${leagueId}/${randomToken().slice(0, 10)}-${clean}`;
      const up = await sb.storage.from(SETUP_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) {
        const m = up.error.message;
        throw new Error(/row-level security|Unauthorized|403/i.test(m) ? 'plan_feature: We set up your league needs GolfScoreHQ Pro'
          : /mime|type/i.test(m) ? `${file.name}: that kind of file can't be uploaded. Try a spreadsheet, CSV, PDF or photo.`
          : /size|large/i.test(m) ? `${file.name} is over 20 MB.` : m);
      }
      return { path, name: file.name, size: file.size };
    },
    async removeSetupFile(path) {
      await sb.storage.from(SETUP_BUCKET).remove([path]);
    },
    async createSetupRequest(leagueId, r) {
      const { data: u } = await sb.auth.getUser();
      const row = check(await sb.from('setup_requests').insert({
        league_id: leagueId, requested_by: u.user?.id, notes: r.notes.trim() || null, wants: r.wants, files: r.files,
        contact_phone: r.contactPhone?.trim() || null, staff_access: r.staffAccess,
      }).select('id').single()) as Row;
      return { id: row.id, emailError: await notifySupport(row.id) };
    },
    async updateSetupRequest(id, patch) {
      check(await sb.from('setup_requests').update({ notes: patch.notes.trim() || null, files: patch.files, status: 'requested' }).eq('id', id));
      return { emailError: await notifySupport(id) };
    },
    async setupFileUrl(path) {
      const { data, error } = await sb.storage.from(SETUP_BUCKET).createSignedUrl(path, 3600);
      if (error || !data) throw new Error("That file couldn't be opened.");
      return data.signedUrl;
    },
    async isStaff() {
      const { data } = await sb.rpc('is_staff');
      return data === true;
    },
    async pilotCodeStatus(code) {
      return check(await sb.rpc('pilot_code_status', { p_code: code })) as PilotCodeStatus;
    },
    async createPilotLeague(code, name, slug) {
      return check(await sb.rpc('create_pilot_league', { p_code: code, p_name: name, p_slug: slug })) as string;
    },
    async redeemPilotCode(code, leagueId) {
      check(await sb.rpc('redeem_pilot_code', { p_code: code, p_league: leagueId }));
    },
    async staffPilotCodes() {
      return check(await sb.rpc('staff_pilot_codes')) as PilotCode[];
    },
    async createPilotCode(note, maxUses) {
      return check(await sb.rpc('create_pilot_code', { p_note: note, p_max_uses: maxUses })) as string;
    },
    async revokePilotCode(code) {
      check(await sb.rpc('revoke_pilot_code', { p_code: code }));
    },
    async staffCourses() {
      return check(await sb.rpc('staff_courses')) as StaffCourse[];
    },
    async staffCreateCourse(name, managerEmail) {
      return check(await sb.rpc('staff_create_course', { p_name: name, p_owner_email: managerEmail })) as string;
    },
    async staffSetCourseLeague(clubId, slug, on) {
      check(await sb.rpc('staff_set_course_league', { p_club: clubId, p_slug: slug, p_on: on }));
    },
    async courseInvoice(clubId, o) {
      return (await invokeFn(sb, 'billing', { action: 'course-invoice', clubId, ...o }, "Invoices aren't available right now. Try again in a minute.")) as CourseInvoice;
    },
    async courseInvoiceLink(clubId) {
      return (await invokeFn(sb, 'billing', { action: 'course-link', clubId }, "Invoices aren't available right now. Try again in a minute.")) as CourseInvoice;
    },
    async courseMarkPaid(clubId) {
      return (await invokeFn(sb, 'billing', { action: 'course-paid', clubId }, "Invoices aren't available right now. Try again in a minute.")) as CourseInvoice;
    },
    async courseReport(clubId) {
      return check(await sb.rpc('course_summary', { p_club: clubId })) as CourseReport;
    },
    async staffSetupQueue() {
      const rows = check(await sb.rpc('staff_setup_queue')) as Row[];
      return rows.map((r) => ({
        ...toSetupRequest(r),
        leagueName: r.league_name, leagueSlug: r.league_slug, leaguePlan: r.league_plan, requestedByEmail: r.requested_by_email ?? null, staffUserId: r.staff_user_id ?? null,
      }));
    },
    async staffJoinLeague(requestId) {
      return check(await sb.rpc('staff_join_league', { p_request: requestId })) as string;
    },
    async staffUpdateSetupRequest(requestId, status, reply) {
      check(await sb.rpc('staff_update_setup_request', { p_request: requestId, p_status: status, p_reply: reply }));
      await invokeFn(sb, 'setup-notify', { requestId, event: 'updated' }, "Saved, but the email to the commissioner didn't go out.");
    },
    watchLeague(leagueId, onChange) {
      const channel = sb.channel(`league-${leagueId}-${Math.random().toString(36).slice(2)}`);
      for (const table of ['hole_scores', 'rounds', 'ctp_reports', 'presses', 'events', 'event_tee_times', 'event_lineup', 'event_rsvps', 'event_vacated']) {
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

    async payHandles(leagueId) {
      const rows = check(await sb.from('player_pay_handles').select('player_id, venmo, paypal_me, zelle').eq('league_id', leagueId)) as Row[];
      return Object.fromEntries(rows.map((r) => [r.player_id, { venmo: r.venmo, paypalMe: r.paypal_me, zelle: r.zelle }]));
    },
    async savePayHandles(leagueId, playerId, h) {
      check(await sb.from('player_pay_handles').upsert({
        player_id: playerId, league_id: leagueId, venmo: h.venmo, paypal_me: h.paypalMe, zelle: h.zelle, updated_at: new Date().toISOString(),
      }));
    },
    async setMyGhin(playerId, ghin) {
      check(await sb.rpc('set_my_ghin', { p_player: playerId, p_ghin: ghin ?? '' }));
    },
    async setSeasonDues(seasonId, cents) {
      check(await sb.rpc('set_season_dues', { p_season: seasonId, p_cents: cents }));
    },
    async duesPaid(seasonId) {
      const rows = check(await sb.from('dues_payments').select('player_id, amount_cents, paid_at').eq('season_id', seasonId)) as Row[];
      return Object.fromEntries(rows.map((r) => [r.player_id, { amountCents: r.amount_cents, paidAt: r.paid_at }]));
    },
    async markDuesPaid(seasonId, playerId, paid) {
      check(await sb.rpc('mark_dues_paid', { p_season: seasonId, p_player: playerId, p_paid: paid }));
    },
    async payoutsPaid(eventId) {
      const rows = check(await sb.from('payouts_paid').select('player_id, amount_cents, paid_at').eq('event_id', eventId)) as Row[];
      return Object.fromEntries(rows.map((r) => [r.player_id, { amountCents: r.amount_cents, paidAt: r.paid_at }]));
    },
    async markPayoutPaid(eventId, playerId, amountCents, paid) {
      check(await sb.rpc('mark_payout_paid', { p_event: eventId, p_player: playerId, p_amount_cents: amountCents, p_paid: paid }));
    },

    async chipIn(leagueId, amountCents) {
      return check(await sb.rpc('say_would_chip_in', { p_league: leagueId, p_amount_cents: amountCents })) as number;
    },
    async takeBackChipIn(leagueId) {
      check(await sb.rpc('take_back_chip_in', { p_league: leagueId }));
    },
    async upgradeInterest(leagueId) {
      const r = check(await sb.rpc('upgrade_interest_summary', { p_league: leagueId })) as Row;
      return { count: r.count ?? 0, totalCents: r.total_cents ?? 0, mine: r.mine ?? null, names: r.names ?? [] };
    },

    async askHelp(messages, leagueSlug) {
      return (await invokeFn(sb, 'ask-help', { messages, leagueSlug }, "The helper isn't answering right now. Look through the questions above, or tap Send it to us.")) as { answer: string; id: string | null };
    },
    async rateHelpAnswer(id, helpful) {
      check(await sb.rpc('rate_help_answer', { p_id: id, p_helpful: helpful }));
    },
    async saveLessonProgress(p) {
      check(await sb.rpc('save_lesson_progress', {
        p_id: p.id, p_lesson: p.lessonId, p_steps: p.steps, p_reached: p.reached, p_finished: p.finished, p_missed: p.missed,
        p_right: p.right ?? null, p_total: p.total ?? null, p_feel: p.feel ?? null, p_idea: p.idea ?? null,
      }));
    },
    async myLessons() {
      return (check(await sb.rpc('my_lessons')) ?? {}) as LessonsDone;
    },
    async staffLessonResults(days) {
      return (check(await sb.rpc('staff_lesson_results', { p_days: days })) ?? []) as LessonResult[];
    },
    async staffHelpQuestions(days) {
      const rows = (check(await sb.rpc('staff_help_questions', { p_days: days })) ?? []) as Row[];
      return rows.map((r) => ({
        id: r.id, question: r.question, answer: r.answer ?? null, turn: r.turn ?? 1, helpful: r.helpful ?? null,
        createdAt: r.created_at, email: r.email ?? null, leagueName: r.league_name ?? null,
      }));
    },

    async sendFeedback(kind, message, leagueSlug, path) {
      check(await sb.rpc('send_feedback', { p_kind: kind, p_message: message, p_league_slug: leagueSlug, p_path: path }));
    },
    async myFeedback() {
      return ((check(await sb.rpc('my_feedback')) ?? []) as Row[]).map(toFeedback);
    },
    async staffFeedback(days) {
      return ((check(await sb.rpc('staff_feedback', { p_days: days })) ?? []) as Row[]).map(toFeedback);
    },
    async staffAnswerFeedback(id, status, reply) {
      check(await sb.rpc('staff_answer_feedback', { p_id: id, p_status: status, p_reply: reply }));
    },

    async logAppError(r) {
      // Reporting a problem must never cause one.
      await sb.rpc('log_app_error', {
        p_kind: r.kind, p_message: r.message, p_detail: r.detail ?? null, p_path: r.path ?? null,
        p_version: r.appVersion ?? null, p_user_agent: r.userAgent ?? null, p_league_slug: r.leagueSlug ?? null,
      }).then(() => undefined, () => undefined);
    },
    async heartbeat() {
      await sb.rpc('app_heartbeat').then(() => undefined, () => undefined);
    },
    async staffHealth(days) {
      return check(await sb.rpc('staff_health', { p_days: days })) as HealthSnapshot;
    },
    async staffResolveError(fingerprint) {
      check(await sb.rpc('staff_resolve_error', { p_fingerprint: fingerprint }));
    },
    async staffSetLimit(key, value) {
      check(await sb.rpc('staff_set_limit', { p_key: key, p_value: value }));
    },
  };
}

const ROUND_SELECT =
  'id, event_id, tee_slot, status, current_hole, submitted_at, round_players(player_id, side, position, course_handicap), hole_scores(player_id, hole_number, strokes), presses(id, start_hole_number, called_by, created_at), ctp_reports(hole_number, player_id, beat_player_id)';

function toSeason(r: Row): Season {
  return { id: r.id, leagueId: r.league_id, year: r.year, name: r.name, rules: r.rules, startDate: r.start_date, leagueDay: r.league_day, duesCents: r.dues_cents ?? null };
}

function teeTimeRow(r: Row): TeeTime {
  return { slot: r.slot, time: r.tee_time ? String(r.tee_time).slice(0, 5) : null, captainId: r.captain_id };
}

function toEvent(r: Row): LeagueEvent {
  return { id: r.id, seasonId: r.season_id, weekNumber: r.week_number, eventDate: r.event_date, layoutId: r.layout_id, status: r.status, rulesOverride: r.rules_override ?? null };
}

function toRound(r: Row): RoundData {
  const scores: RoundData['scores'] = {};
  for (const s of (r.hole_scores ?? []) as Row[]) (scores[s.player_id] ??= {})[s.hole_number] = s.strokes;
  const ctp: RoundData['ctp'] = {};
  for (const c of (r.ctp_reports ?? []) as Row[]) ctp[c.hole_number] = { playerId: c.player_id, beat: c.beat_player_id };
  return {
    id: r.id, eventId: r.event_id, teeSlot: r.tee_slot, status: r.status, currentHole: r.current_hole, submittedAt: r.submitted_at,
    players: ((r.round_players ?? []) as Row[]).map((p) => ({ playerId: p.player_id, side: p.side, position: p.position, courseHandicap: p.course_handicap ?? null })).sort((a, b) => a.position - b.position),
    scores,
    presses: ((r.presses ?? []) as Row[])
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((p) => ({ id: p.id, startHole: p.start_hole_number, calledBy: p.called_by })),
    ctp,
  };
}

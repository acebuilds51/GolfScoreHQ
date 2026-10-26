import type { CourseSummary, LookupCourse } from '../../../../supabase/functions/course-lookup/normalize';
import type {
  Contact, Course, CtpEntry, JoinRequest, League, LeagueEvent, LeagueSummary, LedgerRow, Member, NewCourse, NewPlayer, Player, Role,
  PaymentHandles, RecapPreview, RoundData, RoundPlayer, RsvpStatus, ScoreEntry, Season, SubOffer, SubRequest, TvDisplay, TvFeed, TvSettings, User,
} from './types';

export type { CourseSummary, LookupCourse, LookupTee } from '../../../../supabase/functions/course-lookup/normalize';

/**
 * Everything the screens need from the backend. Two implementations:
 * Supabase (real accounts and data, with the database's access rules) and
 * demo (kept in this browser, for building and for trying the app out).
 */
export interface Api {
  mode: 'supabase' | 'demo';

  currentUser(): Promise<User | null>;
  onAuthChange(cb: (user: User | null) => void): () => void;
  /** Email a sign-in link (Supabase) or sign in immediately (demo). */
  signIn(email: string, redirectTo: string): Promise<'link-sent' | 'signed-in'>;
  signOut(): Promise<void>;

  myLeagues(): Promise<LeagueSummary[]>;
  createLeague(name: string, slug: string): Promise<string>;
  league(slug: string): Promise<League | null>;
  updateLeague(id: string, patch: { name?: string; joinCode?: string | null; timezone?: string }): Promise<void>;

  players(leagueId: string): Promise<Player[]>;
  contacts(leagueId: string): Promise<Record<string, Contact>>;
  addPlayers(leagueId: string, players: NewPlayer[]): Promise<void>;
  updatePlayer(id: string, patch: { displayName?: string; isSub?: boolean; active?: boolean }): Promise<void>;
  saveContact(leagueId: string, playerId: string, contact: Contact): Promise<void>;

  /** Returns the raw token for the invite link; only its hash is stored. */
  createInvite(leagueId: string, opts: { playerId?: string; email?: string; role?: Role }): Promise<string>;
  acceptInvite(token: string): Promise<string>;
  requestToJoin(code: string, name: string, message?: string): Promise<void>;
  joinRequests(leagueId: string): Promise<JoinRequest[]>;
  decideJoinRequest(leagueId: string, userId: string, approve: boolean): Promise<void>;
  members(leagueId: string): Promise<Member[]>;
  setMemberRole(leagueId: string, userId: string, role: Role): Promise<void>;

  /** Course lookup (GolfCourseAPI through the course-lookup server function). */
  searchCourses(query: string): Promise<CourseSummary[]>;
  lookupCourse(id: string): Promise<LookupCourse>;

  courses(leagueId: string): Promise<Course[]>;
  createCourse(leagueId: string, course: NewCourse): Promise<string>;
  deleteCourse(courseId: string): Promise<void>;

  seasons(leagueId: string): Promise<Season[]>;
  createSeason(leagueId: string, season: Omit<Season, 'id' | 'leagueId'>): Promise<string>;
  updateSeasonRules(seasonId: string, rules: Season['rules']): Promise<void>;
  events(seasonId: string): Promise<LeagueEvent[]>;
  event(eventId: string): Promise<LeagueEvent | null>;
  createEvent(leagueId: string, seasonId: string, e: { weekNumber: number; eventDate: string | null; layoutId: string | null }): Promise<string>;
  updateEvent(eventId: string, patch: { layoutId?: string | null; eventDate?: string | null; status?: LeagueEvent['status'] }): Promise<void>;

  eventRounds(eventId: string): Promise<RoundData[]>;
  round(roundId: string): Promise<RoundData | null>;
  startRound(leagueId: string, eventId: string, teeSlot: number, players: RoundPlayer[]): Promise<string>;
  saveScores(leagueId: string, roundId: string, entries: ScoreEntry[]): Promise<void>;
  /** 0-based position of the hole the group is on, so others can follow along. */
  setCurrentHole(roundId: string, holeIndex: number): Promise<void>;
  saveCtp(leagueId: string, roundId: string, holeNumber: number, entry: CtpEntry): Promise<void>;
  addPress(leagueId: string, roundId: string, startHole: number, calledBy: 'A' | 'B'): Promise<string>;
  removePress(pressId: string): Promise<void>;
  submitRound(roundId: string): Promise<void>;
  /** Add a sub/guest to the roster from the first tee (any member). */
  addSub(leagueId: string, name: string): Promise<string>;

  /**
   * Call `onChange` whenever scoring data in the league changes (scores,
   * rounds, CTP, presses, week status). Returns an unsubscribe function.
   */
  watchLeague(leagueId: string, onChange: () => void): () => void;

  /** Weekly recap email (Pro): preview who gets it, then send. */
  recapPreview(eventId: string, story?: string | null): Promise<RecapPreview>;
  /** AI-drafted opening paragraph for the commissioner to review and edit. */
  draftRecapStory(eventId: string): Promise<string>;
  /** Throws Error('already_sent') if the week was already emailed and `force` isn't set. */
  sendRecap(eventId: string, opts?: { force?: boolean; story?: string | null }): Promise<{ sent: number; missing: string[] }>;
  /** Golfer's own setting: email me the weekly recap (default on). */
  recapPref(playerId: string): Promise<boolean>;
  setRecapPref(leagueId: string, playerId: string, on: boolean): Promise<void>;
  /** Where golfers pay the commissioner (shown in recap emails). */
  paymentHandles(leagueId: string): Promise<PaymentHandles>;
  savePaymentHandles(leagueId: string, h: PaymentHandles): Promise<void>;

  /** RSVP (Pro): playerId → answer for the week. */
  rsvps(eventId: string): Promise<Record<string, RsvpStatus>>;
  setRsvp(leagueId: string, eventId: string, playerId: string, status: RsvpStatus): Promise<void>;
  /** Sub finder (Pro). */
  subRequests(eventId: string): Promise<SubRequest[]>;
  createSubRequest(leagueId: string, eventId: string, opts: { spots: number; teeSlot: number | null }, askPlayerIds: string[]): Promise<string>;
  respondSubOffer(requestId: string, playerId: string, accept: boolean): Promise<SubOffer['status']>;
  closeSubRequest(requestId: string): Promise<void>;

  /** Clubhouse TV links (commissioners, Pro). */
  tvDisplays(leagueId: string): Promise<TvDisplay[]>;
  /** Returns the raw token for the TV link; only its hash is stored. */
  createTvDisplay(leagueId: string, name: string, settings: TvSettings): Promise<string>;
  updateTvDisplay(id: string, patch: { name?: string; settings?: TvSettings }): Promise<void>;
  revokeTvDisplay(id: string): Promise<void>;
  /** What a TV link shows. Works without signing in. null = unknown or turned-off link. */
  tvFeed(token: string): Promise<TvFeed | null>;

  ledger(eventId: string): Promise<LedgerRow[]>;
  /** Every round and money entry in a season, for standings. */
  seasonRounds(seasonId: string): Promise<RoundData[]>;
  seasonLedger(seasonId: string): Promise<(LedgerRow & { eventId: string })[]>;
  /** Commissioner posts the week's money and marks it final. */
  settleEvent(eventId: string, entries: LedgerRow[]): Promise<void>;
  reopenEvent(eventId: string): Promise<void>;
  /** holeNumber → playerId the commissioner picked for a disputed CTP. */
  ctpDecisions(eventId: string): Promise<Record<number, string>>;
  setCtpDecision(leagueId: string, eventId: string, holeNumber: number, playerId: string | null): Promise<void>;
}

/** Turn database errors into sentences a commissioner can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/plan_feature: (.*)/.test(msg)) return msg.replace(/.*plan_feature: /, '') + '.';
  if (/plan_limit: (.*)/.test(msg)) return msg.replace(/.*plan_limit: /, '').replace(/^\w/, (c) => c.toUpperCase()) + '.';
  if (/leagues_slug_key|duplicate key.*slug/.test(msg)) return 'That web address is taken. Try another.';
  if (/leagues_join_code_key|duplicate key.*join_code/.test(msg)) return 'That join code is taken. Try another.';
  if (/row-level security|permission denied/.test(msg)) return "You don't have permission to do that.";
  if (msg === 'already_sent') return 'This week was already emailed.';
  if (/commissioners only/.test(msg)) return 'Only commissioners can do that.';
  if (/not in this week/.test(msg)) return "The results include a golfer who isn't in this week. Refresh and try again.";
  if (/invalid or expired/.test(msg)) return 'This invite link is invalid or has expired. Ask your commissioner for a new one.';
  if (/no league with that code/.test(msg)) return 'No league uses that code. Check it with your commissioner.';
  return msg || 'Something went wrong. Try again.';
}

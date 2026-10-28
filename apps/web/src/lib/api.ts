import type { CourseSummary, LookupCourse } from '../../../../supabase/functions/course-lookup/normalize';
import type { HealthSnapshot } from '../../../../supabase/functions/health-report/report';
import type {
  AppErrorReport,
  Club, LeagueBilling,
  Contact, Course, CtpEntry, JoinRequest, League, LeagueEvent, LeagueSummary, LedgerRow, Member, NewCourse, NewPlayer, Player, Role,
  PaymentHandles, RecapPreview, RoundData, RoundPlayer, RsvpStatus, ScoreEntry, Season, SubOffer, SubRequest, TvDisplay, TvFeed, TvSettings, User,
  NewSetupRequest, SetupFile, SetupRequest, SetupStatus, StaffSetupRequest, LineupStatus, TeeSheet, TeeTime, ReminderPreview, RsvpLinkInfo, PilotCode, PilotCodeStatus,
} from './types';

export type { CourseSummary, LookupCourse, LookupTee } from '../../../../supabase/functions/course-lookup/normalize';
export type { ErrorGroup, HealthSnapshot } from '../../../../supabase/functions/health-report/report';

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
  /**
   * Finish signing in with the code from the email. Needed for the iPhone home-screen
   * app, which can't receive the emailed link (iOS opens links in Safari).
   */
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;

  myLeagues(): Promise<LeagueSummary[]>;
  createLeague(name: string, slug: string): Promise<string>;
  league(slug: string): Promise<League | null>;
  updateLeague(id: string, patch: { name?: string; joinCode?: string | null; timezone?: string; brandColor?: string | null; accentColor?: string | null; sharePhones?: boolean; shareEmails?: boolean; showMoney?: boolean; rsvpReminderDays?: number | null }): Promise<void>;
  /** playerId → phone, for texting from the app: commissioners always; golfers when the league shares phone numbers. */
  phoneBook(leagueId: string): Promise<Record<string, string>>;
  /** playerId → email: commissioners always; golfers when the league shares emails. */
  emailBook(leagueId: string): Promise<Record<string, string>>;
  /** Branding (Pro): upload an already-resized PNG as the league logo. Returns its URL. */
  uploadLogo(leagueId: string, png: Blob): Promise<string>;
  removeLogo(leagueId: string): Promise<void>;
  /** Branding (Pro): course photo banner, already resized to a JPEG. */
  uploadBanner(leagueId: string, jpeg: Blob): Promise<string>;
  removeBanner(leagueId: string): Promise<void>;

  players(leagueId: string): Promise<Player[]>;
  contacts(leagueId: string): Promise<Record<string, Contact>>;
  addPlayers(leagueId: string, players: NewPlayer[]): Promise<void>;
  updatePlayer(id: string, patch: { displayName?: string; isSub?: boolean; active?: boolean; handicapIndex?: number | null; ghinNumber?: string | null }): Promise<void>;
  /** Same golfer on the roster twice: move everything from dropId onto keepId, then remove dropId. */
  mergePlayers(keepId: string, dropId: string): Promise<void>;
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
  updateEvent(eventId: string, patch: { layoutId?: string | null; eventDate?: string | null; status?: LeagueEvent['status']; rulesOverride?: LeagueEvent['rulesOverride'] }): Promise<void>;

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

  /** Billing. Checkout and the billing page are hosted by Stripe; these return the page to open. */
  leagueBilling(leagueId: string): Promise<LeagueBilling | null>;
  startCheckout(target: { leagueId: string } | { clubId: string }): Promise<string>;
  billingPortal(returnPath: string): Promise<string>;
  /** Clubs you own (one Club plan covers up to 5 of your leagues). */
  myClubs(): Promise<Club[]>;
  createClub(name: string): Promise<string>;
  /** Put one of your leagues under your paid club, or take it out (clubId null). */
  setLeagueClub(leagueId: string, clubId: string | null): Promise<void>;

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
  /** "Are you playing?" reminder email (Pro): who'd get it for this week now. */
  reminderPreview(eventId: string): Promise<ReminderPreview>;
  /** Commissioner: send this week's reminder email now. */
  sendReminder(eventId: string): Promise<{ sent: number }>;
  /** One-tap answer from a reminder email, no sign-in: 'in', 'out', 'stop' (no more reminders), or null to look. Null for a bad link. */
  rsvpByLink(token: string, answer: 'in' | 'out' | 'stop' | null): Promise<RsvpLinkInfo | null>;
  /** Phone notifications: the public key phones subscribe with (null: not set up). */
  pushKey(): Promise<string | null>;
  /** Save this phone so the signed-in person gets notifications on it. */
  savePushDevice(device: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  removePushDevice(endpoint: string): Promise<void>;
  /** A test notification to the signed-in person's devices; how many got it. */
  testPush(): Promise<number>;
  /** Sub finder (Pro). */
  subRequests(eventId: string): Promise<SubRequest[]>;
  createSubRequest(leagueId: string, eventId: string, opts: { spots: number; teeSlot: number | null }, askPlayerIds: string[]): Promise<string>;
  respondSubOffer(requestId: string, playerId: string, accept: boolean): Promise<SubOffer['status']>;
  closeSubRequest(requestId: string): Promise<void>;

  /** Tee sheet (Pro): the week's tee times, captains, groups and who's looking. */
  teeSheet(eventId: string): Promise<TeeSheet>;
  /** Commissioner: replace the week's tee times and captains. */
  setTeeTimes(eventId: string, times: TeeTime[]): Promise<void>;
  /** The season's tee times ("17:10", …, tee time 1 first); every upcoming week gets them. */
  seasonTeeTimes(seasonId: string): Promise<string[]>;
  /** Commissioner: set the season's tee times (updates the upcoming weeks not changed on their own). */
  setSeasonTeeTimes(seasonId: string, times: string[]): Promise<void>;
  /** Commissioner: put a week changed on its own back on the season's tee times. */
  useSeasonTeeTimes(eventId: string): Promise<void>;
  /** Put a golfer in a tee time's group (yourself, or anyone into a group you captain; commissioners anyone). */
  lineupJoin(eventId: string, playerId: string, slot: number): Promise<void>;
  /** Out of their group. A captain can't (the commissioner can take one out: they give up the tee time). */
  lineupLeave(eventId: string, playerId: string): Promise<void>;
  /** Commissioner: put a captain in at a tee time; the groups from there move down one. */
  lineupRestoreCaptain(eventId: string, playerId: string, slot: number): Promise<void>;
  /** A golfer's own status (or the commissioner's say): needs a partner, needs a match with a partner, not playing, or clear. */
  lineupStatus(eventId: string, playerId: string, status: LineupStatus, partnerId?: string | null): Promise<void>;

  /** Clubhouse TV links (commissioners, Pro). */
  tvDisplays(leagueId: string): Promise<TvDisplay[]>;
  /** Returns the raw token for the TV link; only its hash is stored. */
  createTvDisplay(leagueId: string, name: string, settings: TvSettings): Promise<string>;
  updateTvDisplay(id: string, patch: { name?: string; settings?: TvSettings }): Promise<void>;
  revokeTvDisplay(id: string): Promise<void>;
  /** What a TV link shows. Works without signing in. null = unknown or turned-off link. */
  tvFeed(token: string): Promise<TvFeed | null>;

  /** "We set up your league" (Pro): the league's requests, newest first. */
  setupRequests(leagueId: string): Promise<SetupRequest[]>;
  /** Upload one file for a request (before sending it). */
  uploadSetupFile(leagueId: string, file: File): Promise<SetupFile>;
  removeSetupFile(path: string): Promise<void>;
  /** Sends the request and emails GolfScoreHQ support. emailError: the request is saved but the email didn't go out (why). */
  createSetupRequest(leagueId: string, r: NewSetupRequest): Promise<{ id: string; emailError: string | null }>;
  /** Add notes or files to an open request (e.g. answering staff's question); puts it back in the queue. */
  updateSetupRequest(id: string, patch: { notes: string; files: SetupFile[] }): Promise<{ emailError: string | null }>;
  /** A short-lived download link for an uploaded file. */
  setupFileUrl(path: string): Promise<string>;

  /** GolfScoreHQ staff only. */
  isStaff(): Promise<boolean>;
  staffSetupQueue(): Promise<StaffSetupRequest[]>;
  /** Pilot sign-up: is this code good (anyone, signed in or not). */
  pilotCodeStatus(code: string): Promise<PilotCodeStatus>;
  /** A new league on the pilot plan; returns its id. */
  createPilotLeague(code: string, name: string, slug: string): Promise<string>;
  /** An existing free league joins the pilot (its commissioner). */
  redeemPilotCode(code: string, leagueId: string): Promise<void>;
  /** Staff: pilot codes, making one, ending one. */
  staffPilotCodes(): Promise<PilotCode[]>;
  createPilotCode(note: string, maxUses: number): Promise<string>;
  revokePilotCode(code: string): Promise<void>;
  /** Join the request's league as a commissioner (with the commissioner's consent); returns its slug. */
  staffJoinLeague(requestId: string): Promise<string>;
  /** Change status and reply; emails the commissioner. 'done' removes staff's access to the league. */
  staffUpdateSetupRequest(requestId: string, status: SetupStatus, reply: string): Promise<void>;

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

  /** Diagnostics: the app reports a crash, a failed action, or a golfer's "Report a problem" note. Never throws. */
  logAppError(report: AppErrorReport): Promise<void>;
  /** "I have the app open" (every 2 minutes while it's on screen), for counting people online. */
  heartbeat(): Promise<void>;
  /** Staff: errors, failed timers and calls, and capacity against plan limits. */
  staffHealth(days: number): Promise<HealthSnapshot>;
  staffResolveError(fingerprint: string): Promise<void>;
  staffSetLimit(key: string, value: number): Promise<void>;
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

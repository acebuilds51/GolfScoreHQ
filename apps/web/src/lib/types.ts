export type Role = 'owner' | 'commissioner' | 'scorer' | 'player';
export type Plan = 'free' | 'pro' | 'club' | 'pilot' | 'comp';

export interface User {
  id: string;
  email: string;
}

export interface LeagueSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  plan: Plan;
}

export interface League extends LeagueSummary {
  joinCode: string | null;
  timezone: string;
  /** Plan after expiry is taken into account (a lapsed Pro league acts as Free). */
  effectivePlan: Plan;
  features: string[];
  /** Branding (Pro): logo picture and two colors as #rrggbb. */
  logoUrl: string | null;
  /** Course photo behind the league name. */
  bannerUrl: string | null;
  brandColor: string | null;
  accentColor: string | null;
  /** Golfers can see each other's phone numbers (to text from the roster). Commissioners always can. */
  sharePhones?: boolean;
  /** Golfers can see each other's emails on the roster. Commissioners always can. */
  shareEmails?: boolean;
  /** Golfers see season money (Standings, player pages, awards, the recap's season line). Commissioners always do. */
  showMoney?: boolean;
  /**
   * Who handles match and press money: 'golfers' settle it among themselves (the
   * app only shows what each won or lost), or 'commissioner' with the side games.
   */
  matchMoney?: MatchMoney;
  /** "Are you playing?" email this many days before league night (Pro); null: off. */
  rsvpReminderDays?: number | null;
}

export interface ReminderPreview {
  /** Golfers who'd get the email now (haven't answered, not on the tee sheet, have an email). */
  recipients: number;
  /** Golfers who'd get it but have no email on file. */
  missing: string[];
  alreadySent: { sent_at: string; recipients: number } | null;
}

/** What a one-tap answer link from a reminder email shows. */
export interface RsvpLinkInfo {
  leagueName: string;
  leagueSlug: string;
  eventId: string;
  weekNumber: number;
  eventDate: string | null;
  playerName: string;
  status: RsvpStatus | null;
  /** The week hasn't started, so answers still count. */
  open: boolean;
  remindersOff: boolean;
}

export interface Player {
  id: string;
  displayName: string;
  isSub: boolean;
  active: boolean;
  /** Set once a golfer has claimed this roster spot with an account. */
  userId: string | null;
  /** Handicap Index entered by the commissioner (usually from GHIN). */
  handicapIndex: number | null;
  ghinNumber: string | null;
  handicapIndexUpdatedAt: string | null;
}

export interface Contact {
  email: string | null;
  phone: string | null;
}

export interface NewPlayer {
  displayName: string;
  isSub: boolean;
  email?: string;
  phone?: string;
}

export interface JoinRequest {
  userId: string;
  email: string | null;
  name: string | null;
  message: string | null;
  createdAt: string;
}

export interface Member {
  userId: string;
  role: Role;
  /** Name of the roster spot this member claimed, if any. */
  playerName: string | null;
}

export interface Hole {
  number: number;
  par: number;
  strokeIndex?: number;
}

export interface Layout {
  id: string;
  name: string;
  tees: string | null;
  holes: Hole[];
  rating: number | null;
  slope: number | null;
}

export interface Course {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  /** null = shared catalog course */
  leagueId: string | null;
  layouts: Layout[];
}

export interface NewCourse {
  name: string;
  city?: string;
  state?: string;
  layouts: Omit<Layout, 'id'>[];
  /** Set when the course was filled in from the course lookup. */
  source?: { provider: 'golfcourseapi'; id: string };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface Season {
  id: string;
  leagueId: string;
  year: number;
  name: string;
  /** Engine FormatRules (frozen for the season). */
  rules: import('@golfscorehq/engine').FormatRules;
  startDate: string | null;
  /** 0 = Sunday … 6 = Saturday */
  leagueDay: number | null;
  /** What each golfer pays the commissioner up front for the season (e.g. skins and CTP money); null: no dues. */
  duesCents?: number | null;
}

export type MatchMoney = 'golfers' | 'commissioner';

/** A golfer's own Venmo / PayPal / Zelle, so the commissioner can pay them. */
export interface PayHandles {
  venmo: string | null;
  paypalMe: string | null;
  zelle: string | null;
}

/** Ticked off by the commissioner: season dues received, or a week's winnings paid (negative: collected). */
export interface PaidMark {
  amountCents: number;
  paidAt: string;
}

export type EventStatus = 'scheduled' | 'in_progress' | 'settled' | 'rainout';

export interface LeagueEvent {
  id: string;
  seasonId: string;
  weekNumber: number;
  eventDate: string | null;
  layoutId: string | null;
  status: EventStatus;
  /** A special week (e.g. the scramble) played under different rules; null = the season's rules. */
  rulesOverride?: import('@golfscorehq/engine').FormatRules | null;
}

export interface RoundPlayer {
  playerId: string;
  /** 'A' / 'B' match side; null = skins and CTP only. */
  side: 'A' | 'B' | null;
  position: number;
  /** Course Handicap fixed when the group started (null = no handicap / plays gross). */
  courseHandicap?: number | null;
}

export interface CtpEntry {
  /** null = nobody in this group got inside the marker. */
  playerId: string | null;
  /** Whose ball they got inside of; null = there was no marker yet. */
  beat: string | null;
}

export interface Press {
  id: string;
  startHole: number;
  calledBy: 'A' | 'B';
}

export interface RoundData {
  id: string;
  eventId: string;
  teeSlot: number;
  status: 'live' | 'submitted';
  currentHole: number;
  players: RoundPlayer[];
  /** playerId → holeNumber → strokes */
  scores: Record<string, Record<number, number>>;
  presses: Press[];
  /** holeNumber → what this group reported */
  ctp: Record<number, CtpEntry>;
  submittedAt: string | null;
}

/** A league's plan and billing, as its Settings page shows it. */
export interface LeagueBilling {
  plan: Plan;
  effectivePlan: Plan;
  /** When Pro/Club features switch off unless renewed (null = no end date). */
  expiresAt: string | null;
  clubName: string | null;
  isOwner: boolean;
  subscription: { status: string; renewsAt: string | null; cancelAtPeriodEnd: boolean; paidByMe: boolean } | null;
}

export interface Club {
  id: string;
  name: string;
  /** Paid through (plus a few days' grace); null = not paid yet. */
  expiresAt: string | null;
  leagues: { id: string; name: string; slug: string }[];
}

/** Staff's view of a course on the Course plan. */
export interface StaffCourse extends Club {
  createdAt: string;
  ownerEmail: string | null;
  /** The course's Stripe invoice subscription, null until it's invoiced. */
  billing: { status: string; periodEnd: string | null } | null;
}

/** A course's Stripe invoice: the page where they pay it, and where it stands. */
export interface CourseInvoice {
  url: string | null;
  /** draft, open, paid, void or uncollectible */
  status: string;
  amountDue: number;
  dueDate: string | null;
  /** While the course is in its free period: when the first invoice goes out. */
  freeUntil: string | null;
}

/** The course summary: each league at the course this season. */
export interface CourseReport {
  id: string;
  name: string;
  expiresAt: string | null;
  leagues: {
    id: string; name: string; slug: string;
    /** Active regulars, active subs, and golfers using the app. */
    golfers: number; subs: number; onApp: number;
    season: string | null;
    weeksPlayed: number; weeksLeft: number;
    /** Golfer-rounds in settled weeks this season. */
    rounds: number;
    nextWeek: string | null; lastWeek: string | null;
  }[];
}

export interface RecapPreview {
  subject: string;
  /** A sample of what golfers receive. */
  text: string;
  recipients: number;
  /** Golfers with no email on file. */
  missing: string[];
  alreadySent: { sent_at: string; recipients: number } | null;
}

export interface PaymentHandles {
  venmo: string | null;
  paypalMe: string | null;
  zelle: string | null;
}

export type RsvpStatus = 'in' | 'out' | 'maybe';

export interface SubOffer {
  playerId: string;
  status: 'offered' | 'accepted' | 'declined' | 'too_late';
}

export interface SubRequest {
  id: string;
  teeSlot: number | null;
  spots: number;
  filled: number;
  closed: boolean;
  offers: SubOffer[];
}

export type TvPanel = 'live' | 'matches' | 'skins' | 'ctp' | 'highlights' | 'standings';

export interface TvSettings {
  hideMoney: boolean;
  secondsPerPanel: number;
  panels: TvPanel[];
  /** Club plan: a sponsor's screen in the rotation and a line along the bottom. */
  sponsor?: TvSponsor | null;
}

export interface TvSponsor {
  name: string;
  message?: string | null;
  /** https:// link to the sponsor's logo. */
  logoUrl?: string | null;
}

export interface TvDisplay {
  id: string;
  name: string;
  settings: TvSettings;
  createdAt: string;
}

// ── Tee sheet ────────────────────────────────────────────────────────────────

export interface TeeTime {
  slot: number;
  /** "17:10", or null for no clock time. */
  time: string | null;
  captainId: string | null;
}

export interface LineupEntry {
  playerId: string;
  /** In this tee time's group. */
  slot: number | null;
  /** Not in a group yet: needs a partner, or needs a match together with partnerId. */
  looking: 'partner' | 'match' | null;
  partnerId: string | null;
}

export interface TeeSheet {
  times: TeeTime[];
  lineup: LineupEntry[];
  /** The week's tee times were changed on their own (season changes leave it alone). */
  custom: boolean;
  /** How many tee times the season has (0: none set for the season). */
  seasonTimes: number;
  /** Captains who gave up their tee time this week (slot: the one they had), and why. */
  vacated: { playerId: string; slot: number; reason: string }[];
}

export type LineupStatus = 'partner' | 'match' | 'out' | 'none';

// ── "We set up your league" ─────────────────────────────────────────────────

export type SetupStatus = 'requested' | 'in_progress' | 'needs_info' | 'done';
export type SetupWant = 'roster' | 'handicaps' | 'course' | 'history' | 'side_games';

export interface SetupFile {
  path: string;
  name: string;
  size: number;
}

export interface NewSetupRequest {
  notes: string;
  wants: SetupWant[];
  files: SetupFile[];
  contactPhone: string | null;
  /** The commissioner lets GolfScoreHQ support join the league as a commissioner until it's done. */
  staffAccess: boolean;
}

export interface SetupRequest extends NewSetupRequest {
  id: string;
  leagueId: string;
  status: SetupStatus;
  staffReply: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffSetupRequest extends SetupRequest {
  leagueName: string;
  leagueSlug: string;
  leaguePlan: string;
  requestedByEmail: string | null;
  /** Staff member who joined the league for this request. */
  staffUserId: string | null;
}

/** 'ok', 'used' (no uses left), 'ended' (revoked or past its date) or 'invalid'. */
export type PilotCodeStatus = 'ok' | 'used' | 'ended' | 'invalid';

/** A pilot sign-up code (staff), with the leagues that used it. */
export interface PilotCode {
  code: string;
  note: string | null;
  maxUses: number;
  uses: number;
  pilotUntil: string;
  createdAt: string;
  revokedAt: string | null;
  leagues: { id: string; name: string; slug: string }[];
}

/** Everything a Clubhouse TV shows, from tv_feed(). */
export interface TvFeed {
  error?: 'plan';
  league: { name: string; slug?: string; logoUrl?: string | null; brandColor?: string | null; accentColor?: string | null };
  display?: { name: string; settings: TvSettings };
  season?: { year: number; name: string; rules: import('@golfscorehq/engine').FormatRules } | null;
  event?: { id: string; weekNumber: number; eventDate: string | null; status: EventStatus; rulesOverride?: import('@golfscorehq/engine').FormatRules | null } | null;
  layout?: (Layout & { courseName: string | null }) | null;
  players?: { id: string; displayName: string; isSub: boolean }[];
  rounds?: RoundData[];
  standings?: { playerId: string; money: number; skins: number; ctps: number }[];
  generatedAt?: string;
}

export type LedgerKind = 'match' | 'press' | 'skin' | 'ctp' | 'scramblePot' | 'place';

export interface LedgerRow {
  playerId: string;
  roundId: string | null;
  kind: LedgerKind;
  amountCents: number;
  holeNumber: number | null;
}

export interface ScoreEntry {
  playerId: string;
  holeNumber: number;
  strokes: number;
}

/** Golfers who said they'd chip in for Pro. */
export interface UpgradeInterest {
  count: number;
  totalCents: number;
  /** What you offered, if you did. */
  mine: number | null;
  /** Who offered (commissioners only; empty for golfers). */
  names: string[];
}

/** A problem the app reports about itself, or a golfer's "Report a problem" note. */
export interface AppErrorReport {
  kind: 'error' | 'failed_action' | 'report';
  message: string;
  /** Stack trace, or the golfer's note. */
  detail?: string | null;
  path?: string | null;
  appVersion?: string | null;
  userAgent?: string | null;
  leagueSlug?: string | null;
}

/** One try at a lesson, saved as it goes. `reached` and `missed` are 0-based step numbers. */
export interface LessonProgress {
  id: string;
  lessonId: string;
  steps: number;
  reached: number;
  finished: boolean;
  missed: number[];
  right?: number | null;
  total?: number | null;
  feel?: 'easy' | 'ok' | 'hard' | null;
  idea?: string | null;
}

/** Finished lessons by id: the best score. */
export type LessonsDone = Record<string, { right: number; total: number; at: string }>;

/** A lesson try, for staff. `email` only comes with an idea (so staff can answer it). */
export interface LessonResult extends Omit<LessonProgress, 'id'> {
  signedIn: boolean;
  email: string | null;
  startedAt: string;
  updatedAt: string;
}

/** A question asked on the Help page and the answer it got (staff view). */
export interface HelpQuestion {
  id: string;
  question: string;
  /** Null: the helper couldn't answer. */
  answer: string | null;
  /** 1 = first question; more = a follow-up in the same conversation. */
  turn: number;
  helpful: boolean | null;
  createdAt: string;
  email: string | null;
  leagueName: string | null;
}

export type FeedbackKind = 'idea' | 'question';
export type FeedbackStatus = 'new' | 'planned' | 'done' | 'not_now' | 'answered';

/** An idea or a question someone sent GolfScoreHQ, and our reply. */
export interface Feedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  leagueName: string | null;
  /** Staff view only. */
  email?: string | null;
  path?: string | null;
}

export const COMMISSIONER_ROLES: Role[] = ['owner', 'commissioner'];
export const isCommissioner = (role: Role | undefined) => !!role && COMMISSIONER_ROLES.includes(role);

/** Season money is shown to commissioners always, and to golfers unless the league hides it. */
export const seesSeasonMoney = (league: Pick<League, 'role' | 'showMoney'>) => isCommissioner(league.role) || league.showMoney !== false;

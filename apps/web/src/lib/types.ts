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

export const COMMISSIONER_ROLES: Role[] = ['owner', 'commissioner'];
export const isCommissioner = (role: Role | undefined) => !!role && COMMISSIONER_ROLES.includes(role);

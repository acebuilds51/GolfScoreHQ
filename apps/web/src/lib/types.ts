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
}

export interface Player {
  id: string;
  displayName: string;
  isSub: boolean;
  active: boolean;
  /** Set once a golfer has claimed this roster spot with an account. */
  userId: string | null;
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
}

export interface RoundPlayer {
  playerId: string;
  /** 'A' / 'B' match side; null = skins and CTP only. */
  side: 'A' | 'B' | null;
  position: number;
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

export interface ScoreEntry {
  playerId: string;
  holeNumber: number;
  strokes: number;
}

export const COMMISSIONER_ROLES: Role[] = ['owner', 'commissioner'];
export const isCommissioner = (role: Role | undefined) => !!role && COMMISSIONER_ROLES.includes(role);

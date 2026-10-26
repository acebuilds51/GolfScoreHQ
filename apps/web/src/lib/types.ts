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
}

export const COMMISSIONER_ROLES: Role[] = ['owner', 'commissioner'];
export const isCommissioner = (role: Role | undefined) => !!role && COMMISSIONER_ROLES.includes(role);

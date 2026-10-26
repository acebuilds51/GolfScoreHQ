import type { CourseSummary, LookupCourse } from '../../../../supabase/functions/course-lookup/normalize';
import type { Contact, Course, JoinRequest, League, LeagueSummary, Member, NewCourse, NewPlayer, Player, Role, User } from './types';

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
}

/** Turn database errors into sentences a commissioner can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/plan_feature: (.*)/.test(msg)) return msg.replace(/.*plan_feature: /, '') + '.';
  if (/plan_limit: (.*)/.test(msg)) return msg.replace(/.*plan_limit: /, '').replace(/^\w/, (c) => c.toUpperCase()) + '.';
  if (/leagues_slug_key|duplicate key.*slug/.test(msg)) return 'That web address is taken. Try another.';
  if (/leagues_join_code_key|duplicate key.*join_code/.test(msg)) return 'That join code is taken. Try another.';
  if (/row-level security|permission denied/.test(msg)) return "You don't have permission to do that.";
  if (/invalid or expired/.test(msg)) return 'This invite link is invalid or has expired. Ask your commissioner for a new one.';
  if (/no league with that code/.test(msg)) return 'No league uses that code. Check it with your commissioner.';
  return msg || 'Something went wrong. Try again.';
}

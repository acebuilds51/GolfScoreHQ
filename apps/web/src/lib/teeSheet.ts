import type { Player, RsvpStatus, TeeSheet, TeeTime } from './types';

// The week's tee sheet as people read it, and who each "need a partner / need
// a match" text should go to. Pure: the screens and tests both use it.

export const GROUP_SIZE = 4;

export interface SheetGroup extends TeeTime {
  /** Player ids, captain first. */
  members: string[];
  open: number;
}

export interface SheetView {
  groups: SheetGroup[];
  /** Golfers looking for a partner. */
  needPartner: string[];
  /** Pairs looking for a match (each pair once). */
  teams: [string, string][];
  /** Said they're playing but aren't in a group or looking yet. */
  playingNoGroup: string[];
  out: string[];
  /** Regular members who haven't said anything this week. */
  noReply: string[];
  /** playerId → their tee time slot. */
  slotOf: Map<string, number>;
}

export function sheetView(sheet: TeeSheet, players: Player[], rsvps: Record<string, RsvpStatus>): SheetView {
  const active = players.filter((p) => p.active);
  const slotOf = new Map<string, number>();
  for (const l of sheet.lineup) if (l.slot !== null) slotOf.set(l.playerId, l.slot);
  const groups = [...sheet.times].sort((a, b) => a.slot - b.slot).map((t) => {
    const ids = sheet.lineup.filter((l) => l.slot === t.slot).map((l) => l.playerId);
    const members = t.captainId && ids.includes(t.captainId) ? [t.captainId, ...ids.filter((id) => id !== t.captainId)] : ids;
    return { ...t, members, open: Math.max(0, GROUP_SIZE - members.length) };
  });
  const needPartner = sheet.lineup.filter((l) => l.looking === 'partner').map((l) => l.playerId);
  const teams: [string, string][] = [];
  for (const l of sheet.lineup) {
    if (l.looking === 'match' && l.partnerId && !teams.some(([a, b]) => a === l.partnerId || b === l.partnerId)) teams.push([l.playerId, l.partnerId]);
  }
  const listed = new Set(sheet.lineup.map((l) => l.playerId));
  const out = active.filter((p) => rsvps[p.id] === 'out' && !listed.has(p.id)).map((p) => p.id);
  const playingNoGroup = active.filter((p) => !listed.has(p.id) && (rsvps[p.id] === 'in' || rsvps[p.id] === 'maybe')).map((p) => p.id);
  const noReply = active.filter((p) => !p.isSub && !listed.has(p.id) && !rsvps[p.id]).map((p) => p.id);
  return { groups, needPartner, teams, playingNoGroup, out, noReply, slotOf };
}

/**
 * "I need a partner": everyone who isn't already in a group or paired up, and
 * hasn't said they're out (subs included: they're who you'd ask).
 */
export function partnerRecipients(view: SheetView, players: Player[], me: string): string[] {
  const paired = new Set(view.teams.flat());
  const outs = new Set(view.out);
  return players
    .filter((p) => p.active && p.id !== me && !view.slotOf.has(p.id) && !paired.has(p.id) && !outs.has(p.id))
    .map((p) => p.id);
}

/**
 * "We need a match": groups that aren't full, golfers looking for a partner,
 * and other pairs looking for a match.
 */
export function matchRecipients(view: SheetView, me: string, partner: string | null): string[] {
  const ids = [
    ...view.groups.filter((g) => g.open > 0).flatMap((g) => g.members),
    ...view.needPartner,
    ...view.teams.flat(),
  ];
  return [...new Set(ids)].filter((id) => id !== me && id !== partner);
}

/**
 * "Our group has room": golfers looking for a partner, pairs looking for a
 * match, and golfers playing without a group yet.
 */
export function openSpotRecipients(view: SheetView, me: string): string[] {
  const ids = [...view.needPartner, ...view.teams.flat(), ...view.playingNoGroup];
  return [...new Set(ids)].filter((id) => id !== me && !view.slotOf.has(id));
}

/** "17:10" → "5:10 PM". */
export function fmtTeeTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Tee times from a first time, every few minutes: ("17:10", 7, 3) → ["17:10", "17:17", "17:24"]. */
export function teeTimesFrom(first: string, everyMinutes: number, count: number): string[] {
  const [h, m] = first.split(':').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const total = h * 60 + m + i * everyMinutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  });
}

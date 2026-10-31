import { friendlyError } from './api';
import { api } from './backend';
import { isNetworkError, sawNoSignal, sawSignal } from './offline';
import type { CtpEntry, RoundData, ScoreEntry } from './types';

// Writes a scorer makes on the course are queued here first, so a dropped
// connection never loses a score. Every write is an upsert, so replaying one
// that already landed is harmless, and only the newest value for each golfer
// and hole matters.
//
// Each round's queue remembers its league, so whatever is waiting is sent from
// any screen (or the next time the app opens), not only from the scoring screen.

export type PendingOp =
  | { kind: 'scores'; entries: ScoreEntry[] }
  | { kind: 'ctp'; holeNumber: number; entry: CtpEntry }
  | { kind: 'hole'; holeIndex: number }
  /** Submitted with no signal: goes in once every score has. */
  | { kind: 'submit' };

const PREFIX = 'gshq-pending-';
const key = (roundId: string) => `${PREFIX}${roundId}`;

interface Stored { leagueId: string | null; ops: PendingOp[] }

function readStored(roundId: string): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(key(roundId)) ?? '[]');
    // Saved before queues remembered their league: a plain list.
    return Array.isArray(v) ? { leagueId: null, ops: v } : { leagueId: v.leagueId ?? null, ops: v.ops ?? [] };
  } catch {
    return { leagueId: null, ops: [] };
  }
}

export function readQueue(roundId: string): PendingOp[] {
  return readStored(roundId).ops;
}

function writeQueue(leagueId: string, roundId: string, ops: PendingOp[]) {
  try {
    if (ops.length) localStorage.setItem(key(roundId), JSON.stringify({ leagueId, ops }));
    else localStorage.removeItem(key(roundId));
  } catch {
    /* storage blocked: the in-memory copy still retries while the page is open */
  }
  changed();
}

/**
 * Keep only the newest write for each golfer+hole, each CTP hole, and the
 * current hole. Scores for one hole go out together; a submit goes last.
 */
export function compact(ops: PendingOp[]): PendingOp[] {
  const scores = new Map<string, ScoreEntry>();
  const ctp = new Map<number, CtpEntry>();
  let hole: number | null = null;
  let submit = false;
  for (const op of ops) {
    if (op.kind === 'scores') for (const e of op.entries) scores.set(`${e.holeNumber}:${e.playerId}`, e);
    else if (op.kind === 'ctp') ctp.set(op.holeNumber, op.entry);
    else if (op.kind === 'hole') hole = op.holeIndex;
    else submit = true;
  }
  const byHole = new Map<number, ScoreEntry[]>();
  for (const e of scores.values()) byHole.set(e.holeNumber, [...(byHole.get(e.holeNumber) ?? []), e]);
  return [
    ...[...byHole.keys()].sort((a, b) => a - b).map((h) => ({ kind: 'scores' as const, entries: byHole.get(h)! })),
    ...[...ctp.keys()].sort((a, b) => a - b).map((h) => ({ kind: 'ctp' as const, holeNumber: h, entry: ctp.get(h)! })),
    ...(hole === null ? [] : [{ kind: 'hole' as const, holeIndex: hole }]),
    ...(submit ? [{ kind: 'submit' as const }] : []),
  ];
}

export function enqueue(leagueId: string, roundId: string, op: PendingOp, memory: PendingOp[]): PendingOp[] {
  const next = compact([...memory, op]);
  writeQueue(leagueId, roundId, next);
  return next;
}

/** Show what's waiting on this phone on top of what the server has, so nothing looks lost. */
export function applyQueue(round: RoundData, ops: PendingOp[]): RoundData {
  if (!ops.length) return round;
  const next: RoundData = { ...round, scores: { ...round.scores }, ctp: { ...round.ctp } };
  for (const op of ops) {
    if (op.kind === 'scores') for (const e of op.entries) next.scores[e.playerId] = { ...next.scores[e.playerId], [e.holeNumber]: e.strokes };
    else if (op.kind === 'ctp') next.ctp[op.holeNumber] = op.entry;
    else if (op.kind === 'hole') next.currentHole = op.holeIndex;
  }
  return next;
}

export const submitWaiting = (ops: PendingOp[]) => ops.some((o) => o.kind === 'submit');

export interface FlushResult {
  /** Writes still waiting. */
  left: PendingOp[];
  /** Why something didn't save: null if everything went, 'offline' for no connection, otherwise the server's reason. */
  problem: null | 'offline' | string;
  /** A waiting submit went in. */
  submitted: boolean;
}

/**
 * Send what's waiting. Each write goes on its own, so one that's refused
 * doesn't hold up the rest. Refused scores stay on the phone (never dropped)
 * and the reason is reported. A waiting submit goes in only after every score has.
 */
export async function flush(leagueId: string, roundId: string, ops: PendingOp[]): Promise<FlushResult> {
  const left: PendingOp[] = [];
  let problem: FlushResult['problem'] = null;
  let submitted = false;
  for (const op of compact(ops)) {
    if (op.kind === 'submit' && left.length) { left.push(op); continue; }
    try {
      if (op.kind === 'scores') await api.saveScores(leagueId, roundId, op.entries);
      else if (op.kind === 'ctp') await api.saveCtp(leagueId, roundId, op.holeNumber, op.entry);
      else if (op.kind === 'hole') await api.setCurrentHole(roundId, op.holeIndex);
      else { await api.submitRound(roundId); submitted = true; }
      sawSignal();
    } catch (e) {
      const offline = isNetworkError(e);
      if (offline) sawNoSignal();
      // Which hole a group is on is only a courtesy for the leaderboard, and a refused
      // submit (the week was settled, say) can't go in later: don't keep retrying those.
      if ((op.kind !== 'hole' && op.kind !== 'submit') || offline) left.push(op);
      if (offline) problem = 'offline';
      else if (problem !== 'offline') problem = describe(op, e);
    }
  }
  writeQueue(leagueId, roundId, left);
  return { left, problem, submitted };
}

function describe(op: PendingOp, e: unknown): string {
  const what = op.kind === 'scores' ? `hole ${op.entries[0]?.holeNumber} scores`
    : op.kind === 'ctp' ? `the hole ${op.holeNumber} closest-to-the-pin answer`
    : op.kind === 'submit' ? 'the submitted card'
    : 'the current hole';
  return `Couldn't save ${what}: ${friendlyError(e)}`;
}

// ---- Sending from anywhere ----

/** Rounds whose scoring screen is open: that screen sends its own queue. */
const open = new Set<string>();
export function scoringOpen(roundId: string) {
  open.add(roundId);
  return () => { open.delete(roundId); };
}

/** Every round with something waiting on this phone. */
export function waitingRounds(): { roundId: string; leagueId: string | null; ops: PendingOp[] }[] {
  const out: { roundId: string; leagueId: string | null; ops: PendingOp[] }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const roundId = k.slice(PREFIX.length);
      const s = readStored(roundId);
      if (s.ops.length) out.push({ roundId, ...s });
    }
  } catch { /* storage blocked */ }
  return out;
}

/** Rounds with scores waiting, not counting the open scoring screen (it shows its own). */
export const waitingElsewhere = () => waitingRounds().filter((w) => !open.has(w.roundId)).length;

let sending = false;
/** Send every waiting queue except the open scoring screen's. */
export async function flushAll(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    for (const w of waitingRounds()) {
      if (!w.leagueId || open.has(w.roundId)) continue;
      const r = await flush(w.leagueId, w.roundId, w.ops);
      if (r.problem === 'offline') break; // no signal: try again later
    }
  } finally {
    sending = false;
  }
}

const listeners = new Set<() => void>();
function changed() { listeners.forEach((l) => l()); }
export function onQueueChange(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

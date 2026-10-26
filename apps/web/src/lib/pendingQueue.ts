import { friendlyError } from './api';
import { api } from './backend';
import type { CtpEntry, RoundData, ScoreEntry } from './types';

// Writes a scorer makes on the course are queued here first, so a dropped
// connection never loses a score. Every write is an upsert, so replaying one
// that already landed is harmless, and only the newest value for each golfer
// and hole matters.

export type PendingOp =
  | { kind: 'scores'; entries: ScoreEntry[] }
  | { kind: 'ctp'; holeNumber: number; entry: CtpEntry }
  | { kind: 'hole'; holeIndex: number };

const key = (roundId: string) => `gshq-pending-${roundId}`;

export function readQueue(roundId: string): PendingOp[] {
  try {
    return JSON.parse(localStorage.getItem(key(roundId)) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(roundId: string, ops: PendingOp[]) {
  try {
    if (ops.length) localStorage.setItem(key(roundId), JSON.stringify(ops));
    else localStorage.removeItem(key(roundId));
  } catch {
    /* storage blocked: the in-memory copy still retries while the page is open */
  }
}

/**
 * Keep only the newest write for each golfer+hole, each CTP hole, and the
 * current hole. Scores for one hole go out together.
 */
export function compact(ops: PendingOp[]): PendingOp[] {
  const scores = new Map<string, ScoreEntry>();
  const ctp = new Map<number, CtpEntry>();
  let hole: number | null = null;
  for (const op of ops) {
    if (op.kind === 'scores') for (const e of op.entries) scores.set(`${e.holeNumber}:${e.playerId}`, e);
    else if (op.kind === 'ctp') ctp.set(op.holeNumber, op.entry);
    else hole = op.holeIndex;
  }
  const byHole = new Map<number, ScoreEntry[]>();
  for (const e of scores.values()) byHole.set(e.holeNumber, [...(byHole.get(e.holeNumber) ?? []), e]);
  return [
    ...[...byHole.keys()].sort((a, b) => a - b).map((h) => ({ kind: 'scores' as const, entries: byHole.get(h)! })),
    ...[...ctp.keys()].sort((a, b) => a - b).map((h) => ({ kind: 'ctp' as const, holeNumber: h, entry: ctp.get(h)! })),
    ...(hole === null ? [] : [{ kind: 'hole' as const, holeIndex: hole }]),
  ];
}

export function enqueue(roundId: string, op: PendingOp, memory: PendingOp[]): PendingOp[] {
  const next = compact([...memory, op]);
  writeQueue(roundId, next);
  return next;
}

/** Show what's waiting on this phone on top of what the server has, so nothing looks lost. */
export function applyQueue(round: RoundData, ops: PendingOp[]): RoundData {
  if (!ops.length) return round;
  const next: RoundData = { ...round, scores: { ...round.scores }, ctp: { ...round.ctp } };
  for (const op of ops) {
    if (op.kind === 'scores') for (const e of op.entries) next.scores[e.playerId] = { ...next.scores[e.playerId], [e.holeNumber]: e.strokes };
    else if (op.kind === 'ctp') next.ctp[op.holeNumber] = op.entry;
    else next.currentHole = op.holeIndex;
  }
  return next;
}

const isNetworkError = (e: unknown) => /fetch|load failed|network|offline|timed? ?out|aborted/i.test(e instanceof Error ? e.message : String(e));

export interface FlushResult {
  /** Writes still waiting. */
  left: PendingOp[];
  /** Why something didn't save: null if everything went, 'offline' for no connection, otherwise the server's reason. */
  problem: null | 'offline' | string;
}

/**
 * Send what's waiting. Each write goes on its own, so one that's refused
 * doesn't hold up the rest. Refused scores stay on the phone (never dropped)
 * and the reason is reported.
 */
export async function flush(leagueId: string, roundId: string, ops: PendingOp[]): Promise<FlushResult> {
  const left: PendingOp[] = [];
  let problem: FlushResult['problem'] = null;
  for (const op of compact(ops)) {
    try {
      if (op.kind === 'scores') await api.saveScores(leagueId, roundId, op.entries);
      else if (op.kind === 'ctp') await api.saveCtp(leagueId, roundId, op.holeNumber, op.entry);
      else await api.setCurrentHole(roundId, op.holeIndex);
    } catch (e) {
      const offline = isNetworkError(e);
      // Which hole a group is on is only a courtesy for the leaderboard; don't keep retrying a refused one.
      if (op.kind !== 'hole' || offline) left.push(op);
      if (offline) problem = 'offline';
      else if (problem !== 'offline') problem = describe(op, e);
    }
  }
  writeQueue(roundId, left);
  return { left, problem };
}

function describe(op: PendingOp, e: unknown): string {
  const what = op.kind === 'scores' ? `hole ${op.entries[0]?.holeNumber} scores` : op.kind === 'ctp' ? `the hole ${op.holeNumber} closest-to-the-pin answer` : 'the current hole';
  return `Couldn't save ${what}: ${friendlyError(e)}`;
}

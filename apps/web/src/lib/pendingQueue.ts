import { api } from './backend';
import type { CtpEntry, ScoreEntry } from './types';

// Writes a scorer makes on the course are queued here first, so a dropped
// connection never loses a score. Every write is an upsert, so replaying one
// that already landed is harmless.

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

export function enqueue(roundId: string, op: PendingOp, memory: PendingOp[]): PendingOp[] {
  const next = [...memory, op];
  writeQueue(roundId, next);
  return next;
}

/** Send queued writes in order. Returns whatever couldn't be sent yet. */
export async function flush(leagueId: string, roundId: string, ops: PendingOp[]): Promise<PendingOp[]> {
  let i = 0;
  try {
    for (; i < ops.length; i++) {
      const op = ops[i]!;
      if (op.kind === 'scores') await api.saveScores(leagueId, roundId, op.entries);
      else if (op.kind === 'ctp') await api.saveCtp(leagueId, roundId, op.holeNumber, op.entry);
      else await api.setCurrentHole(roundId, op.holeIndex);
    }
  } catch {
    /* stop at the first failure; keep the rest in order */
  }
  const left = ops.slice(i);
  writeQueue(roundId, left);
  return left;
}

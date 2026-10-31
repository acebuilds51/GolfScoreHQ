import { beforeEach, describe, expect, it, vi } from 'vitest';

// The queue talks to the backend; stand in for it so we can make writes fail.
const calls: string[] = [];
const fail: { ctp?: Error; scores?: Error; hole?: Error; submit?: Error } = {};
vi.mock('../src/lib/backend', () => ({
  api: {
    saveScores: async (_l: string, _r: string, entries: { holeNumber: number }[]) => {
      calls.push(`scores ${entries[0]!.holeNumber}`);
      if (fail.scores) throw fail.scores;
    },
    saveCtp: async (_l: string, _r: string, hole: number) => {
      calls.push(`ctp ${hole}`);
      if (fail.ctp) throw fail.ctp;
    },
    setCurrentHole: async (_r: string, i: number) => {
      calls.push(`hole ${i}`);
      if (fail.hole) throw fail.hole;
    },
    submitRound: async (r: string) => {
      calls.push(`submit ${r}`);
      if (fail.submit) throw fail.submit;
    },
  },
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
});

const { applyQueue, compact, enqueue, flush, flushAll, readQueue, scoringOpen, submitWaiting, waitingElsewhere } = await import('../src/lib/pendingQueue');
type Op = Parameters<typeof compact>[0][number];

const s = (hole: number, playerId: string, strokes: number): Op => ({ kind: 'scores', entries: [{ playerId, holeNumber: hole, strokes }] });

beforeEach(() => {
  calls.length = 0;
  store.clear();
  delete fail.ctp; delete fail.scores; delete fail.hole; delete fail.submit;
});

describe('scores waiting on the phone', () => {
  it('keeps only the newest score per golfer and hole', () => {
    const ops = compact([s(5, 'al', 4), s(5, 'bo', 3), { kind: 'hole', holeIndex: 5 }, s(5, 'al', 3), { kind: 'hole', holeIndex: 4 }, s(6, 'al', 4)]);
    expect(ops).toEqual([
      { kind: 'scores', entries: [{ playerId: 'al', holeNumber: 5, strokes: 3 }, { playerId: 'bo', holeNumber: 5, strokes: 3 }] },
      { kind: 'scores', entries: [{ playerId: 'al', holeNumber: 6, strokes: 4 }] },
      { kind: 'hole', holeIndex: 4 },
    ]);
  });

  it("doesn't let one refused save hold up the rest, and says why", async () => {
    fail.ctp = new Error('new row violates row-level security policy for table "ctp_reports"');
    const ops = [s(5, 'al', 3), { kind: 'ctp', holeNumber: 5, entry: { playerId: 'al', beat: null } } as Op, s(6, 'al', 4), s(7, 'al', 5), { kind: 'hole', holeIndex: 7 } as Op];
    const r = await flush('L', 'R', ops);
    expect(calls).toEqual(['scores 5', 'scores 6', 'scores 7', 'ctp 5', 'hole 7']);
    expect(r.left).toEqual([{ kind: 'ctp', holeNumber: 5, entry: { playerId: 'al', beat: null } }]); // kept, never dropped
    expect(r.problem).toBe("Couldn't save the hole 5 closest-to-the-pin answer: You don't have permission to do that.");
    expect(readQueue('R')).toEqual(r.left);
  });

  it('keeps everything when there is no signal', async () => {
    fail.scores = new TypeError('Load failed');
    fail.hole = new TypeError('Load failed');
    const r = await flush('L', 'R', [s(6, 'al', 4), { kind: 'hole', holeIndex: 6 }]);
    expect(r.problem).toBe('offline');
    expect(r.left).toHaveLength(2);
  });

  it('shows waiting scores when the group is reopened', () => {
    let q: Op[] = [];
    q = enqueue('L', 'R', s(6, 'al', 4), q);
    q = enqueue('L', 'R', { kind: 'hole', holeIndex: 6 }, q);
    const round = { id: 'R', eventId: 'E', teeSlot: 1, status: 'live' as const, currentHole: 5, players: [], scores: { al: { 5: 3 } }, presses: [], ctp: {}, submittedAt: null };
    const shown = applyQueue(round, readQueue('R'));
    expect(shown.scores.al).toEqual({ 5: 3, 6: 4 });
    expect(shown.currentHole).toBe(6);
  });

  it('submits a card left with no signal once every score is in, and not before', async () => {
    fail.scores = new TypeError('Load failed');
    let r = await flush('L', 'R', [s(9, 'al', 4), { kind: 'submit' }]);
    expect(calls).toEqual(['scores 9']); // no submit while a score is still waiting
    expect(submitWaiting(r.left)).toBe(true);
    delete fail.scores;
    calls.length = 0;
    r = await flush('L', 'R', r.left);
    expect(calls).toEqual(['scores 9', 'submit R']);
    expect(r).toMatchObject({ left: [], problem: null, submitted: true });
  });

  it('keeps a submit last however the card is edited after it', () => {
    expect(compact([s(9, 'al', 4), { kind: 'submit' }, s(3, 'al', 5)]).map((o) => o.kind)).toEqual(['scores', 'scores', 'submit']);
  });

  it('sends what waits from any screen, but leaves the open scoring screen to send its own', async () => {
    enqueue('L', 'R1', s(4, 'al', 4), []);
    enqueue('L', 'R2', s(4, 'bo', 5), []);
    store.set('gshq-pending-OLD', JSON.stringify([s(1, 'cy', 4)])); // saved before queues knew their league
    const close = scoringOpen('R2');
    expect(waitingElsewhere()).toBe(2); // R1 and OLD
    await flushAll();
    expect(calls).toEqual(['scores 4']);
    expect(readQueue('R1')).toEqual([]);
    expect(readQueue('R2')).toHaveLength(1);
    close();
    await flushAll();
    expect(readQueue('R2')).toEqual([]);
    expect(readQueue('OLD')).toHaveLength(1); // its scoring screen sends it
  });

  it('stops at the first sign of no signal', async () => {
    enqueue('L', 'R1', s(4, 'al', 4), []);
    enqueue('L', 'R2', s(4, 'bo', 5), []);
    fail.scores = new TypeError('Failed to fetch');
    await flushAll();
    expect(calls).toEqual(['scores 4']);
  });
});
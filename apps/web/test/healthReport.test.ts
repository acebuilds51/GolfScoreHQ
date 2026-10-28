import { describe, expect, it } from 'vitest';
import { buildHealthReport, capacityLines, type HealthSnapshot } from '../../../supabase/functions/health-report/report';
import { worthReporting } from '../src/lib/diagnostics';

const limits = {
  online: { label: 'People online', value: 200 },
  emails_day: { label: 'Emails a day', value: 100 },
  emails_month: { label: 'Emails a month', value: 3000 },
  db_mb: { label: 'Database MB', value: 500 },
};
const quiet = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  errors: [], failed_jobs: [], failed_calls: [], limits,
  usage: { online_peak_day: 20, emails_day: 10, emails_month: 300, db_mb: 40, leagues: 3, active_leagues: 2, golfers: 60, app_users: 30 },
  ...over,
});
const tuesday = new Date('2026-11-03T12:00:00Z');
const monday = new Date('2026-11-02T12:00:00Z');

describe('daily health email', () => {
  it('stays quiet when nothing needs a look (except Mondays)', () => {
    expect(buildHealthReport(quiet(), tuesday, 'https://golfscorehq.app')).toBeNull();
    const weekly = buildHealthReport(quiet(), monday, 'https://golfscorehq.app')!;
    expect(weekly.subject).toBe('GolfScoreHQ health: weekly summary');
    expect(weekly.text).toContain('Leagues: 3 (2 played in the last 2 weeks)');
  });

  it('flags a limit at 70% or more', () => {
    const s = quiet({ usage: { ...quiet().usage, online_peak_day: 150 } });
    expect(capacityLines(s).find((c) => c.key === 'online')).toMatchObject({ used: 150, share: 0.75, warn: true });
    const r = buildHealthReport(s, tuesday, 'https://golfscorehq.app')!;
    expect(r.subject).toBe('GolfScoreHQ health: 1 limit near full');
    expect(r.text).toContain('People online: 150 of 200 (75%)');
  });

  it('lists new problems and golfer reports from the last day, not fixed or old ones', () => {
    const group = (over: object) => ({
      fingerprint: Math.random().toString(), kind: 'error' as const, count: 3, people: 2, first_seen: '2026-11-03T08:00:00Z',
      last_seen: '2026-11-03T09:00:00Z', resolved: false, message: 'Cannot read properties of undefined', path: '/l/oak/week/1', league: 'Oak Creek', reported_by: null, ...over,
    });
    const s = quiet({
      errors: [
        group({}),
        group({ message: 'old one', last_seen: '2026-10-20T09:00:00Z' }),
        group({ message: 'fixed one', resolved: true }),
        group({ kind: 'report', message: "Scores won't save", reported_by: 'bob@example.com', count: 1, people: 1 }),
      ],
    });
    const r = buildHealthReport(s, tuesday, 'https://golfscorehq.app')!;
    expect(r.subject).toBe('GolfScoreHQ health: 1 problem');
    expect(r.text).toContain('3× Cannot read properties of undefined');
    expect(r.text).toContain('2 people · Oak Creek · /l/oak/week/1 · NEW');
    expect(r.text).toContain(`"Scores won't save" (bob@example.com)`);
    expect(r.text).not.toContain('old one');
    expect(r.text).not.toContain('fixed one');
    expect(r.text).toContain('https://golfscorehq.app/staff');
  });

  it('reports failed timers and server calls', () => {
    const r = buildHealthReport(quiet({ failed_jobs: [{ job: 'send-reminders', at: '2026-11-03T10:05:00Z', message: 'timeout' }] }), tuesday, 'x')!;
    expect(r.text).toContain('send-reminders: timeout');
  });
});

describe('what the app reports about itself', () => {
  it('skips no-signal errors and messages the person was meant to see', () => {
    expect(worthReporting('TypeError: Failed to fetch')).toBe(false);
    expect(worthReporting('Load failed')).toBe(false);
    expect(worthReporting('Side games and money needs GolfScoreHQ Pro.')).toBe(false);
    expect(worthReporting('Only commissioners can do that.')).toBe(false);
    expect(worthReporting('')).toBe(false);
    expect(worthReporting('duplicate key value violates unique constraint "hole_scores_pkey"')).toBe(true);
  });
});

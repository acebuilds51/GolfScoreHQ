// The daily health email: what needs a look, in plain words.

export interface ErrorGroup {
  fingerprint: string;
  kind: 'error' | 'failed_action' | 'report';
  count: number;
  people: number;
  first_seen: string;
  last_seen: string;
  resolved: boolean;
  message: string;
  path: string | null;
  league: string | null;
  reported_by: string | null;
  /** Latest stack trace, or the golfer's note. */
  detail?: string | null;
  app_version?: string | null;
  user_agent?: string | null;
}

export interface HealthSnapshot {
  errors: ErrorGroup[];
  failed_jobs: { job: string; at: string; message: string | null }[];
  failed_calls: { at: string; status: number | null; message: string | null }[];
  usage: Record<string, number>;
  limits: Record<string, { label: string; value: number }>;
}

/** Usage measured against each plan limit (the busiest moment in the last day for people online). */
const MEASURES: { limit: string; usage: string }[] = [
  { limit: 'online', usage: 'online_peak_day' },
  { limit: 'emails_day', usage: 'emails_day' },
  { limit: 'emails_month', usage: 'emails_month' },
  { limit: 'db_mb', usage: 'db_mb' },
];
export const WARN_AT = 0.7;

export function capacityLines(s: HealthSnapshot) {
  return MEASURES.filter((m) => s.limits[m.limit]).map((m) => {
    const used = Number(s.usage[m.usage] ?? 0);
    const limit = s.limits[m.limit]!;
    const share = used / limit.value;
    return { key: m.limit, label: limit.label, used, limit: limit.value, share, warn: share >= WARN_AT };
  });
}

/**
 * What to email, or null when there's nothing to say (no new problems, nothing
 * near a limit) and it isn't Monday, when a summary always goes out.
 */
export function buildHealthReport(s: HealthSnapshot, now: Date, appUrl: string): { subject: string; text: string } | null {
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  const recent = s.errors.filter((e) => !e.resolved && new Date(e.last_seen).getTime() > dayAgo);
  const reports = recent.filter((e) => e.kind === 'report');
  const problems = recent.filter((e) => e.kind !== 'report');
  const capacity = capacityLines(s);
  const near = capacity.filter((c) => c.warn);
  const needsLook = problems.length + reports.length + s.failed_jobs.length + s.failed_calls.length + near.length > 0;
  const monday = now.getUTCDay() === 1;
  if (!needsLook && !monday) return null;

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines: string[] = [];
  lines.push(needsLook ? 'Something needs a look.' : 'All quiet. Here is the weekly summary.', '');

  if (near.length) {
    lines.push('NEAR A LIMIT (time to upgrade that plan)');
    for (const c of near) lines.push(`  ${c.label}: ${c.used} of ${c.limit} (${pct(c.share)})`);
    lines.push('');
  }
  if (problems.length) {
    lines.push(`APP PROBLEMS IN THE LAST DAY (${problems.length})`);
    for (const e of problems.slice(0, 15)) {
      lines.push(`  ${e.count}× ${e.message}`);
      lines.push(`     ${e.people} ${e.people === 1 ? 'person' : 'people'}${e.league ? ` · ${e.league}` : ''}${e.path ? ` · ${e.path}` : ''}${new Date(e.first_seen).getTime() > dayAgo ? ' · NEW' : ''}`);
    }
    if (problems.length > 15) lines.push(`  …and ${problems.length - 15} more`);
    lines.push('');
  }
  if (reports.length) {
    lines.push(`PROBLEMS GOLFERS REPORTED (${reports.length})`);
    for (const e of reports.slice(0, 15)) lines.push(`  "${e.message}"${e.reported_by ? ` (${e.reported_by})` : ''}${e.league ? ` · ${e.league}` : ''}`);
    lines.push('');
  }
  if (s.failed_jobs.length) {
    lines.push(`TIMERS THAT FAILED (${s.failed_jobs.length})`);
    for (const j of s.failed_jobs.slice(0, 10)) lines.push(`  ${j.job}: ${j.message ?? 'no message'}`);
    lines.push('');
  }
  if (s.failed_calls.length) {
    lines.push(`SERVER FUNCTION CALLS THAT FAILED (${s.failed_calls.length})`);
    for (const c of s.failed_calls.slice(0, 10)) lines.push(`  ${c.status ?? 'no answer'}: ${c.message ?? ''}`.trimEnd());
    lines.push('');
  }

  lines.push('CAPACITY');
  for (const c of capacity) lines.push(`  ${c.label}: ${c.used} of ${c.limit} (${pct(c.share)})`);
  const u = s.usage;
  lines.push(`  Leagues: ${u.leagues ?? 0} (${u.active_leagues ?? 0} played in the last 2 weeks) · golfers: ${u.golfers ?? 0} · on the app: ${u.app_users ?? 0}`);
  lines.push('');
  lines.push(`Details and "mark fixed": ${appUrl}/staff`);

  const subject = near.length
    ? `GolfScoreHQ health: ${near.length} limit${near.length === 1 ? '' : 's'} near full`
    : problems.length || s.failed_jobs.length || s.failed_calls.length
      ? `GolfScoreHQ health: ${problems.length + s.failed_jobs.length + s.failed_calls.length} problem${problems.length + s.failed_jobs.length + s.failed_calls.length === 1 ? '' : 's'}`
      : reports.length ? `GolfScoreHQ health: ${reports.length} golfer report${reports.length === 1 ? '' : 's'}` : 'GolfScoreHQ health: weekly summary';
  return { subject, text: lines.join('\n') };
}

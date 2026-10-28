// The season's weeks in one go: every 7 days from the first date, skipping
// off dates (holidays, course events), until there are enough playing weeks.

/** "2027-04-29" + n days, as a date string (no time zone shifts). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Weekly dates from `first`: `dates` are the `weeks` playing dates, `all` is
 * every date up to the last one, skipped ones included (to show and re-tick).
 */
export function scheduleDates(first: string, weeks: number, skipped: ReadonlySet<string>): { dates: string[]; all: string[] } {
  const dates: string[] = [];
  const all: string[] = [];
  // Safety stop: a year of Thursdays is plenty.
  for (let i = 0; dates.length < weeks && i < 60; i++) {
    const d = addDays(first, 7 * i);
    all.push(d);
    if (!skipped.has(d)) dates.push(d);
  }
  return { dates, all };
}

/** The first league night on or after `from` (day 0 = Sunday). */
export function nextLeagueDay(from: string, leagueDay: number): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(from, (leagueDay - day + 7) % 7);
}

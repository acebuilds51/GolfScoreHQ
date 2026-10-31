// Which reminder an unpaid Course plan invoice is due for, and what it says.
// Stripe emails the invoice itself; these are the two follow-ups: two weeks
// before the due date, then a final one a week before that explains what
// switches off (Pro for the course's leagues, GRACE_DAYS after the due date).

export type ReminderKind = '14' | '7';

const DAY = 86_400_000;

/** Whole days from now until the due date (the timer runs mid-morning, so rounding lands on the calendar day). */
export function daysLeft(dueSec: number, nowMs: number): number {
  return Math.round((dueSec * 1000 - nowMs) / DAY) || 0; // no -0 on the due day
}

/**
 * The reminder to send today, or null. A missed day (timer down) still sends
 * on the next run, and an invoice with under two weeks to pay skips straight to
 * the final one.
 */
export function reminderFor(dueSec: number, nowMs: number, alreadySent: string[]): ReminderKind | null {
  const left = daysLeft(dueSec, nowMs);
  if (left < 0) return null;
  if (left <= 7) return alreadySent.includes('7') ? null : '7';
  if (left <= 14) return alreadySent.includes('14') || alreadySent.includes('7') ? null : '14';
  return null;
}

export interface ReminderInput {
  kind: ReminderKind;
  courseName: string;
  leagues: string[];
  amountCents: number;
  dueSec: number;
  graceDays: number;
  payUrl: string | null;
  supportEmail: string;
}

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;

export function reminderEmail(r: ReminderInput): { subject: string; text: string } {
  const due = fmtDay(r.dueSec * 1000);
  const off = fmtDay(r.dueSec * 1000 + r.graceDays * DAY);
  const leagues = r.leagues.length ? r.leagues.join(', ') : 'your leagues';
  const pay = r.payUrl
    ? `Pay by card or bank transfer here:\n${r.payUrl}\n\nPaying by check? Reply to this email when it's in the mail and we'll keep everything on.`
    : `Paying by check? Reply to this email when it's in the mail and we'll keep everything on.`;

  if (r.kind === '14') {
    return {
      subject: `Reminder: GolfScoreHQ invoice for ${r.courseName} is due ${due}`,
      text: [
        `Hi,`,
        `Your GolfScoreHQ Course plan invoice for ${r.courseName} (${dollars(r.amountCents)} for the year) is due in two weeks, on ${due}.`,
        pay,
        `It covers GolfScoreHQ Pro for every league at your course: ${leagues}.`,
        `Questions? Just reply, or write to ${r.supportEmail}.`,
        `Thank you,\nGolfScoreHQ`,
      ].join('\n\n'),
    };
  }

  return {
    subject: `Final reminder: ${r.courseName}'s GolfScoreHQ Pro ends ${off} unless the invoice is paid`,
    text: [
      `Hi,`,
      `This is the final reminder: your GolfScoreHQ Course plan invoice for ${r.courseName} (${dollars(r.amountCents)} for the year) is due in one week, on ${due}.`,
      pay,
      `If it isn't paid by then, on ${off} Pro switches off for ${leagues}. That means:`,
      [
        '- Side games and money: skins, closest to the pin, presses, payouts and dues',
        '- The tee sheet, RSVPs, sub finder and "Are you playing?" reminders',
        '- Weekly recap emails and awards',
        '- Clubhouse TV and your sponsor screen',
        '- Past seasons, all formats, branding and downloads',
      ].join('\n'),
      `Nothing is deleted. Scoring, the live leaderboard, standings and the roster keep working free, and everything comes back the moment the invoice is paid.`,
      `Questions, or need more time? Just reply, or write to ${r.supportEmail}.`,
      `Thank you,\nGolfScoreHQ`,
    ].join('\n\n'),
  };
}

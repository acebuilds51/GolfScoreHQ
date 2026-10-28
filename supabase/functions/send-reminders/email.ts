// "Are you playing?" reminder email and when it goes out. No imports, so the
// server function (Deno) and the app's tests share it.

export interface ReminderEmailInput {
  leagueName: string;
  playerName: string;
  weekNumber: number;
  /** "2027-04-29" */
  eventDate: string;
  /** One-tap answer page for this golfer and week (the app adds ?a=in / ?a=out / ?a=stop). */
  answerUrl: string;
  /** The week's page in the app (tee sheet). */
  weekUrl: string;
  /** League colors as #rrggbb (Pro branding). */
  brand?: { color?: string | null; accent?: string | null };
}

export interface ReminderEmail {
  subject: string;
  text: string;
  html: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-04-29" → { day: "Thursday", date: "Apr 29" } (no time zone shifts). */
export function leagueDay(isoDate: string): { day: string; date: string } {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return { day: DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!, date: `${MONTHS[m - 1]} ${d}` };
}

/** The date and hour right now in a time zone: { date: "2027-04-27", hour: 9 }. */
export function localNow(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Send at 9 AM league time (or later that day), `daysBefore` days before league night. */
export const SEND_HOUR = 9;
export function reminderDue(eventDate: string, daysBefore: number, now: Date, timeZone: string): boolean {
  const local = localNow(now, timeZone);
  const [y, m, d] = eventDate.split('-').map(Number) as [number, number, number];
  const send = new Date(Date.UTC(y, m - 1, d - daysBefore)).toISOString().slice(0, 10);
  return local.date === send && local.hour >= SEND_HOUR;
}

export function buildReminderEmail(i: ReminderEmailInput): ReminderEmail {
  const { day, date } = leagueDay(i.eventDate);
  const first = i.playerName.split(' ')[0] || i.playerName;
  const subject = `Are you playing ${day}? ${i.leagueName}, week ${i.weekNumber}`;
  const link = (a: string) => `${i.answerUrl}${i.answerUrl.includes('?') ? '&' : '?'}a=${a}`;

  const text = [
    `Hi ${first},`,
    '',
    `Are you playing ${i.leagueName} on ${day}, ${date} (week ${i.weekNumber})?`,
    '',
    `I'm in: ${link('in')}`,
    `I'm out: ${link('out')}`,
    '',
    `Join a group, or say you need a partner or a match, on the tee sheet: ${i.weekUrl}`,
    '',
    `Don't want these reminders? ${link('stop')}`,
  ].join('\n');

  const color = i.brand?.color && HEX.test(i.brand.color) ? i.brand.color : '#14365c';
  const accent = i.brand?.accent && HEX.test(i.brand.accent) ? i.brand.accent : color;
  const button = (href: string, label: string, bg: string, fg: string) =>
    `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;margin:0 8px 8px 0">${esc(label)}</a>`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f6f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d2321">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border:1px solid #dde1de;border-top:4px solid ${accent};border-radius:10px;padding:20px;font-size:15px;line-height:1.5">
    <p style="margin:0 0 12px">Hi ${esc(first)},</p>
    <p style="margin:0 0 16px;font-size:17px"><strong>Are you playing ${esc(i.leagueName)} on ${day}, ${date}?</strong> <span style="color:#5b6461">(week ${i.weekNumber})</span></p>
    <div>${button(link('in'), "I'm in", '#0b6247', '#ffffff')}${button(link('out'), "I'm out", '#eef0ee', '#1d2321')}</div>
    <p style="margin:12px 0 0">Need a partner or a match? <a href="${esc(i.weekUrl)}" style="color:${color}">Open the tee sheet</a>.</p>
  </div>
  <p style="font-size:12px;color:#5b6461;margin:12px 4px">Don't want these reminders? <a href="${esc(link('stop'))}" style="color:#5b6461">Stop them</a>.</p>
</div></body></html>`;

  return { subject, text, html };
}

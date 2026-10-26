// Builds one golfer's weekly recap email. No imports, so the server function
// (Deno) and the app's preview (browser) share it, and it's easy to test.

export interface PaymentHandles {
  venmo?: string | null;
  paypalMe?: string | null;
  zelle?: string | null;
}

export interface RecapEmailInput {
  leagueName: string;
  weekNumber: number;
  /** Link to the league in the app. */
  leagueUrl: string;
  /** The league-wide recap from the engine's recapText(). */
  recapBody: string;
  playerName: string;
  /** This golfer's money this week and season to date, in cents (null = league doesn't play for money). */
  weekCents: number | null;
  seasonCents: number | null;
  payment: PaymentHandles;
}

export interface RecapEmail {
  subject: string;
  text: string;
  html: string;
}

const dollars = (c: number) => `$${(Math.abs(c) / 100).toFixed(2).replace(/\.00$/, '')}`;
const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${dollars(c)}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s: string | null | undefined) => (s ?? '').trim().replace(/^@/, '');

/** Ways to pay the commissioner, with an amount filled in where the app supports it. */
export function paymentOptions(p: PaymentHandles, owedCents: number): { label: string; url: string | null }[] {
  const amount = (owedCents / 100).toFixed(2);
  const out: { label: string; url: string | null }[] = [];
  if (clean(p.venmo)) out.push({ label: `Venmo @${clean(p.venmo)}`, url: `https://venmo.com/u/${encodeURIComponent(clean(p.venmo))}` });
  if (clean(p.paypalMe)) out.push({ label: `PayPal paypal.me/${clean(p.paypalMe)}`, url: `https://paypal.me/${encodeURIComponent(clean(p.paypalMe))}/${amount}` });
  if (clean(p.zelle)) out.push({ label: `Zelle ${clean(p.zelle)}`, url: null });
  return out;
}

export function buildRecapEmail(i: RecapEmailInput): RecapEmail {
  const subject = `${i.leagueName}: week ${i.weekNumber} results`;
  const first = i.playerName.split(' ')[0] || i.playerName;

  const personal: string[] = [];
  if (i.weekCents !== null) {
    personal.push(
      i.weekCents > 0 ? `You won ${dollars(i.weekCents)} this week.` : i.weekCents < 0 ? `You owe ${dollars(i.weekCents)} this week.` : 'No money changed hands for you this week.',
    );
    if (i.seasonCents !== null) personal.push(`Season to date: ${signed(i.seasonCents)}.`);
  }
  const pay = i.weekCents !== null && i.weekCents < 0 ? paymentOptions(i.payment, -i.weekCents) : [];

  const text = [
    `Hi ${first},`,
    '',
    ...(personal.length ? [personal.join(' '), ''] : []),
    ...(pay.length ? ['Pay the commissioner:', ...pay.map((p) => `  ${p.label}${p.url ? ` — ${p.url}` : ''}`), ''] : []),
    i.recapBody,
    '',
    `See everything in the app: ${i.leagueUrl}`,
    '',
    "Don't want these emails? Turn off \"Email me the weekly recap\" on your league's Overview page.",
  ].join('\n');

  const bodyHtml = i.recapBody
    .split('\n')
    .map((line) => {
      if (!line.trim()) return '';
      if (/^[A-Z][A-Z ]+(:.*)?$/.test(line.trim()) && !line.startsWith(' ')) {
        const [head, ...rest] = line.split(':');
        return rest.length
          ? `<p style="margin:12px 0 4px"><strong>${esc(head!)}:</strong>${esc(rest.join(':'))}</p>`
          : `<p style="margin:16px 0 4px;font-size:12px;letter-spacing:.06em;color:#5b6461"><strong>${esc(head!)}</strong></p>`;
      }
      if (line.startsWith('  ')) return `<div style="margin:2px 0 2px 8px">${esc(line.trim())}</div>`;
      return `<p style="margin:0 0 6px"><strong>${esc(line)}</strong></p>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;background:#f6f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d2321">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#14365c;color:#fff;border-radius:10px 10px 0 0;padding:16px 20px">
    <div style="font-size:18px;font-weight:700">${esc(i.leagueName)}</div>
    <div style="font-size:13px;opacity:.85">Week ${i.weekNumber} results</div>
  </div>
  <div style="background:#fff;border:1px solid #dde1de;border-top:0;border-radius:0 0 10px 10px;padding:20px;font-size:15px;line-height:1.5">
    <p style="margin:0 0 12px">Hi ${esc(first)},</p>
    ${personal.length ? `<p style="margin:0 0 12px;font-size:16px"><strong>${esc(personal.join(' '))}</strong></p>` : ''}
    ${pay.length ? `<div style="background:#e1f5ee;border-radius:8px;padding:12px;margin:0 0 16px"><div style="font-weight:700;margin-bottom:6px">Pay the commissioner</div>${pay
      .map((p) => (p.url ? `<div><a href="${esc(p.url)}" style="color:#0b6247">${esc(p.label)}</a></div>` : `<div>${esc(p.label)}</div>`))
      .join('')}</div>` : ''}
    ${bodyHtml}
    <p style="margin:20px 0 0"><a href="${esc(i.leagueUrl)}" style="display:inline-block;background:#14365c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open GolfScoreHQ</a></p>
  </div>
  <p style="font-size:12px;color:#5b6461;margin:12px 4px">Don't want these emails? Turn off "Email me the weekly recap" on your league's Overview page.</p>
</div></body></html>`;

  return { subject, text, html };
}

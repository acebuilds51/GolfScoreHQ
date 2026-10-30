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
  /**
   * What the commissioner pays this golfer (or, if negative, collects) this
   * week and season to date, in cents (null = league doesn't play for money).
   * With match money between golfers this is skins, closest to the pin and prizes.
   */
  weekCents: number | null;
  seasonCents: number | null;
  /**
   * Match and press money settled between the golfers themselves (null: the
   * league runs it through the commissioner, or plays no match). Shown, never asked for.
   */
  matchCents?: number | null;
  seasonMatchCents?: number | null;
  payment: PaymentHandles;
  /** The commissioner-approved write-up of the week (AI-drafted), shown above the results. */
  story?: string | null;
  /** The league's branding (Pro): colors as #rrggbb and a logo URL. */
  brand?: { color?: string | null; accent?: string | null; logoUrl?: string | null };
}

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_COLOR = '#14365c';

/** White or near-black text, whichever reads better on this background. */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0556 ? '#ffffff' : '#111111';
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

/** Money settled between golfers (when the league plays it that way); everything else goes through the commissioner. */
export const MATCH_KINDS = ['match', 'press'];
export type MatchMoney = 'golfers' | 'commissioner';

/**
 * One golfer's money split the way the league handles it: what the commissioner
 * pays (or collects), and match money settled within the group (null when it
 * goes through the commissioner too).
 */
export function splitMoney(rows: { playerId: string; kind: string; amount: number }[], playerId: string, matchMoney: MatchMoney) {
  let commissioner = 0;
  let match = 0;
  for (const r of rows) {
    if (r.playerId !== playerId) continue;
    if (matchMoney === 'golfers' && MATCH_KINDS.includes(r.kind)) match += r.amount;
    else commissioner += r.amount;
  }
  return { commissioner, match: matchMoney === 'golfers' ? match : null };
}

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
  const matchApart = i.matchCents !== undefined && i.matchCents !== null;
  if (i.weekCents !== null && matchApart) {
    // Match money between golfers: say what the commissioner pays, and the match result on its own.
    if (i.weekCents > 0) personal.push(`The commissioner owes you ${dollars(i.weekCents)} this week.`);
    else if (i.weekCents < 0) personal.push(`You owe the commissioner ${dollars(i.weekCents)} this week.`);
    const m = i.matchCents!;
    personal.push(m > 0 ? `You won ${dollars(m)} on your match and presses.` : m < 0 ? `You lost ${dollars(m)} on your match and presses.` : i.weekCents === 0 ? 'No money changed hands for you this week.' : '');
    if (i.seasonCents !== null) {
      const sm = i.seasonMatchCents ?? 0;
      personal.push(`Season to date: ${signed(i.seasonCents)} from the commissioner${sm ? `, ${signed(sm)} on matches` : ''}.`);
    }
  } else if (i.weekCents !== null) {
    personal.push(
      i.weekCents > 0 ? `You won ${dollars(i.weekCents)} this week.` : i.weekCents < 0 ? `You owe ${dollars(i.weekCents)} this week.` : 'No money changed hands for you this week.',
    );
    if (i.seasonCents !== null) personal.push(`Season to date: ${signed(i.seasonCents)}.`);
  }
  const personalText = personal.filter(Boolean).join(' ');
  const pay = i.weekCents !== null && i.weekCents < 0 ? paymentOptions(i.payment, -i.weekCents) : [];
  const story = (i.story ?? '').trim().split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const text = [
    `Hi ${first},`,
    '',
    ...(personalText ? [personalText, ''] : []),
    ...(pay.length ? ['Pay the commissioner:', ...pay.map((p) => `  ${p.label}${p.url ? ` — ${p.url}` : ''}`), ''] : []),
    ...story.flatMap((p) => [p, '']),
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

  const color = i.brand?.color && HEX.test(i.brand.color) ? i.brand.color : DEFAULT_COLOR;
  const accent = i.brand?.accent && HEX.test(i.brand.accent) ? i.brand.accent : color;
  const onColor = textOn(color);
  const logo = i.brand?.logoUrl && /^https:\/\//.test(i.brand.logoUrl) ? i.brand.logoUrl : null;
  const titleHtml = `<div style="font-size:18px;font-weight:700">${esc(i.leagueName)}</div>
      <div style="font-size:13px;opacity:.85">Week ${i.weekNumber} results</div>`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f6f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d2321">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:${color};color:${onColor};border-radius:10px 10px 0 0;padding:16px 20px;border-bottom:4px solid ${accent}">
    ${logo
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:12px;vertical-align:middle"><img src="${esc(logo)}" alt="" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:contain;background:#fff;border-radius:6px;padding:2px"></td>
      <td style="vertical-align:middle;color:${onColor}">${titleHtml}</td></tr></table>`
      : titleHtml}
  </div>
  <div style="background:#fff;border:1px solid #dde1de;border-top:0;border-radius:0 0 10px 10px;padding:20px;font-size:15px;line-height:1.5">
    <p style="margin:0 0 12px">Hi ${esc(first)},</p>
    ${personalText ? `<p style="margin:0 0 12px;font-size:16px"><strong>${esc(personalText)}</strong></p>` : ''}
    ${pay.length ? `<div style="background:#e1f5ee;border-radius:8px;padding:12px;margin:0 0 16px"><div style="font-weight:700;margin-bottom:6px">Pay the commissioner</div>${pay
      .map((p) => (p.url ? `<div><a href="${esc(p.url)}" style="color:#0b6247">${esc(p.label)}</a></div>` : `<div>${esc(p.label)}</div>`))
      .join('')}</div>` : ''}
    ${story.length ? `<div style="border-left:3px solid ${accent};padding:2px 0 2px 12px;margin:0 0 16px">${story.map((p) => `<p style="margin:0 0 8px">${esc(p)}</p>`).join('')}</div>` : ''}
    ${bodyHtml}
    <p style="margin:20px 0 0"><a href="${esc(i.leagueUrl)}" style="display:inline-block;background:${color};color:${onColor};text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open GolfScoreHQ</a></p>
  </div>
  <p style="font-size:12px;color:#5b6461;margin:12px 4px">Don't want these emails? Turn off "Email me the weekly recap" on your league's Overview page.</p>
</div></body></html>`;

  return { subject, text, html };
}

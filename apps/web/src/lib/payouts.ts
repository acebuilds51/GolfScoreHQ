// Paying out: what the commissioner owes each golfer for a settled week, and
// links that open Venmo or PayPal with the golfer, amount and note filled in.
// The app never moves money; the commissioner taps Pay in their own app.
import { splitMoney } from '../../../../supabase/functions/send-recap/email';
import type { LedgerRow, MatchMoney, PayHandles } from './types';

export interface WeekPayout {
  playerId: string;
  /** What the commissioner pays this golfer (negative: what the golfer owes the commissioner). */
  cents: number;
  /** Holes won, for the note: "skin #3, CTP #7". */
  skinHoles: number[];
  ctpHoles: number[];
  /** Prize money for a finishing place or a scramble team. */
  prizeCents: number;
  /** Match and press money the golfers settle among themselves (null when it goes through the commissioner). */
  matchCents: number | null;
}

/** Every golfer with money from the week, the commissioner's side first: biggest payouts at the top. */
export function weekPayouts(ledger: LedgerRow[], matchMoney: MatchMoney): WeekPayout[] {
  const rows = ledger.map((e) => ({ playerId: e.playerId, kind: e.kind, amount: e.amountCents }));
  const ids = [...new Set(ledger.map((e) => e.playerId))];
  return ids
    .map((playerId) => {
      const mine = ledger.filter((e) => e.playerId === playerId);
      const split = splitMoney(rows, playerId, matchMoney);
      return {
        playerId,
        cents: split.commissioner,
        skinHoles: mine.filter((e) => e.kind === 'skin' && e.holeNumber).map((e) => e.holeNumber!).sort((a, b) => a - b),
        ctpHoles: mine.filter((e) => e.kind === 'ctp' && e.holeNumber).map((e) => e.holeNumber!).sort((a, b) => a - b),
        prizeCents: mine.filter((e) => e.kind === 'place' || e.kind === 'scramblePot').reduce((s, e) => s + e.amountCents, 0),
        matchCents: split.match,
      };
    })
    .sort((a, b) => b.cents - a.cents);
}

/** "Oak Creek week 5: skins #3 and #8, CTP #7" */
export function payoutNote(leagueName: string, weekNumber: number, p: WeekPayout): string {
  const parts: string[] = [];
  const holes = (h: number[]) => h.map((n) => `#${n}`).join(' and ');
  if (p.skinHoles.length) parts.push(`${p.skinHoles.length === 1 ? 'skin' : 'skins'} ${holes(p.skinHoles)}`);
  if (p.ctpHoles.length) parts.push(`CTP ${holes(p.ctpHoles)}`);
  if (p.prizeCents) parts.push('prize money');
  return `${leagueName} week ${weekNumber}${parts.length ? `: ${parts.join(', ')}` : ''}`.slice(0, 280);
}

const clean = (s: string | null | undefined) => (s ?? '').trim().replace(/^@/, '');
const amount = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

/** Opens Venmo (the app on a phone) ready to pay this person, with the amount and note filled in. */
export function venmoPayUrl(handle: string | null | undefined, cents: number, note: string): string | null {
  const user = clean(handle);
  if (!user) return null;
  const q = new URLSearchParams({ txn: 'pay', audience: 'private', recipients: user, amount: amount(cents), note });
  return `https://venmo.com/?${q.toString()}`;
}

/** Opens PayPal to pay this person the amount (they add a note there if they like). */
export function paypalPayUrl(handle: string | null | undefined, cents: number): string | null {
  const user = clean(handle);
  return user ? `https://paypal.me/${encodeURIComponent(user)}/${amount(cents)}USD` : null;
}

/** Tidy what a golfer types: "@Joe-Smith" → "Joe-Smith"; a whole paypal.me link → the name. Empty → null. */
export function cleanHandles(h: PayHandles): PayHandles {
  const v = clean(h.venmo).replace(/^https?:\/\/(www\.)?venmo\.com\/(u\/)?/i, '');
  const p = clean(h.paypalMe).replace(/^https?:\/\/(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '');
  const z = (h.zelle ?? '').trim();
  return { venmo: v || null, paypalMe: p || null, zelle: z || null };
}

/** Problems with what was typed, in plain words (matches the database's checks). */
export function handleProblem(h: PayHandles): string | null {
  if (h.venmo && !/^[A-Za-z0-9_-]{1,30}$/.test(h.venmo)) return 'A Venmo username is letters, numbers, - and _ (up to 30).';
  if (h.paypalMe && !/^[A-Za-z0-9_.-]{1,40}$/.test(h.paypalMe)) return 'Enter just the name from your paypal.me link.';
  if (h.zelle && h.zelle.length > 80) return 'Zelle: an email or phone number.';
  return null;
}

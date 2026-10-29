// What we sell, in words for the upgrade screens. Prices must match the
// Stripe prices (and the plans table).
export const PRICE = { pro: '$149', club: '$299' } as const;
/** Pro for one league, one year (the "I'd chip in" limit in the database matches). */
export const PRO_CENTS = 14900;

/**
 * Each golfer's share of Pro for the season, in whole dollars (rounded up so
 * the shares cover the price), split across the regular golfers. Null with nobody to split it.
 */
export function shareDollars(golfers: number): number | null {
  return golfers > 0 ? Math.ceil(PRO_CENTS / golfers / 100) : null;
}

export const PRO_PERKS = [
  'Skins, closest to the pin, presses and match money, settled for you',
  'Tee sheet: tee times, captains, groups and partners',
  'Weekly recap email with an AI write-up and pay links',
  'RSVP and sub finder',
  'Clubhouse TV leaderboard',
  'Your logo, colors and course photo',
  'Co-commissioners, every season kept, export',
];

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** After Stripe sends people back, wait for the payment to switch the plan on. */
export const billingReturn = () => new URLSearchParams(window.location.search).get('billing') as 'done' | 'cancelled' | null;

export function clearBillingReturn() {
  const url = new URL(window.location.href);
  url.searchParams.delete('billing');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

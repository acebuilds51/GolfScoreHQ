// What we sell, in words for the upgrade screens. Prices must match the
// Stripe prices (and the plans table).
export const PRICE = { pro: '$149', club: '$299' } as const;

export const PRO_PERKS = [
  'Skins, closest to the pin, presses and match money, settled for you',
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

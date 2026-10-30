// What we sell, in words for the upgrade screens. Prices must match the
// Stripe prices (and the plans table).
export const PRICE = { pro: '$149', course: '$990' } as const;
/**
 * The Course plan is sold to golf courses directly and billed by invoice, not
 * through Stripe Checkout. In the database it is the 'club' plan: one club
 * record for the course, with its leagues attached.
 */
export const COURSE_OFFER = 'Founding Course price, for the first 5 Florida courses.';
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
  'Weekly recap email with a story of the week and pay links',
  'RSVP and sub finder',
  'Clubhouse TV leaderboard',
  'Your logo, colors and course photo',
  'Co-commissioners, every season kept, export',
];

/** One "wouldn't it be great if…" for the upgrade card, and what Pro does about it. */
export interface ProTeaser {
  icon: string;
  wish: string;
  answer: string;
}

/** What a golfer would get out of Pro, told from their side of league night. */
export const GOLFER_TEASERS: ProTeaser[] = [
  { icon: '💰', wish: 'Wouldn’t it be great to know who won skins the minute the last group walks off?', answer: 'Skins, closest to the pin and match money are worked out for you, right on your phone.' },
  { icon: '🧾', wish: 'Wouldn’t it be great to see exactly what you won or owe, without anyone’s spreadsheet?', answer: 'Every week’s money is posted for the whole league, with Venmo, PayPal and Zelle links.' },
  { icon: '⛳', wish: 'Wouldn’t it be great to grab your tee time and see your group from your phone?', answer: 'The tee sheet shows tee times, groups and partners, and you can join a group yourself.' },
  { icon: '📬', wish: 'Wouldn’t it be great to get the week’s results, with a funny write-up, in your inbox?', answer: 'The weekly recap email has every result, skins, highlights and your own winnings.' },
  { icon: '👍', wish: 'Wouldn’t it be great to tap one button to say you’re in or out this week?', answer: 'One-tap RSVPs, reminder emails, and a sub finder when your group is short.' },
  { icon: '🏆', wish: 'Wouldn’t it be great to see your best round, birdies and hot streaks all season?', answer: 'Season awards, player stats and a picture to share with the group text.' },
  { icon: '📺', wish: 'Wouldn’t it be great to watch the leaderboard on the clubhouse TV?', answer: 'Clubhouse TV shows live scores, skins and standings on any screen.' },
];

/** What a commissioner would get out of Pro: the jobs it takes off their plate. */
export const COMMISH_TEASERS: ProTeaser[] = [
  { icon: '🧮', wish: 'Wouldn’t it be great if skins, closest to the pin and the match money settled themselves?', answer: 'No calculator in the parking lot: tap Settle and everyone sees what they won or owe.' },
  { icon: '📋', wish: 'Wouldn’t it be great to know who’s playing before league night?', answer: 'RSVP reminder emails with one-tap answers, and a sub finder that asks your subs for you.' },
  { icon: '⛳', wish: 'Wouldn’t it be great if golfers filled in the tee sheet themselves?', answer: 'Set tee times once for the season; golfers join groups, and captains run their own.' },
  { icon: '✍️', wish: 'Wouldn’t it be great to never type up the weekly results again?', answer: 'The recap email goes to everyone with results, pay links and an AI write-up you can edit.' },
  { icon: '🎨', wish: 'Wouldn’t it be great to have your league’s logo and colors on everything?', answer: 'Your logo, colors and course photo on every page, the TV and the share pictures.' },
  { icon: '📤', wish: 'Wouldn’t it be great to have someone set the whole league up for you?', answer: 'Send us your spreadsheet and we’ll load your golfers, courses and history.' },
  { icon: '🤝', wish: 'Wouldn’t it be great to hand off some of the work?', answer: 'Add co-commissioners, keep every past season, and export it all whenever you like.' },
];

/** Which teaser to show this time: the next one each time the card appears, so it stays fresh. */
export function nextTeaser(list: ProTeaser[], key: string): number {
  try {
    const i = (Number(localStorage.getItem(key) ?? -1) + 1) % list.length;
    localStorage.setItem(key, String(i));
    return i;
  } catch {
    return Math.floor(Math.random() * list.length);
  }
}

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** After Stripe sends people back, wait for the payment to switch the plan on. */
export const billingReturn = () => new URLSearchParams(window.location.search).get('billing') as 'done' | 'cancelled' | null;

export function clearBillingReturn() {
  const url = new URL(window.location.href);
  url.searchParams.delete('billing');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

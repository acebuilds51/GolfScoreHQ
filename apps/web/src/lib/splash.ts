/** How long the splash (index.html) stays up when the app opens, so its little animation plays. */
export const SPLASH_MS = 1400;

/**
 * Fade the splash out once it has been up SPLASH_MS (the app loads behind it,
 * so it never adds a wait of its own beyond that). The Clubhouse TV and links
 * opened from emails or texts skip it.
 */
export function hideSplash(now = performance.now()) {
  const el = document.getElementById('splash');
  if (!el) return;
  const skip = /^\/(tv|rsvp|join|pilot)\//.test(window.location.pathname);
  const wait = skip ? 0 : Math.max(0, SPLASH_MS - now);
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 400);
  }, wait);
}

/** How long the splash (index.html) stays up when the app opens: long enough to read it and watch the putt drop. */
export const SPLASH_MS = 3000;

/**
 * Fade the splash out once it has been up SPLASH_MS (the app loads behind it). The Clubhouse TV and links
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

/** How long the splash (index.html) stays up when the app opens: about the length of its video. */
export const SPLASH_MS = 3000;
/** A splash video that started late still gets to finish, but holds the app up no longer than this. */
const VIDEO_GRACE_MS = 1500;

/**
 * Fade the splash out once it has been up SPLASH_MS (the app loads behind it), or once its video ends if
 * it's still playing then. The Clubhouse TV and links opened from emails or texts skip it.
 */
export function hideSplash(now = performance.now()) {
  const el = document.getElementById('splash');
  if (!el) return;
  const skip = /^\/(tv|rsvp|join|pilot)\//.test(window.location.pathname);
  const wait = skip ? 0 : Math.max(0, SPLASH_MS - now);
  const out = () => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 400);
  };
  window.setTimeout(() => {
    const video = el.querySelector('video');
    if (skip || !video || video.paused || video.ended) return out();
    video.addEventListener('ended', out, { once: true });
    window.setTimeout(out, VIDEO_GRACE_MS);
  }, wait);
}

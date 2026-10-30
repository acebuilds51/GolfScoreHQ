// The public demo (golfscorehq.app/demo) runs on demo data in this browser,
// even on the live site, until "Exit demo".

const SITE_KEY = 'gshq-demo-site';
/** The demo league's TV link token, so the demo bar can open the TV screen. */
const TV_KEY = 'gshq-demo-tv';
/** The last /demo link's query (a course's personalized demo), so "Start over" keeps it. */
const LINK_KEY = 'gshq-demo-link';

export function demoLink(): string {
  try {
    return `/demo${localStorage.getItem(LINK_KEY) ?? ''}`;
  } catch {
    return '/demo';
  }
}

export function saveDemoLink(search: string) {
  try {
    localStorage.setItem(LINK_KEY, search);
  } catch {
    /* "Start over" opens the plain demo */
  }
}

export function inDemoSite(): boolean {
  try {
    return localStorage.getItem(SITE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemoSite(on: boolean) {
  try {
    if (on) localStorage.setItem(SITE_KEY, '1');
    else {
      localStorage.removeItem(SITE_KEY);
      localStorage.removeItem(TV_KEY);
      localStorage.removeItem(LINK_KEY);
    }
  } catch {
    /* storage blocked: the demo page says so */
  }
}

export function demoTvToken(): string | null {
  try {
    return localStorage.getItem(TV_KEY);
  } catch {
    return null;
  }
}

export function saveDemoTvToken(token: string) {
  try {
    localStorage.setItem(TV_KEY, token);
  } catch {
    /* no TV shortcut in the demo bar; the rest still works */
  }
}

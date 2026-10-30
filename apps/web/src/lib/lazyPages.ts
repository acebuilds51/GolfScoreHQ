import { lazy, type ComponentType } from 'react';

// Pages used less often on league night load as their own pieces, so the app
// opens faster. All of them are fetched in the background right after the app
// opens (prefetchPages), so tapping one never waits on a download.

const loaders: (() => Promise<unknown>)[] = [];

function page<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  loaders.push(load);
  return lazy(async () => ({ default: (await load())[name] as unknown as ComponentType }));
}

export const SettingsPage = page(() => import('../pages/SettingsPage'), 'SettingsPage');
export const AwardsPage = page(() => import('../pages/AwardsPage'), 'AwardsPage');
export const PlayerPage = page(() => import('../pages/PlayerPage'), 'PlayerPage');
export const SetupWizardPage = page(() => import('../pages/SetupWizardPage'), 'SetupWizardPage');
export const SetupServicePage = page(() => import('../pages/SetupServicePage'), 'SetupServicePage');
export const ImportPage = page(() => import('../pages/ImportPage'), 'ImportPage');
export const StaffPage = page(() => import('../pages/StaffPage'), 'StaffPage');
export const TvPage = page(() => import('../pages/TvPage'), 'TvPage');
export const PilotPage = page(() => import('../pages/PilotPage'), 'PilotPage');
export const RsvpLinkPage = page(() => import('../pages/RsvpLinkPage'), 'RsvpLinkPage');
export const JoinInvitePage = page(() => import('../pages/JoinInvitePage'), 'JoinInvitePage');
export const CoursesPage = page(() => import('../pages/CoursesPage'), 'CoursesPage');
export const RosterPage = page(() => import('../pages/RosterPage'), 'RosterPage');
export const HelpPage = page(() => import('../pages/HelpPage'), 'HelpPage');
export const PricingPage = page(() => import('../pages/LegalPages'), 'PricingPage');
export const ForCoursesPage = page(() => import('../pages/ForCoursesPage'), 'ForCoursesPage');
export const TermsPage = page(() => import('../pages/LegalPages'), 'TermsPage');
export const PrivacyPage = page(() => import('../pages/LegalPages'), 'PrivacyPage');
export const RefundsPage = page(() => import('../pages/LegalPages'), 'RefundsPage');

/** Download every page in the background once the app is up and the phone is idle. */
export function prefetchPages() {
  const go = () => { for (const load of loaders) load().catch(() => { /* fetched again when tapped */ }); };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  window.setTimeout(() => (idle ? idle(go) : go()), 1500);
}

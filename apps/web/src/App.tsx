import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { HelpButton } from './components/HelpButton';
import { PageSkeleton } from './components/ui';
import { SiteFooter } from './components/SiteFooter';
import { AuthContext, useAuth, useAuthState } from './lib/hooks';
import {
  AwardsPage, CoursesPage, FeedbackPage, ForCoursesPage, GuidePage, HelpPage, ImportPage, JoinInvitePage, LessonPage, LessonsPage, PilotPage, PlayerPage, prefetchPages, PricingPage, PrivacyPage, RefundsPage,
  RosterPage, RsvpLinkPage, SettingsPage, SetupServicePage, SetupWizardPage, StaffPage, TermsPage, TvPage,
} from './lib/lazyPages';
// League night's pages are in the first download.
import { LeagueLayout } from './pages/LeagueLayout';
import { LivePage } from './pages/LivePage';
import { MorePage } from './pages/MorePage';
import { LeaguesPage } from './pages/LeaguesPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlayPage } from './pages/PlayPage';
import { ScoreRoundPage } from './pages/ScoreRoundPage';
import { WeekPage } from './pages/WeekPage';
import { StandingsPage } from './pages/StandingsPage';
import { SignInPage } from './pages/SignInPage';
import { DemoPage } from './pages/DemoPage';

function RequireUser({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const auth = useAuthState();
  useEffect(prefetchPages, []);
  const path = useLocation().pathname;
  // The clubhouse TV is a full-screen page with no app chrome and no sign-in.
  if (path.startsWith('/tv/')) {
    return <ErrorBoundary resetKey={path}><Suspense fallback={null}><Routes><Route path="/tv/:token" element={<TvPage />} /></Routes></Suspense></ErrorBoundary>;
  }
  return (
    <AuthContext.Provider value={auth}>
      <Header />
      <main>
        <ErrorBoundary resetKey={path}>
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={auth.loading ? <PageSkeleton /> : auth.user ? <Navigate to="/leagues" replace /> : <SignInPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/join/:token" element={<JoinInvitePage />} />
          <Route path="/rsvp/:token" element={<RsvpLinkPage />} />
          <Route path="/pilot/:code" element={<PilotPage />} />
          <Route path="/leagues" element={<RequireUser><LeaguesPage /></RequireUser>} />
          <Route path="/staff" element={<RequireUser><StaffPage /></RequireUser>} />
          <Route path="/l/:slug" element={<RequireUser><LeagueLayout /></RequireUser>}>
            <Route index element={<OverviewPage />} />
            <Route path="play" element={<PlayPage />} />
            <Route path="week/:eventId" element={<WeekPage />} />
            <Route path="round/:roundId" element={<ScoreRoundPage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="awards" element={<AwardsPage />} />
            <Route path="player/:playerId" element={<PlayerPage />} />
            <Route path="setup" element={<SetupServicePage />} />
            <Route path="start" element={<SetupWizardPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="live" element={<LivePage />} />
            <Route path="live/:eventId" element={<LivePage />} />
            <Route path="roster" element={<RosterPage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="more" element={<MorePage />} />
          </Route>
          <Route path="/help" element={<HelpPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/lessons/:id" element={<LessonPage />} />
          <Route path="/feedback" element={<RequireUser><FeedbackPage /></RequireUser>} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/courses" element={<ForCoursesPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refunds" element={<RefundsPage />} />
          <Route path="*" element={<div className="page"><h1>Page not found</h1></div>} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
        <SiteFooter />
      </main>
      <HelpButton />
    </AuthContext.Provider>
  );
}

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { PageSkeleton } from './components/ui';
import { SiteFooter } from './components/SiteFooter';
import { PricingPage, PrivacyPage, RefundsPage, TermsPage } from './pages/LegalPages';
import { AuthContext, useAuth, useAuthState } from './lib/hooks';
import { CoursesPage } from './pages/CoursesPage';
import { JoinInvitePage } from './pages/JoinInvitePage';
import { LeagueLayout } from './pages/LeagueLayout';
import { LivePage } from './pages/LivePage';
import { MorePage } from './pages/MorePage';
import { LeaguesPage } from './pages/LeaguesPage';
import { OverviewPage } from './pages/OverviewPage';
import { PilotPage } from './pages/PilotPage';
import { PlayPage } from './pages/PlayPage';
import { ScoreRoundPage } from './pages/ScoreRoundPage';
import { WeekPage } from './pages/WeekPage';
import { RosterPage } from './pages/RosterPage';
import { RsvpLinkPage } from './pages/RsvpLinkPage';
import { SettingsPage } from './pages/SettingsPage';
import { StandingsPage } from './pages/StandingsPage';
import { AwardsPage } from './pages/AwardsPage';
import { PlayerPage } from './pages/PlayerPage';
import { SetupServicePage } from './pages/SetupServicePage';
import { ImportPage } from './pages/ImportPage';
import { StaffPage } from './pages/StaffPage';
import { SignInPage } from './pages/SignInPage';
import { TvPage } from './pages/TvPage';

function RequireUser({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const auth = useAuthState();
  // The clubhouse TV is a full-screen page with no app chrome and no sign-in.
  if (useLocation().pathname.startsWith('/tv/')) {
    return <Routes><Route path="/tv/:token" element={<TvPage />} /></Routes>;
  }
  return (
    <AuthContext.Provider value={auth}>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={auth.loading ? <PageSkeleton /> : auth.user ? <Navigate to="/leagues" replace /> : <SignInPage />} />
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
            <Route path="import" element={<ImportPage />} />
            <Route path="live" element={<LivePage />} />
            <Route path="live/:eventId" element={<LivePage />} />
            <Route path="roster" element={<RosterPage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="more" element={<MorePage />} />
          </Route>
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refunds" element={<RefundsPage />} />
          <Route path="*" element={<div className="page"><h1>Page not found</h1></div>} />
        </Routes>
        <SiteFooter />
      </main>
    </AuthContext.Provider>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorText, PageSkeleton } from '../components/ui';
import { friendlyError } from '../lib/api';
import { api } from '../lib/backend';
import { useAuth } from '../lib/hooks';
import { SignInForm } from './SignInPage';

/** Landing page for an invite link: sign in if needed, then join automatically. */
export function JoinInvitePage() {
  const { token = '' } = useParams();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!user || started.current) return;
    started.current = true;
    (async () => {
      try {
        const leagueId = await api.acceptInvite(token);
        const mine = await api.myLeagues();
        const l = mine.find((x) => x.id === leagueId);
        nav(l ? `/l/${l.slug}` : '/leagues', { replace: true });
      } catch (e) {
        setError(friendlyError(e));
      }
    })();
  }, [user, token, nav]);

  if (loading) return <PageSkeleton />;
  return (
    <div className="page narrow">
      <h1>You're invited to a league</h1>
      {!user && (
        <>
          <p className="muted">Sign in with your email to join. It takes a few seconds and there's no password.</p>
          <SignInForm redirectTo={window.location.href} cta="Send link and join" />
        </>
      )}
      {user && !error && <p className="muted">Joining…</p>}
      {error && (
        <>
          <ErrorText>{error}</ErrorText>
          <button className="btn" onClick={() => nav('/leagues')}>Go to your leagues</button>
        </>
      )}
    </div>
  );
}

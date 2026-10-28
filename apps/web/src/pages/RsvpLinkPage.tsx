import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ErrorText, PageSkeleton } from '../components/ui';
import { friendlyError } from '../lib/api';
import { api } from '../lib/backend';
import { fmtDate } from '../lib/scoring';
import type { RsvpLinkInfo } from '../lib/types';

type Answer = 'in' | 'out' | 'stop';
const asAnswer = (a: string | null): Answer | null => (a === 'in' || a === 'out' || a === 'stop' ? a : null);

/** One-tap answer from an "Are you playing?" email: no sign-in, just this golfer and week. */
export function RsvpLinkPage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const [info, setInfo] = useState<RsvpLinkInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function answer(a: Answer | null) {
    setBusy(true);
    setError(null);
    try {
      setInfo(await api.rsvpByLink(token, a));
    } catch (e) {
      setError(friendlyError(e));
      // Still show the week (e.g. it already started).
      setInfo(await api.rsvpByLink(token, null).catch(() => null));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void answer(asAnswer(params.get('a')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (info === undefined) return <PageSkeleton />;
  if (info === null) {
    return (
      <div className="page narrow stack">
        <h1>This link isn't valid any more</h1>
        <p className="muted">Answer in the app instead.</p>
        <div><Link className="btn btn-primary" to="/">Open GolfScoreHQ</Link></div>
      </div>
    );
  }

  const first = info.playerName.split(' ')[0];
  const heading = info.status === 'in' ? `You're in, ${first}.` : info.status === 'out' ? `You're out this week, ${first}.` : `Are you playing, ${first}?`;
  return (
    <div className="page narrow stack">
      <p className="small muted">{info.leagueName} · week {info.weekNumber}{info.eventDate ? ` · ${fmtDate(info.eventDate)}` : ''}</p>
      <h1>{heading}</h1>
      {info.status === 'in' && <p className="muted">Need a partner or a match? Join a group on the tee sheet.</p>}
      {info.status === 'out' && <p className="muted">Thanks for letting everyone know.</p>}
      {info.open ? (
        <div className="row wrap">
          <button className={`btn ${info.status === 'in' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => answer('in')}>I'm in</button>
          <button className={`btn ${info.status === 'out' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => answer('out')}>I'm out</button>
        </div>
      ) : (
        <p className="muted">This week has already started, so answers are closed.</p>
      )}
      <ErrorText>{error}</ErrorText>
      <div><Link className="btn btn-ghost" to={`/l/${info.leagueSlug}/week/${info.eventId}`}>Open the tee sheet</Link></div>
      <p className="small muted">
        {info.remindersOff
          ? "You won't get these reminder emails any more."
          : <>Don't want these reminders? <button type="button" className="linkish" disabled={busy} onClick={() => answer('stop')}>Stop them</button></>}
      </p>
    </div>
  );
}

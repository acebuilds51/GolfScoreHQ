import { useState } from 'react';
import { api } from '../lib/backend';
import { useAction, useAuth } from '../lib/hooks';
import { isScramble } from '../lib/scoring';
import type { Layout, LeagueEvent, Player, RoundData, Season } from '../lib/types';
import { ErrorText } from './ui';

/**
 * GHIN doesn't let apps post scores without a USGA license (see docs/ghin.md),
 * so "Post to GHIN" opens GHIN with the round written out beside the button.
 * On a phone with the GHIN app, the link may open the app instead.
 */
export const GHIN_URL = 'https://www.ghin.com/login';

/** Home: a golfer's own GHIN number, which turns on "Post to GHIN" after their rounds. */
export function MyGhin({ players }: { players: Player[] }) {
  const { user } = useAuth();
  const mine = players.find((p) => p.active && p.userId && p.userId === user?.id);
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const { busy, error, setError, run } = useAction();
  if (!mine) return null;
  const ghin = saved === undefined ? mine.ghinNumber : saved;

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>GHIN</h2>
        {!open && <button className="btn btn-ghost btn-sm" onClick={() => { setValue(ghin ?? ''); setOpen(true); }}>{ghin ? 'Change' : 'Add'}</button>}
      </div>
      {!open && <p className="small muted">{ghin
        ? <>Your GHIN number: <strong>{ghin}</strong>. After each round, the week page has a <strong>Post to GHIN</strong> button with your score.</>
        : 'Post your scores to GHIN? Add your GHIN number and the week page gives you a Post to GHIN button with your score after each round.'}</p>}
      {open && (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          const g = value.replace(/\D/g, '') || null;
          if (g && !/^[0-9]{5,10}$/.test(g)) return setError('A GHIN number is 5 to 10 digits.');
          const ok = await run(async () => { await api.setMyGhin(mine.id, g); return true; });
          if (ok) { setSaved(g); setOpen(false); }
        }}>
          <label>GHIN number<input inputMode="numeric" value={value} onChange={(e) => { setValue(e.target.value.replace(/\D/g, '')); setError(null); }} placeholder="On your GHIN card or in the GHIN app" /></label>
          <div className="row">
            <button className="btn btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <ErrorText>{error}</ErrorText>
        </form>
      )}
    </section>
  );
}

/** Your round, ready to post: hole by hole and the total. Null until every hole has a score. */
export function ghinRound(round: RoundData, playerId: string, layout: Layout) {
  const scores = round.scores[playerId] ?? {};
  const holes = layout.holes.map((h) => ({ number: h.number, par: h.par, strokes: scores[h.number] ?? null }));
  if (holes.some((h) => h.strokes == null)) return null;
  return { holes, total: holes.reduce((n, h) => n + h.strokes!, 0) };
}

/** Week page: "Post to GHIN" for the signed-in golfer once their round is finished. */
export function PostToGhin({ event, season, layout, rounds, players }: { event: LeagueEvent; season: Season; layout: Layout & { courseName: string }; rounds: RoundData[]; players: Player[] }) {
  const { user } = useAuth();
  const mine = players.find((p) => p.userId && p.userId === user?.id);
  // Team scrambles can't be posted for handicaps.
  if (!mine?.ghinNumber || isScramble(season.rules) || event.status === 'rainout') return null;
  const round = rounds.find((r) => r.players.some((p) => p.playerId === mine.id));
  const card = round && ghinRound(round, mine.id, layout);
  if (!card) return null;
  const today = event.eventDate === new Date().toLocaleDateString('en-CA');

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Post to GHIN</h2>
        <a className="btn btn-primary btn-sm" href={GHIN_URL} target="_blank" rel="noreferrer">Open GHIN</a>
      </div>
      <p className="small">
        {layout.courseName} · {layout.name}{layout.tees ? ` · ${layout.tees} tees` : ''} · {card.holes.length} holes · <strong>{card.total}</strong>
      </p>
      <div className="scroll-x">
        <table className="money ghin-card">
          <tbody>
            <tr><th>Hole</th>{card.holes.map((h) => <td key={h.number}>{h.number}</td>)}</tr>
            <tr><th>Par</th>{card.holes.map((h) => <td key={h.number} className="muted">{h.par}</td>)}</tr>
            <tr><th>You</th>{card.holes.map((h) => <td key={h.number}><strong>{h.strokes}</strong></td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Sign in to GHIN and post it hole by hole. {today ? 'GHIN asks for rounds by midnight tonight.' : 'GHIN asks for rounds the day they’re played, so post it as soon as you can.'}
      </p>
    </section>
  );
}

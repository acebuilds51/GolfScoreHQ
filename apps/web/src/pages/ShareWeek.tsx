import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { brandLogo } from '../lib/brand';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { buildWeekRecap } from '../lib/recap';
import { drawResultsCard, drawWinnerCard, resultsModel, saveImage, shareImage, winnerModel, type CardBrand } from '../lib/shareCards';
import { isCommissioner, type Layout, type LeagueEvent, type RoundData, type Season } from '../lib/types';

const canShareFiles = () => {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    return !!nav.canShare?.({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
};

/** After a week is final: pictures to post. The commissioner shares the whole league's results; anyone can share the winner card. */
export function ShareWeek({ event, season, layout, rounds, names }: {
  event: LeagueEvent; season: Season; layout: Layout & { courseName?: string | null }; rounds: RoundData[]; names: Map<string, string>;
}) {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const [withMoney, setWithMoney] = useState(false);
  const [picture, setPicture] = useState<{ blob: Blob; url: string; file: string; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const phoneShare = useMemo(canShareFiles, []);

  const data = useAsync(async () => {
    const [events, seasonLedger] = await Promise.all([api.events(season.id), api.seasonLedger(season.id)]);
    const upTo = new Set(events.filter((e) => e.status === 'settled' && e.weekNumber <= event.weekNumber).map((e) => e.id));
    const weekLedger = seasonLedger.filter((e) => e.eventId === event.id);
    const { recap } = buildWeekRecap({
      leagueName: league.name, event, season, layout, rounds,
      players: [...names].map(([id, displayName]) => ({ id, displayName })),
      weekLedger, seasonLedger: seasonLedger.filter((e) => upTo.has(e.eventId)),
    });
    const ctpCents: Record<number, number> = {};
    for (const e of weekLedger) if (e.kind === 'ctp' && e.holeNumber) ctpCents[e.holeNumber] = (ctpCents[e.holeNumber] ?? 0) + e.amountCents;
    return { recap, ctpCents };
  }, [event.id, event.status, rounds]);

  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url); }, [picture]);

  const branded = league.features.includes('branding');
  const brand: CardBrand = {
    leagueName: league.name,
    color: (branded && league.brandColor) || '#14365c',
    accent: (branded && league.accentColor) || '#1d9e75',
    logoUrl: brandLogo(league),
  };
  const week = { weekNumber: event.weekNumber, courseName: layout.courseName ?? null };
  const name = (id: string) => names.get(id) ?? '?';
  const slug = league.slug.replace(/[^a-z0-9-]/g, '');
  const winner = data.data ? winnerModel(data.data.recap, name) : null;

  async function make(kind: 'results' | 'winner') {
    if (!data.data) return;
    setNote(null);
    const blob = await run(() =>
      kind === 'results'
        ? drawResultsCard(resultsModel(data.data!.recap, name, { includeMoney: withMoney, ctpCents: data.data!.ctpCents }), brand, week)
        : drawWinnerCard(winner!, brand, week),
    );
    if (!blob) return;
    if (picture) URL.revokeObjectURL(picture.url);
    setPicture({
      blob,
      url: URL.createObjectURL(blob),
      file: `${slug}-week-${event.weekNumber}-${kind}.png`,
      text: kind === 'results' ? `${league.name}: week ${event.weekNumber} results` : `${winner!.name}: low round in week ${event.weekNumber}`,
    });
  }

  if (data.error) return null;
  return (
    <div className="stack share-week">
      <h3>Share the week</h3>
      <div className="row wrap">
        {commish && (
          <button className="btn btn-primary" disabled={busy || !data.data} onClick={() => make('results')}>
            <Icon name="share" size={18} /> League results
          </button>
        )}
        {winner && (
          <button className="btn" disabled={busy || !data.data} onClick={() => make('winner')}>
            <Icon name="trophy" size={18} /> Winner card
          </button>
        )}
      </div>
      {commish && (
        <label className="check-row small">
          <input type="checkbox" checked={withMoney} onChange={(e) => setWithMoney(e.target.checked)} />
          Show money amounts on the league results picture
        </label>
      )}
      {commish && <p className="small muted">Made for Facebook and group chats. Money stays off unless you turn it on.</p>}
      <ErrorText>{error}</ErrorText>

      {picture && (
        <div className="share-preview stack">
          <img src={picture.url} alt="Picture to share" />
          <div className="row wrap">
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await shareImage(picture.blob, picture.file, picture.text);
                setNote(r === 'saved' ? 'Saved. Add it to a Facebook post from your photos or downloads.' : r === 'shared' ? 'Shared.' : null);
              }}
            >
              <Icon name="share" size={18} /> {phoneShare ? 'Share' : 'Save picture'}
            </button>
            {phoneShare && (
              <button className="btn" onClick={() => { saveImage(picture.blob, picture.file); setNote('Saved.'); }}>
                <Icon name="download" size={18} /> Save
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setPicture(null)}>Close</button>
          </div>
          {note && <p className="small good">{note}</p>}
        </div>
      )}
    </div>
  );
}

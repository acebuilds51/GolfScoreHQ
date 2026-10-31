import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/backend';
import { useAsync, useLeague } from '../lib/hooks';
import { PRO_FEATURES, type ProFeature } from '../lib/plans';
import { ProPerks, UpgradeOffer } from './UpgradeCard';

/**
 * What a tapped "Pro" badge opens, over the page: what that feature does, then the same offer as the
 * Home card (golfers can say they'd chip in, commissioners go to the plan).
 */
export function ProSheet({ feature, onClose }: { feature?: ProFeature; onClose: () => void }) {
  const { league } = useLeague();
  const players = useAsync(() => api.players(league.id), [league.id]);
  const golfers = players.data ? players.data.filter((p) => p.active && !p.isSub).length : null;
  const f = feature ? PRO_FEATURES[feature] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Over everything, and outside any label or form the badge sits in.
  return createPortal(
    <div className="help-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="help-sheet stack pro-sheet" role="dialog" aria-modal="true" aria-labelledby="pro-sheet-title">
        <div className="row between">
          <div className="row" style={{ gap: 8 }}>
            <h2 id="pro-sheet-title">{f ? f.name : 'That comes with Pro'}</h2>
            <span className="badge badge-pro">Pro</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm help-sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p>{f && <>{f.what} </>}<strong className="teaser-pro">You get that with Pro!</strong></p>
        <ProPerks />
        <UpgradeOffer golfers={golfers} onLeave={onClose} more={<button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>} />
      </div>
    </div>,
    document.body,
  );
}

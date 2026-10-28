import { useSearchParams } from 'react-router-dom';
import { useLeague } from '../lib/hooks';
import type { Season } from '../lib/types';
import { ProLock } from './ui';

export const seasonLabel = (s: Season) => s.name || `${s.year} season`;

/** Switch between this season and past ones (Pro). Hidden while there's only one season. */
export function SeasonPicker({ seasons, current }: { seasons: Season[]; current: Season }) {
  const { league } = useLeague();
  const [params, setParams] = useSearchParams();
  if (seasons.length < 2) return null;
  if (!league.features.includes('history')) {
    return <span className="small muted row" style={{ gap: 6 }}>Past seasons <ProLock /></span>;
  }
  return (
    <select aria-label="Season" value={current.id} onChange={(e) => {
      const next = new URLSearchParams(params);
      if (e.target.value === seasons[0]!.id) next.delete('season');
      else next.set('season', e.target.value);
      setParams(next, { replace: true });
    }}>
      {seasons.map((s, i) => <option key={s.id} value={s.id}>{seasonLabel(s)}{i === 0 ? ' (current)' : ''}</option>)}
    </select>
  );
}

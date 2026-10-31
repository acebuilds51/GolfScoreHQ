import { useContext, useState, type ReactNode } from 'react';
import { LeagueContext } from '../lib/hooks';
import type { ProFeature } from '../lib/plans';
import type { Plan } from '../lib/types';
import { ProSheet } from './ProSheet';

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="error" role="alert">{children}</p> : null;
}

/** The 'club' plan is sold as the Course plan. */
export const PLAN_LABEL: Record<Plan, string> = { free: 'Free', pro: 'Pro', club: 'Course', pilot: 'Pilot', comp: 'Complimentary' };

export function PlanBadge({ plan }: { plan: Plan }) {
  return <span className={`badge ${plan === 'free' ? 'badge-neutral' : 'badge-pro'}`}>{PLAN_LABEL[plan]}</span>;
}

/**
 * The "Pro" badge on a locked feature. In a free league it's a button: tapping it says what the
 * feature does and offers Pro (golfers can say they'd chip in). Anywhere else it's just a label.
 */
export function ProLock({ label = 'Pro', feature }: { label?: string; feature?: ProFeature }) {
  const ctx = useContext(LeagueContext);
  const [open, setOpen] = useState(false);
  if (ctx?.league.effectivePlan !== 'free') return <span className="badge badge-pro" title="Included with GolfScoreHQ Pro">{label}</span>;
  return (
    <>
      <button
        type="button"
        className="badge badge-pro pro-tap"
        aria-haspopup="dialog"
        aria-label={`${label}: what you get with Pro`}
        // It can sit inside a format's <label>: don't let the tap pick that format.
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
      >
        {label} <span aria-hidden="true">›</span>
      </button>
      {open && <ProSheet feature={feature} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A link with a copy button; falls back to selecting the text if the clipboard is blocked. */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      {label && <span className="small muted">{label}</span>}
      <div className="row">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label ?? 'Link'} />
        <button
          className="btn btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        {typeof navigator.share === 'function' && (
          <button className="btn btn-sm btn-ghost" onClick={() => navigator.share({ url: value }).catch(() => {})}>
            Share
          </button>
        )}
      </div>
    </div>
  );
}

/** Gray shapes shown while a page loads, so it feels instant instead of saying "Loading…". */
export function PageSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="page stack" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 28, width: '45%' }} />
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="card stack">
          <div className="skel" style={{ height: 18, width: '35%' }} />
          <div className="skel" style={{ height: 14 }} />
          <div className="skel" style={{ height: 14, width: '80%' }} />
          <div className="skel" style={{ height: 14, width: '60%' }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import type { Plan } from '../lib/types';

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="error" role="alert">{children}</p> : null;
}

const PLAN_LABEL: Record<Plan, string> = { free: 'Free', pro: 'Pro', club: 'Club', pilot: 'Pilot', comp: 'Complimentary' };

export function PlanBadge({ plan }: { plan: Plan }) {
  return <span className={`badge ${plan === 'free' ? 'badge-neutral' : 'badge-pro'}`}>{PLAN_LABEL[plan]}</span>;
}

export function ProLock({ label = 'Pro' }: { label?: string }) {
  return <span className="badge badge-pro" title="Included with GolfScoreHQ Pro">{label}</span>;
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

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

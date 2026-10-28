import { Component, type ReactNode } from 'react';
import { reportProblem } from '../lib/diagnostics';

/**
 * A page that crashes shows a friendly message with a way back instead of a
 * blank screen, and the crash is reported to staff. `resetKey` (the page's
 * address) clears it when the person goes somewhere else.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean; key?: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { failed: boolean; key?: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportProblem('error', error.message || 'A page crashed', `${error.stack ?? ''}\n${info.componentStack ?? ''}`.trim());
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page narrow stack">
        <section className="card stack">
          <h2>Something went wrong on this page</h2>
          <p className="muted">We've been told about it automatically. Your scores and settings are safe.</p>
          <div className="row wrap">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
            <a className="btn" href="/leagues">Your leagues</a>
          </div>
        </section>
      </div>
    );
  }
}

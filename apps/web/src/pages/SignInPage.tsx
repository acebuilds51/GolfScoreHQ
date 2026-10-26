import { useState } from 'react';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction } from '../lib/hooks';

/** Email sign-in. `redirectTo` brings the golfer back (e.g. to an invite link) after they tap the emailed link. */
export function SignInForm({ redirectTo, cta = 'Send sign-in link' }: { redirectTo?: string; cta?: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, setError, run } = useAction();

  if (sent) {
    return (
      <div className="card">
        <h3>Check your email</h3>
        <p className="muted">We sent a sign-in link to {email}. Open it on this device to continue.</p>
        <button className="btn btn-ghost btn-sm" onClick={() => setSent(false)}>Use a different email</button>
      </div>
    );
  }
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          setError('Enter a valid email address.');
          return;
        }
        const r = await run(() => api.signIn(email.trim(), redirectTo ?? window.location.origin + '/leagues'));
        if (r === 'link-sent') setSent(true);
      }}
    >
      <label>
        Email
        <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
      </label>
      <ErrorText>{error}</ErrorText>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : api.mode === 'demo' ? 'Sign in' : cta}</button>
      {api.mode === 'demo' && <p className="small muted">Demo mode: use any email. You're signed in right away.</p>}
    </form>
  );
}

export function SignInPage() {
  return (
    <div className="page narrow">
      <section className="hero">
        <h1>Run your golf league from your phone</h1>
        <p className="lead">Live scoring, standings, skins, closest to the pin and who owes what, set up for your league's rules.</p>
        <ul className="ticks">
          <li>Unlimited golfers on every plan</li>
          <li>Golfers don't need an account to be on the roster</li>
          <li>Free to start. Pro adds side games, money and more.</li>
        </ul>
      </section>
      <SignInForm />
    </div>
  );
}

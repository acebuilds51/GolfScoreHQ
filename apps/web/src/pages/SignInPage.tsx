import { useState } from 'react';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction } from '../lib/hooks';

/**
 * Email sign-in. The email has a code to type here (works inside the iPhone
 * home-screen app) and a link (works in a browser). `redirectTo` brings the
 * golfer back, e.g. to an invite link, after they tap the link.
 */
export function SignInForm({ redirectTo, cta = 'Email me a sign-in code' }: { redirectTo?: string; cta?: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const { busy, error, setError, run } = useAction();
  const send = () => run(() => api.signIn(email.trim(), redirectTo ?? window.location.origin + '/leagues'));

  if (sent) {
    const digits = code.replace(/\D/g, '');
    return (
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (digits.length < 6) return setError('Enter the code from the email.');
          // Signing in updates the app everywhere; pages move on by themselves.
          await run(() => api.verifyCode(email.trim(), digits));
        }}
      >
        <h3>Check your email</h3>
        <p className="muted">We sent a code to <strong>{email}</strong>. Type it here.</p>
        <label>
          Sign-in code
          <input
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            placeholder="123456"
            value={code}
            autoFocus
            onChange={(e) => { setCode(e.target.value); setError(null); }}
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
        <p className="small muted">On a computer you can also open the link in the email instead.</p>
        <div className="row wrap">
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { setCode(''); if (await send()) setError(null); }}>Send a new code</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSent(false); setCode(''); setError(null); }}>Use a different email</button>
        </div>
      </form>
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
        const r = await send();
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

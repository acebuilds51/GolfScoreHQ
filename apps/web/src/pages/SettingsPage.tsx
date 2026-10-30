import { useEffect, useState } from 'react';
import { CopyField, ErrorText, PLAN_LABEL, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { brandBanner, brandLogo, brandStyle, PALETTES, parseHex, resizeBanner, resizeLogo } from '../lib/brand';
import type { DemoApi } from '../lib/demoApi';
import { useAction, useAsync, useAuth, useLeague } from '../lib/hooks';
import { isCommissioner, type PaymentHandles, type Plan, type Role, type TvDisplay, type TvPanel, type TvSettings, type TvSponsor } from '../lib/types';
import { randomJoinCode } from '../lib/util';
import { PlanSection } from './PlanSection';
import { ContactSharing } from './RosterPage';

export function SettingsPage() {
  const { league, reloadLeague } = useLeague();
  // Bumped when a join request is approved so the member list refreshes.
  const [membersVersion, setMembersVersion] = useState(0);
  if (!isCommissioner(league.role)) return <div className="page"><p className="muted">Only commissioners can change league settings.</p></div>;
  return (
    <div className="page stack">
      <PlanSection />
      <LeagueName />
      <LeagueLook />
      <JoinCode />
      <JoinRequests onApproved={() => setMembersVersion((v) => v + 1)} />
      <Members version={membersVersion} />
      <PaymentLinks />
      <GolfersSee />
      <Reminders />
      <ClubhouseTv />
      {api.mode === 'demo' && <DemoPlan onChanged={reloadLeague} />}
    </div>
  );
}

function LeagueName() {
  const { league, reloadLeague } = useLeague();
  const [name, setName] = useState(league.name);
  const { busy, error, setError, run } = useAction();
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setError('Enter a league name.');
        const ok = await run(async () => { await api.updateLeague(league.id, { name: name.trim() }); return true; });
        if (ok) reloadLeague();
      }}
    >
      <h2>League name</h2>
      <div className="row">
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
        <button className="btn" disabled={busy || name.trim() === league.name}>Save</button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** Branding (Pro): logo and colors, used in the app, on Clubhouse TV and in recap emails. */
function LeagueLook() {
  const { league, reloadLeague } = useLeague();
  const allowed = league.features.includes('branding');
  const [colors, setColors] = useState<{ brand: string | null; accent: string | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const logoAction = useAction();
  const colorAction = useAction();
  const current = colors ?? { brand: league.brandColor, accent: league.accentColor };
  const changed = !!colors && (colors.brand !== league.brandColor || colors.accent !== league.accentColor);
  const pick = (brand: string | null, accent: string | null) => { setColors({ brand, accent }); setSaved(false); };
  const preview = brandStyle({ features: ['branding'], brandColor: current.brand, accentColor: current.accent });
  const logo = brandLogo(league);
  const banner = brandBanner(league);
  const bannerAction = useAction();

  async function onFile(file: File | undefined) {
    if (!file) return;
    const ok = await logoAction.run(async () => { await api.uploadLogo(league.id, await resizeLogo(file)); return true; });
    if (ok) reloadLeague();
  }

  return (
    <section className="card stack">
      <div className="row between">
        <h2>League look</h2>
        {!allowed && <ProLock />}
      </div>
      <p className="small muted">Your logo and colors show at the top of your league's pages, on Clubhouse TV and in the weekly recap email.</p>

      <div className="row wrap">
        <div className="logo-box">{logo ? <img src={logo} alt="League logo" /> : <span className="muted small">No logo</span>}</div>
        <div className="logo-actions">
          <label className={`btn btn-sm${!allowed || logoAction.busy ? ' disabled' : ''}`}>
            {logoAction.busy ? 'Uploading…' : logo ? 'Change logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={!allowed || logoAction.busy}
              onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
          {logo && (
            <button className="btn btn-ghost btn-sm" disabled={logoAction.busy} onClick={async () => { const ok = await logoAction.run(async () => { await api.removeLogo(league.id); return true; }); if (ok) reloadLeague(); }}>
              Remove logo
            </button>
          )}
          <span className="small muted">PNG or JPG. A square logo on a clear or white background looks best.</span>
        </div>
      </div>
      <ErrorText>{logoAction.error}</ErrorText>

      <div className="stack">
        <strong className="small">Course photo</strong>
        <div className="banner-box" style={banner ? { backgroundImage: `url("${banner}")` } : undefined}>
          {!banner && <span className="muted small">No photo</span>}
        </div>
        <div className="row wrap">
          <label className={`btn btn-sm${!allowed || bannerAction.busy ? ' disabled' : ''}`}>
            {bannerAction.busy ? 'Uploading…' : banner ? 'Change photo' : 'Upload a course photo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={!allowed || bannerAction.busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const ok = await bannerAction.run(async () => { await api.uploadBanner(league.id, await resizeBanner(file)); return true; });
                if (ok) reloadLeague();
              }}
            />
          </label>
          {banner && (
            <button className="btn btn-ghost btn-sm" disabled={bannerAction.busy} onClick={async () => { const ok = await bannerAction.run(async () => { await api.removeBanner(league.id); return true; }); if (ok) reloadLeague(); }}>
              Remove photo
            </button>
          )}
        </div>
        <span className="small muted">Shows behind your league's name. A wide shot of the course or clubhouse works best.</span>
        <ErrorText>{bannerAction.error}</ErrorText>
      </div>

      <div className="stack">
        <strong>Your colors</strong>
        <p className="small muted">Pick any two colors: tap a box to choose, or type your club's color code.</p>
        <div className="grid two color-fields">
          <ColorField
            label="Main color"
            hint="Header, buttons, hole numbers"
            value={current.brand}
            fallback="#14365c"
            disabled={!allowed}
            onChange={(c) => pick(c, current.accent)}
          />
          <ColorField
            label="Accent color"
            hint="Tab underline, TV and email trim"
            value={current.accent}
            fallback="#1d9e75"
            disabled={!allowed}
            onChange={(c) => pick(current.brand, c)}
          />
        </div>
        {(current.brand || current.accent) && (
          <div><button type="button" className="btn btn-ghost btn-sm" disabled={!allowed} onClick={() => pick(null, null)}>Go back to GolfScoreHQ colors</button></div>
        )}
        <strong className="small">Or start from one of these</strong>
        <div className="palettes">
          {PALETTES.map((p) => (
            <button
              key={p.name}
              type="button"
              className={`palette${current.brand === p.brand && current.accent === p.accent ? ' on' : ''}`}
              disabled={!allowed}
              onClick={() => pick(p.brand, p.accent)}
            >
              <span className="swatch" style={{ background: p.brand }} />
              <span className="swatch" style={{ background: p.accent }} />
              <span className="small">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="brand-preview" style={preview} aria-label="Preview">
        <div className={current.brand ? 'league-band' : 'league-head'}>
          <div className="league-title">
            {logo && <img className="league-logo" src={logo} alt="" />}
            <strong>{league.name}</strong>
          </div>
        </div>
        <div className="row brand-preview-body">
          <span className="brand-preview-tab">Standings</span>
          <span className="btn btn-primary btn-sm" aria-hidden="true">Settle and post results</span>
          <span className="hole-num" aria-hidden="true">7</span>
        </div>
      </div>

      <div className="row">
        <button
          className="btn btn-primary"
          disabled={!allowed || !changed || colorAction.busy}
          onClick={async () => {
            const ok = await colorAction.run(async () => { await api.updateLeague(league.id, { brandColor: current.brand, accentColor: current.accent }); return true; });
            if (ok) { setColors(null); setSaved(true); reloadLeague(); }
          }}
        >
          Save colors
        </button>
        {saved && <span className="small good">Saved ✓</span>}
      </div>
      <ErrorText>{colorAction.error}</ErrorText>
    </section>
  );
}

/** A color picker plus a box for typing an exact color code like #0B5D3B. */
function ColorField({ label, hint, value, fallback, disabled, onChange }: {
  label: string; hint: string; value: string | null; fallback: string; disabled: boolean; onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value ?? '');
  const [bad, setBad] = useState(false);
  // Follow changes made elsewhere (the picker, a ready-made pair, "go back"), not ones typed here.
  useEffect(() => {
    setText((t) => (parseHex(t) === value ? t : value ?? ''));
    setBad(false);
  }, [value]);
  const typed = (s: string) => {
    setText(s);
    setBad(false);
    const hex = parseHex(s);
    if (hex && s.replace(/[#\s]/g, '').length === 6) onChange(hex); // short codes wait for blur
  };
  const finished = () => {
    if (!text.trim()) return;
    const hex = parseHex(text);
    if (!hex) return setBad(true);
    setText(hex);
    onChange(hex);
  };
  return (
    <div className="color-field">
      <input
        type="color"
        aria-label={label}
        value={value ?? fallback}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
      <div className="stack">
        <label>
          {label}
          <input value={text} placeholder={fallback.toUpperCase()} maxLength={7} disabled={disabled} spellCheck={false} onChange={(e) => typed(e.target.value)} onBlur={finished} />
        </label>
        <span className={`small ${bad ? 'warn' : 'muted'}`}>{bad ? 'Use a 6-digit code like #0B5D3B' : hint}</span>
      </div>
    </div>
  );
}

function JoinCode() {
  const { league, reloadLeague } = useLeague();
  const { busy, error, run } = useAction();
  const setCode = async (code: string | null) => {
    const ok = await run(async () => { await api.updateLeague(league.id, { joinCode: code }); return true; });
    if (ok) reloadLeague();
  };
  return (
    <section className="card stack">
      <h2>League code</h2>
      <p className="small muted">Golfers can enter this code to ask to join. You approve each request below. For golfers already on your roster, an invite link from the Roster tab is quicker.</p>
      {league.joinCode ? (
        <>
          <div className="join-code" aria-label="League code">{league.joinCode}</div>
          <CopyField label="Message to send" value={`Join ${league.name} on GolfScoreHQ: go to ${window.location.origin}, sign in, and enter code ${league.joinCode}`} />
          <div className="row">
            <button className="btn btn-sm" disabled={busy} onClick={() => setCode(randomJoinCode())}>New code</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setCode(null)}>Turn off</button>
          </div>
        </>
      ) : (
        <div><button className="btn" disabled={busy} onClick={() => setCode(randomJoinCode())}>Create a code</button></div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function JoinRequests({ onApproved }: { onApproved: () => void }) {
  const { league } = useLeague();
  const reqs = useAsync(() => api.joinRequests(league.id), [league.id]);
  const { busy, error, run } = useAction();
  if (!reqs.data?.length) return null;
  return (
    <section className="card flush">
      <h2 className="pad">Requests to join <span className="badge badge-pro">{reqs.data.length}</span></h2>
      <ul className="list">
        {reqs.data.map((r) => (
          <li key={r.userId} className="list-row">
            <div className="grow">
              <strong>{r.name ?? r.email ?? 'Someone'}</strong>
              <div className="small muted">{[r.name ? r.email : null, r.message].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="row actions">
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(() => api.decideJoinRequest(league.id, r.userId, true)); reqs.reload(); onApproved(); }}>Approve</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await run(() => api.decideJoinRequest(league.id, r.userId, false)); reqs.reload(); }}>Decline</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="pad"><ErrorText>{error}</ErrorText></div>
    </section>
  );
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'player', label: 'Golfer' },
  { value: 'scorer', label: 'Scorer' },
  { value: 'commissioner', label: 'Co-commissioner' },
];

function Members({ version }: { version: number }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const members = useAsync(() => api.members(league.id), [league.id, version]);
  const { busy, error, run } = useAction();
  const canCoCommish = league.features.includes('co_commissioners');
  return (
    <section className="card flush">
      <div className="pad stack">
        <h2>Members</h2>
        <p className="small muted">People with an account in this league. Golfers who haven't joined yet are still on the roster and can be scored.</p>
      </div>
      <ul className="list">
        {members.data?.map((m) => (
          <li key={m.userId} className="list-row">
            <div className="grow">
              <strong>{m.playerName ?? 'Member without a roster spot'}</strong>
              {m.userId === user?.id && <span className="small muted"> (you)</span>}
            </div>
            {m.role === 'owner' ? (
              <span className="small muted">Owner</span>
            ) : (
              <select
                aria-label={`Role for ${m.playerName ?? 'member'}`}
                value={m.role}
                disabled={busy}
                onChange={async (e) => { await run(() => api.setMemberRole(league.id, m.userId, e.target.value as Role)); members.reload(); }}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.value === 'commissioner' && !canCoCommish && m.role !== 'commissioner'}>
                    {o.label}{o.value === 'commissioner' && !canCoCommish ? ' (Pro)' : ''}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      <div className="pad stack">
        {!canCoCommish && <p className="small muted"><ProLock /> Co-commissioners come with Pro.</p>}
        <ErrorText>{error}</ErrorText>
      </div>
    </section>
  );
}

/** Venmo / PayPal / Zelle handles. Shown to golfers who owe money in the recap email; the app never moves money. */
function PaymentLinks() {
  const { league } = useLeague();
  const allowed = league.features.includes('payments');
  const saved = useAsync(() => api.paymentHandles(league.id), [league.id], { fresh: true });
  const [draft, setDraft] = useState<PaymentHandles | null>(null);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const h = draft ?? saved.data ?? { venmo: null, paypalMe: null, zelle: null };
  const set = (k: keyof PaymentHandles) => (e: React.ChangeEvent<HTMLInputElement>) => { setDraft({ ...h, [k]: e.target.value }); setDone(false); };
  const clean = (v: string | null) => v?.trim() || null;

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const next = {
          venmo: clean(h.venmo)?.replace(/^@?/, '@') ?? null,
          paypalMe: clean(h.paypalMe)?.replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '') ?? null,
          zelle: clean(h.zelle),
        };
        const ok = await run(async () => { await api.savePaymentHandles(league.id, next); return true; });
        if (ok) { setDraft(null); setDone(true); saved.reload(); }
      }}
    >
      <div className="row between">
        <h2>How golfers pay you</h2>
        {!allowed && <ProLock />}
      </div>
      <p className="small muted">
        Golfers who owe money get a tap-to-pay link in their weekly recap email, with the amount filled in. Money goes straight to you; GolfScoreHQ never holds it. Leave any of these blank.
      </p>
      <label>Venmo username<input value={h.venmo ?? ''} onChange={set('venmo')} placeholder="@your-venmo" disabled={!allowed} /></label>
      <label>PayPal.me name<input value={h.paypalMe ?? ''} onChange={set('paypalMe')} placeholder="yourname (from paypal.me/yourname)" disabled={!allowed} /></label>
      <label>Zelle email or phone<input value={h.zelle ?? ''} onChange={set('zelle')} placeholder="you@example.com or 248-555-0100" disabled={!allowed} /></label>
      <div className="row">
        <button className="btn" disabled={!allowed || busy || !draft}>Save</button>
        {done && <span className="small good">Saved ✓</span>}
      </div>
      <ErrorText>{error ?? saved.error}</ErrorText>
      <MatchMoneyChoice disabled={!allowed} />
    </form>
  );
}

/** Who handles match and press money: the golfers among themselves (OCBC), or the commissioner with the side games. */
function MatchMoneyChoice({ disabled }: { disabled: boolean }) {
  const { league, reloadLeague } = useLeague();
  const { busy, error, run } = useAction();
  const value = league.matchMoney ?? 'golfers';
  const pick = async (v: 'golfers' | 'commissioner') => { const ok = await run(async () => { await api.updateLeague(league.id, { matchMoney: v }); return true; }); if (ok) reloadLeague(); };
  return (
    <fieldset className="segmented stack" disabled={disabled || busy}>
      <legend className="small"><strong>Match and press money</strong></legend>
      <label className={value === 'golfers' ? 'on' : ''}><input type="radio" name="match-money" checked={value === 'golfers'} onChange={() => pick('golfers')} /> Golfers settle it with each other; the app shows who won and lost</label>
      <label className={value === 'commissioner' ? 'on' : ''}><input type="radio" name="match-money" checked={value === 'commissioner'} onChange={() => pick('commissioner')} /> It goes through you, with skins and closest to the pin</label>
      <p className="small muted">Skins, closest to the pin and prizes are always paid by you: each settled week has a Pay out list with Venmo and PayPal filled in. Season dues are on the Play page.</p>
      <ErrorText>{error}</ErrorText>
    </fieldset>
  );
}

/** "Are you playing?" email (Pro): how many days before league night, or off. */
function Reminders() {
  const { league, reloadLeague } = useLeague();
  const allowed = league.features.includes('rsvp');
  const { busy, error, run } = useAction();
  const days = league.rsvpReminderDays ?? null;
  return (
    <section className="card stack">
      <div className="row between">
        <h2>"Are you playing?" emails</h2>
        {!allowed && <ProLock />}
      </div>
      <p className="small muted">
        Golfers who haven't answered or joined a group get an email at 9 AM with one-tap "I'm in" and "I'm out" buttons (no sign-in needed) and a link to the tee sheet. Golfers can turn them off.
      </p>
      <label className="inline">
        Send it
        <select value={days ?? ''} disabled={!allowed || busy}
          onChange={async (e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            const ok = await run(async () => { await api.updateLeague(league.id, { rsvpReminderDays: v }); return true; });
            if (ok) reloadLeague();
          }}>
          <option value="">Off</option>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? 'The day before league night' : `${n} days before league night`}</option>)}
        </select>
      </label>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** What golfers can see: season money, and each other's phone numbers and emails. Commissioners always see everything. */
function GolfersSee() {
  const { league, reloadLeague } = useLeague();
  const { busy, error, run } = useAction();
  return (
    <section className="card stack" id="golfers-see">
      <h2>What golfers see</h2>
      <label className="check-row small">
        <input type="checkbox" checked={league.showMoney !== false} disabled={busy}
          onChange={async (e) => { const on = e.target.checked; const ok = await run(async () => { await api.updateLeague(league.id, { showMoney: on }); return true; }); if (ok) reloadLeague(); }} />
        Season money (the Money column on Standings, player pages, the money leader award and the recap email's season total)
      </label>
      <p className="small muted">Each week's results still show that week's money. Commissioners always see everything.</p>
      <ContactSharing />
      <ErrorText>{error}</ErrorText>
    </section>
  );
}


const TV_PANELS:{ key: TvPanel; label: string }[] = [
  { key: 'live', label: 'Leaderboard' }, { key: 'matches', label: 'Matches' }, { key: 'skins', label: 'Skins' },
  { key: 'ctp', label: 'Closest to the pin' }, { key: 'highlights', label: 'Highlights' }, { key: 'standings', label: 'Season standings' },
];
const DEFAULT_TV: TvSettings = { hideMoney: true, secondsPerPanel: 15, panels: TV_PANELS.map((p) => p.key) };

function ClubhouseTv() {
  const { league } = useLeague();
  const allowed = league.features.includes('tv_mode');
  const displays = useAsync(() => (allowed ? api.tvDisplays(league.id) : Promise.resolve([])), [league.id, allowed]);
  const [newLink, setNewLink] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  return (
    <section className="card stack">
      <div className="row between">
        <h2>Clubhouse TV</h2>
        {!allowed && <ProLock />}
      </div>
      <p className="small muted">
        Put the live leaderboard on a TV at the course. Open the link on a smart TV's browser, a Fire Stick, a Chromecast or a laptop plugged into the TV. No sign-in needed on the TV; the link only shows this league's scores.
      </p>
      {allowed && (
        <>
          {newLink && (
            <div className="subcard stack">
              <strong>Your new TV link</strong>
              <p className="small muted">Copy it now: for security it's only shown once. You can always make a new one.</p>
              <CopyField value={newLink} />
              <div><a className="btn btn-sm" href={newLink} target="_blank" rel="noreferrer">Open it here</a></div>
            </div>
          )}
          {displays.data?.map((d) => (
            <TvDisplayEditor key={d.id} display={d} onChanged={displays.reload} />
          ))}
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={async () => {
                const token = await run(() => api.createTvDisplay(league.id, displays.data?.length ? `Clubhouse TV ${displays.data.length + 1}` : 'Clubhouse TV', DEFAULT_TV));
                if (token) { setNewLink(`${window.location.origin}/tv/${token}`); displays.reload(); }
              }}
            >
              Create a TV link
            </button>
          </div>
        </>
      )}
      <ErrorText>{error ?? displays.error}</ErrorText>
    </section>
  );
}

function TvDisplayEditor({ display, onChanged }: { display: TvDisplay; onChanged: () => void }) {
  const { busy, error, run } = useAction();
  const save = async (settings: TvSettings) => { await run(() => api.updateTvDisplay(display.id, { settings })); onChanged(); };
  const s = display.settings;
  return (
    <div className="subcard stack">
      <div className="row between wrap">
        <strong>{display.name}</strong>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`Turn off ${display.name}? Any TV showing it stops updating.`)) return;
            await run(() => api.revokeTvDisplay(display.id));
            onChanged();
          }}
        >
          Turn off link
        </button>
      </div>
      <label className="check-row"><input type="checkbox" checked={s.hideMoney} disabled={busy} onChange={(e) => save({ ...s, hideMoney: e.target.checked })} /> Hide dollar amounts</label>
      <label className="inline">
        Seconds per screen
        <select value={s.secondsPerPanel} disabled={busy} onChange={(e) => save({ ...s, secondsPerPanel: Number(e.target.value) })}>
          {[8, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="row wrap">
        {TV_PANELS.map((p) => (
          <label key={p.key} className="check-row">
            <input
              type="checkbox"
              checked={s.panels.includes(p.key)}
              disabled={busy || (s.panels.length === 1 && s.panels.includes(p.key))}
              onChange={(e) => save({ ...s, panels: TV_PANELS.map((x) => x.key).filter((k) => (k === p.key ? e.target.checked : s.panels.includes(k))) })}
            />
            {p.label}
          </label>
        ))}
      </div>
      <TvSponsorEditor settings={s} busy={busy} save={save} />
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Course plan: a sponsor's screen in the TV rotation and a line along the bottom. */
function TvSponsorEditor({ settings, busy, save }: { settings: TvSettings; busy: boolean; save: (s: TvSettings) => Promise<void> }) {
  const { league } = useLeague();
  const club = league.features.includes('multi_league');
  const saved = settings.sponsor ?? null;
  const [draft, setDraft] = useState<TvSponsor>(saved ?? { name: '', message: '', logoUrl: '' });
  const [open, setOpen] = useState(false);
  if (!club) {
    return <p className="small muted">Course plan: add a sponsor (the pro shop, a local business) with their own screen in the rotation.</p>;
  }
  if (!open) {
    return (
      <div className="row wrap">
        <span className="small">{saved ? <>Sponsor: <strong>{saved.name}</strong></> : 'No sponsor'}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setDraft(saved ?? { name: '', message: '', logoUrl: '' }); setOpen(true); }}>{saved ? 'Edit sponsor' : 'Add a sponsor'}</button>
      </div>
    );
  }
  const clean = (v?: string | null) => v?.trim() || null;
  return (
    <div className="stack">
      <label>Sponsor name<input maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Joe's Pro Shop" /></label>
      <label>Their line (optional)<input maxLength={140} value={draft.message ?? ''} onChange={(e) => setDraft({ ...draft, message: e.target.value })} placeholder="10% off for league members" /></label>
      <label>Logo link (optional)<input value={draft.logoUrl ?? ''} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} placeholder="https://…/logo.png" /></label>
      <div className="row wrap">
        <button type="button" className="btn btn-sm" disabled={busy || !draft.name.trim()}
          onClick={async () => { await save({ ...settings, sponsor: { name: draft.name.trim(), message: clean(draft.message), logoUrl: clean(draft.logoUrl) } }); setOpen(false); }}>Save sponsor</button>
        {saved && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await save({ ...settings, sponsor: null }); setOpen(false); }}>Remove</button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function DemoPlan({ onChanged }: { onChanged: () => void }) {
  const { league } = useLeague();
  return (
    <section className="card stack">
      <h2>Demo: switch plan</h2>
      <p className="small muted">Only in demo mode. See how the league behaves on each plan.</p>
      <div className="row wrap">
        {(['free', 'pro', 'club', 'pilot'] as Plan[]).map((p) => (
          <button key={p} className={`btn btn-sm ${league.plan === p ? 'btn-primary' : ''}`} onClick={async () => { await (api as DemoApi).setPlan(league.id, p); onChanged(); }}>
            {PLAN_LABEL[p]}
          </button>
        ))}
      </div>
    </section>
  );
}

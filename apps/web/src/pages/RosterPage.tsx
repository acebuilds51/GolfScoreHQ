import { useMemo, useState } from 'react';
import { CopyField, EmptyState, ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { isCommissioner, type Contact, type Player } from '../lib/types';
import { parseRoster } from '../lib/util';

export function RosterPage() {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const data = useAsync(async () => {
    const [players, contacts] = await Promise.all([api.players(league.id), commish ? api.contacts(league.id) : Promise.resolve({} as Record<string, Contact>)]);
    return { players, contacts };
  }, [league.id, commish]);
  const [showInactive, setShowInactive] = useState(false);
  const [inviteFor, setInviteFor] = useState<{ player: Player; link: string } | null>(null);

  const players = data.data?.players ?? [];
  const active = players.filter((p) => p.active);
  const inactive = players.filter((p) => !p.active);

  return (
    <div className="page stack">
      {data.error && <ErrorText>{data.error}</ErrorText>}
      {commish && <AddGolfers existing={players.map((p) => p.displayName)} onAdded={data.reload} />}

      {inviteFor && (
        <div className="card stack highlight">
          <div className="row between">
            <h3>Invite link for {inviteFor.player.displayName}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setInviteFor(null)}>Close</button>
          </div>
          <p className="small muted">Text or email this link. When {inviteFor.player.displayName.split(' ')[0]} opens it and signs in, their account is linked to this roster spot, history and all. It works once and expires in 30 days.</p>
          <CopyField value={inviteFor.link} />
        </div>
      )}

      <section className="card flush">
        <div className="row between pad">
          <h2>Roster <span className="muted">({active.length})</span></h2>
        </div>
        {data.data && active.length === 0 ? (
          <EmptyState title="No golfers yet">{commish && <p className="muted">Paste your roster above, one golfer per line.</p>}</EmptyState>
        ) : (
          <ul className="list">
            {active.map((p) => (
              <PlayerRow key={p.id} player={p} contact={data.data?.contacts[p.id]} commish={commish} onChanged={data.reload} onInvite={(link) => setInviteFor({ player: p, link })} />
            ))}
          </ul>
        )}
        {inactive.length > 0 && (
          <div className="pad">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInactive(!showInactive)}>
              {showInactive ? 'Hide' : 'Show'} inactive golfers ({inactive.length})
            </button>
          </div>
        )}
        {showInactive && (
          <ul className="list">
            {inactive.map((p) => (
              <PlayerRow key={p.id} player={p} contact={data.data?.contacts[p.id]} commish={commish} onChanged={data.reload} onInvite={(link) => setInviteFor({ player: p, link })} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlayerRow({ player, contact, commish, onChanged, onInvite }: { player: Player; contact?: Contact; commish: boolean; onChanged: () => void; onInvite: (link: string) => void }) {
  const { league } = useLeague();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.displayName);
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const { busy, error, setError, run } = useAction();

  if (editing) {
    return (
      <li className="list-row stack">
        <div className="grid three">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Phone<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="row">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              if (!name.trim()) return setError('Enter a name.');
              const ok = await run(async () => {
                if (name.trim() !== player.displayName) await api.updatePlayer(player.id, { displayName: name.trim() });
                if ((email || null) !== (contact?.email ?? null) || (phone || null) !== (contact?.phone ?? null)) {
                  await api.saveContact(league.id, player.id, { email: email.trim() || null, phone: phone.trim() || null });
                }
                return true;
              });
              if (ok) { setEditing(false); onChanged(); }
            }}
          >
            Save
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="list-row">
      <div className="grow">
        <div className="row">
          <strong>{player.displayName}</strong>
          {player.isSub && <span className="badge badge-neutral">Sub</span>}
          {player.userId ? <span className="badge badge-ok">Joined</span> : null}
        </div>
        {commish && (contact?.email || contact?.phone) && (
          <div className="small muted">{[contact.email, contact.phone].filter(Boolean).join(' · ')}</div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
      {commish && (
        <div className="row actions">
          {!player.userId && player.active && (
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={async () => {
                const token = await run(() => api.createInvite(league.id, { playerId: player.id, email: contact?.email ?? undefined }));
                if (token) onInvite(`${window.location.origin}/join/${token}`);
              }}
            >
              Invite
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await run(() => api.updatePlayer(player.id, { isSub: !player.isSub })); onChanged(); }}>
            {player.isSub ? 'Make regular' : 'Make sub'}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await run(() => api.updatePlayer(player.id, { active: !player.active })); onChanged(); }}>
            {player.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      )}
    </li>
  );
}

function AddGolfers({ existing, onAdded }: { existing: string[]; onAdded: () => void }) {
  const { league } = useLeague();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const parsed = useMemo(() => parseRoster(text, existing), [text, existing]);

  return (
    <section className="card stack">
      <h2>Add golfers</h2>
      <p className="small muted">
        Paste from a spreadsheet or type one golfer per line. Add an email or phone and the word "sub" anywhere on the line if you like:
        <br />
        <code>Pat Jones, pat@example.com, 248-555-0101</code> · <code>Smith, John</code> · <code>Chris Lee, sub</code>
      </p>
      <textarea rows={5} value={text} placeholder={'Pat Jones, pat@example.com\nChris Lee, sub'} onChange={(e) => { setText(e.target.value); setMessage(null); }} />
      {text.trim() && (
        <div className="small">
          {parsed.players.length > 0 && (
            <p>
              Ready to add {parsed.players.length}: {parsed.players.map((p) => p.displayName + (p.isSub ? ' (sub)' : '')).join(', ')}
            </p>
          )}
          {parsed.skipped.map((s) => (
            <p key={s.line} className="warn">Skipping “{s.line}”: {s.reason}</p>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {message && <p className="ok">{message}</p>}
      <div>
        <button
          className="btn btn-primary"
          disabled={busy || parsed.players.length === 0}
          onClick={async () => {
            const n = parsed.players.length;
            const ok = await run(async () => { await api.addPlayers(league.id, parsed.players); return true; });
            if (ok) {
              setText('');
              setMessage(`Added ${n} golfer${n === 1 ? '' : 's'}.`);
              onAdded();
            }
          }}
        >
          {parsed.players.length ? `Add ${parsed.players.length} golfer${parsed.players.length === 1 ? '' : 's'}` : 'Add golfers'}
        </button>
      </div>
    </section>
  );
}

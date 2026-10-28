import { useMemo, useState } from 'react';
import { CopyField, EmptyState, ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { isCommissioner, type Contact, type Player } from '../lib/types';
import { checkGolferRows, parseRoster, type GolferRow } from '../lib/util';
import { fmtIndex, leagueIndexes, loadPlayedRounds, parseIndex, type IndexInfo } from '../lib/handicaps';
import { handicapRules } from '../lib/scoring';
import { norm } from '../lib/importer';

export function RosterPage() {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const data = useAsync(async () => {
    const [players, contacts, seasons, played] = await Promise.all([
      api.players(league.id),
      commish ? api.contacts(league.id) : Promise.resolve({} as Record<string, Contact>),
      api.seasons(league.id),
      loadPlayedRounds(api, league.id),
    ]);
    const rules = seasons[0]?.rules;
    const hcp = rules ? handicapRules(rules) : undefined;
    const indexes = leagueIndexes(players, played, hcp?.source ?? 'ghinFirst');
    return { players, contacts, indexes, handicapsOn: !!hcp?.enabled };
  }, [league.id, commish]);
  const [showInactive, setShowInactive] = useState(false);
  const [inviteFor, setInviteFor] = useState<{ player: Player; link: string } | null>(null);

  const players = data.data?.players ?? [];
  const active = players.filter((p) => p.active);
  const members = active.filter((p) => !p.isSub);
  const subs = active.filter((p) => p.isSub);
  const inactive = players.filter((p) => !p.active);
  const [showSubs, setShowSubs] = useState(false);
  const row = (p: Player) => (
    <PlayerRow key={p.id} player={p} others={players.filter((x) => x.id !== p.id)} contact={data.data?.contacts[p.id]} index={data.data?.indexes.get(p.id)}
      handicapsOn={!!data.data?.handicapsOn} commish={commish} onChanged={data.reload} onInvite={(link) => setInviteFor({ player: p, link })} />
  );

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

      {commish && <Duplicates players={players} onMerged={data.reload} />}

      <section className="card flush">
        <div className="row between pad">
          <h2>Roster <span className="muted">({members.length})</span></h2>
        </div>
        {data.data && active.length === 0 ? (
          <EmptyState title="No golfers yet">{commish && <p className="muted">Add your golfers above, one at a time or by pasting a list.</p>}</EmptyState>
        ) : members.length === 0 ? (
          <p className="pad small muted">No regular members yet; everyone is a sub.</p>
        ) : (
          <ul className="list">{members.map(row)}</ul>
        )}
        {subs.length > 0 && (
          <>
            <button type="button" className="roster-section-toggle" aria-expanded={showSubs} onClick={() => setShowSubs(!showSubs)}>
              <span className="grow">Subs <span className="muted">({subs.length})</span></span>
              <span aria-hidden="true">{showSubs ? '▾' : '▸'}</span>
            </button>
            {showSubs && <ul className="list">{subs.map(row)}</ul>}
          </>
        )}
        {inactive.length > 0 && (
          <>
            <button type="button" className="roster-section-toggle" aria-expanded={showInactive} onClick={() => setShowInactive(!showInactive)}>
              <span className="grow">Inactive <span className="muted">({inactive.length})</span></span>
              <span aria-hidden="true">{showInactive ? '▾' : '▸'}</span>
            </button>
            {showInactive && <ul className="list">{inactive.map(row)}</ul>}
          </>
        )}
      </section>
    </div>
  );
}

/** Golfers whose names match apart from spacing and capitals, with one tap to merge each set. */
function Duplicates({ players, onMerged }: { players: Player[]; onMerged: () => void }) {
  const { busy, error, run } = useAction();
  const sets = useMemo(() => {
    const by = new Map<string, Player[]>();
    for (const p of players) by.set(norm(p.displayName), [...(by.get(norm(p.displayName)) ?? []), p]);
    return [...by.values()].filter((s) => s.length > 1);
  }, [players]);
  if (!sets.length) return null;

  async function merge(set: Player[]) {
    const keep = keeperOf(set);
    const drop = set.filter((p) => p !== keep);
    if (!window.confirm(`Merge ${set.length} "${keep.displayName}" entries into one? Their rounds, money and contact details all move to one roster spot. This can't be undone.`)) return;
    const ok = await run(async () => {
      for (const d of drop) await api.mergePlayers(keep.id, d.id);
      return true;
    });
    if (ok) onMerged();
  }

  return (
    <section className="card stack">
      <h2>Possible duplicates</h2>
      <p className="small muted">These names match apart from spacing or capitals. Merging keeps one roster spot with everyone's rounds, money and contact details.</p>
      {sets.map((s) => (
        <div key={s[0]!.id} className="row between wrap">
          <span><strong>{keeperOf(s).displayName}</strong> <span className="muted">× {s.length}</span></span>
          <button className="btn btn-sm" disabled={busy} onClick={() => merge(s)}>Merge into one</button>
        </div>
      ))}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

/** Which duplicate to keep: the one with an app account, else a regular member, else an active one, else the first. */
function keeperOf(set: Player[]): Player {
  return set.find((p) => p.userId) ?? set.find((p) => p.active && !p.isSub) ?? set.find((p) => p.active) ?? set[0]!;
}

function PlayerRow({ player, others, contact, index, handicapsOn, commish, onChanged, onInvite }: {
  player: Player; others: Player[]; contact?: Contact; index?: IndexInfo; handicapsOn: boolean; commish: boolean; onChanged: () => void; onInvite: (link: string) => void;
}) {
  const [mergeInto, setMergeInto] = useState('');
  const { league } = useLeague();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.displayName);
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [hcp, setHcp] = useState(player.handicapIndex == null ? '' : fmtIndex(player.handicapIndex));
  const [ghin, setGhin] = useState(player.ghinNumber ?? '');
  const { busy, error, setError, run } = useAction();

  if (editing) {
    return (
      <li className="list-row stack">
        <div className="grid three">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Phone<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>
            Handicap Index
            <input inputMode="decimal" placeholder="e.g. 12.4" value={hcp} onChange={(e) => setHcp(e.target.value)} />
            <span className="small muted">From GHIN. Use + for a plus handicap. Leave blank to use the league's calculation.</span>
          </label>
          <label>
            GHIN number
            <input inputMode="numeric" placeholder="optional" value={ghin} onChange={(e) => setGhin(e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="row">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              const problem = checkGolferRows([{ name, email, phone, isSub: false }]).problems[0];
              if (problem) return setError(problem);
              const idx = parseIndex(hcp);
              if (idx === 'bad') return setError('Enter the Handicap Index like 12.4, or +1.2 for a plus handicap (up to 54).');
              if (ghin && !/^[0-9]{5,10}$/.test(ghin)) return setError('A GHIN number is 5 to 10 digits.');
              const ok = await run(async () => {
                if (name.trim() !== player.displayName) await api.updatePlayer(player.id, { displayName: name.trim() });
                if (idx !== player.handicapIndex || (ghin || null) !== player.ghinNumber) {
                  await api.updatePlayer(player.id, { handicapIndex: idx, ghinNumber: ghin || null });
                }
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
        <div className="subcard stack">
          <label className="inline">
            Same golfer as someone else on the roster?
            <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">Merge {player.displayName.split(' ')[0]} into…</option>
              {[...others].sort((a, b) => a.displayName.localeCompare(b.displayName)).map((o) => (
                <option key={o.id} value={o.id}>{o.displayName}{o.isSub ? ' (sub)' : ''}{o.active ? '' : ' (inactive)'}</option>
              ))}
            </select>
            <span className="small muted">For a misspelled name. Everything of {player.displayName}'s (rounds, money, contact details) moves to the golfer you pick, and this entry is removed.</span>
          </label>
          {mergeInto && (
            <div>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={async () => {
                  const target = others.find((o) => o.id === mergeInto)!;
                  if (!window.confirm(`Merge ${player.displayName} into ${target.displayName}? ${player.displayName} is removed from the roster and everything moves to ${target.displayName}. This can't be undone.`)) return;
                  const ok = await run(async () => { await api.mergePlayers(target.id, player.id); return true; });
                  if (ok) { setEditing(false); onChanged(); }
                }}
              >
                Merge into {others.find((o) => o.id === mergeInto)?.displayName}
              </button>
            </div>
          )}
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
        {(handicapsOn || player.handicapIndex != null) && index && <HandicapLine info={index} />}
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

/** "Handicap 12.4 · GHIN", "Handicap 9.1 · from 8 league rounds", or how many more rounds are needed. */
function HandicapLine({ info }: { info: IndexInfo }) {
  if (info.index != null) {
    return (
      <div className="small">
        Handicap <strong className="num">{fmtIndex(info.index)}</strong>
        <span className="muted"> · {info.from === 'ghin' ? 'GHIN' : `from ${info.leagueRounds} league rounds`}</span>
      </div>
    );
  }
  return (
    <div className="small muted">
      No handicap yet · {info.leagueRounds} complete league round{info.leagueRounds === 1 ? '' : 's'} so far
      (one is calculated after 6 nines or 3 full 18s), or enter their GHIN index
    </div>
  );
}

const blankRow = (): GolferRow => ({ name: '', email: '', phone: '', isSub: false });

function AddGolfers({ existing, onAdded }: { existing: string[]; onAdded: () => void }) {
  const [pasting, setPasting] = useState(false);
  return pasting
    ? <PasteGolfers existing={existing} onAdded={onAdded} onForm={() => setPasting(false)} />
    : <GolferForm existing={existing} onAdded={onAdded} onPaste={() => setPasting(true)} />;
}

/** One golfer per row, with name, email and phone in their own boxes (like Edit). */
function GolferForm({ existing, onAdded, onPaste }: { existing: string[]; onAdded: () => void; onPaste: () => void }) {
  const { league } = useLeague();
  const [rows, setRows] = useState<GolferRow[]>([blankRow()]);
  const [tried, setTried] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const checked = useMemo(() => checkGolferRows(rows, existing), [rows, existing]);
  const set = (i: number, patch: Partial<GolferRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setMessage(null);
  };
  const problemCount = Object.keys(checked.problems).length;

  async function save() {
    setTried(true);
    if (problemCount || !checked.players.length) return;
    const n = checked.players.length;
    const ok = await run(async () => { await api.addPlayers(league.id, checked.players); return true; });
    if (ok) {
      setRows([blankRow()]);
      setTried(false);
      setMessage(`Added ${n} golfer${n === 1 ? '' : 's'}.`);
      onAdded();
    }
  }

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Add golfers</h2>
        <button className="btn btn-ghost btn-sm" onClick={onPaste}>Paste a list instead</button>
      </div>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {rows.map((r, i) => (
          <div key={i} className="golfer-row">
            <div className="grid three">
              <label>Name<input value={r.name} autoFocus={i > 0 && i === rows.length - 1} onChange={(e) => set(i, { name: e.target.value })} /></label>
              <label>Email<input type="email" value={r.email} placeholder="optional" onChange={(e) => set(i, { email: e.target.value })} /></label>
              <label>Phone<input type="tel" value={r.phone} placeholder="optional" onChange={(e) => set(i, { phone: e.target.value })} /></label>
            </div>
            <div className="row between">
              <label className="check-row"><input type="checkbox" checked={r.isSub} onChange={(e) => set(i, { isSub: e.target.checked })} /> Sub</label>
              {rows.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>
              )}
            </div>
            {tried && checked.problems[i] && <p className="small warn">{checked.problems[i]}</p>}
          </div>
        ))}
        <ErrorText>{error}</ErrorText>
        {message && <p className="ok">{message}</p>}
        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || (!checked.players.length && !problemCount)}>
            {checked.players.length > 1 ? `Add ${checked.players.length} golfers` : 'Add golfer'}
          </button>
          <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, blankRow()])}>+ Another golfer</button>
        </div>
      </form>
    </section>
  );
}

/** Paste from a spreadsheet or type one golfer per line. */
function PasteGolfers({ existing, onAdded, onForm }: { existing: string[]; onAdded: () => void; onForm: () => void }) {
  const { league } = useLeague();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const parsed = useMemo(() => parseRoster(text, existing), [text, existing]);

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Add golfers</h2>
        <button className="btn btn-ghost btn-sm" onClick={onForm}>Add one at a time instead</button>
      </div>
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

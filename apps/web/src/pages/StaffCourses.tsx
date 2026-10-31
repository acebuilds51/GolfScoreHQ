import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CopyField, ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync } from '../lib/hooks';
import { fmtDay, PRICE } from '../lib/plans';
import type { CourseInvoice, StaffCourse } from '../lib/types';

const dollars = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const INVOICE_STATUS: Record<string, string> = { draft: 'Draft', open: 'Waiting to be paid', paid: 'Paid', void: 'Cancelled', uncollectible: 'Written off' };

/**
 * Staff: golf courses on the Course plan. Set one up for its manager, put its
 * leagues on it, and send the yearly invoice (Stripe hosts the pay page: card or bank).
 */
export function StaffCourses() {
  const courses = useAsync(() => api.staffCourses(), []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const { busy, error, setError, run } = useAction();

  return (
    <section className="card stack" id="courses">
      <h2>Courses</h2>
      <p className="small muted">
        Set up a course for its manager (they sign in at golfscorehq.app once first), add its leagues, then send the invoice.
        Its leagues get Pro straight away; if the invoice isn't paid by the due date, the plan switches off.
      </p>
      <form className="row wrap" onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || !email.trim()) return setError("The course's name and the manager's email.");
        const id = await run(() => api.staffCreateCourse(name, email));
        if (id) { setName(''); setEmail(''); courses.reload(); }
      }}>
        <input className="grow" placeholder="Course name, e.g. Crystal Lake Golf Club" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={80} />
        <input className="grow" type="email" placeholder="Manager's email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
        <button className="btn btn-primary btn-sm" disabled={busy}>Set up course</button>
      </form>
      <ErrorText>{error ?? courses.error}</ErrorText>
      {(courses.data ?? []).map((c) => <CourseRow key={c.id} course={c} onChanged={courses.reload} />)}
    </section>
  );
}

function CourseRow({ course: c, onChanged }: { course: StaffCourse; onChanged: () => void }) {
  const [slug, setSlug] = useState('');
  const [invoice, setInvoice] = useState<CourseInvoice | null>(null);
  const [billing, setBilling] = useState(false);
  const { busy, error, setError, run } = useAction();
  const active = !!c.expiresAt && new Date(c.expiresAt) > new Date();

  return (
    <div className="subcard stack">
      <div className="row between wrap">
        <div>
          <strong>{c.name}</strong>
          <div className="small muted">{c.ownerEmail ?? 'No manager'} · <Link to={`/course/${c.id}`}>Course summary →</Link></div>
        </div>
        <span className={`small ${active ? 'muted' : 'warn'}`}>{active ? `Active through ${fmtDay(c.expiresAt!)}` : c.billing ? 'Not active' : 'Not invoiced yet'}</span>
      </div>

      <ul className="list">
        {c.leagues.map((l) => (
          <li key={l.id} className="list-row">
            <Link className="grow" to={`/l/${l.slug}`}>{l.name}</Link>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
              if (window.confirm(`Take ${l.name} off ${c.name}? It goes back to the free plan.`)) { await run(() => api.staffSetCourseLeague(c.id, l.slug, false)); onChanged(); }
            }}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="row wrap" onSubmit={async (e) => {
        e.preventDefault();
        const s = slug.trim().replace(/^.*\/l\//, '').replace(/\/.*$/, '');
        if (!s) return setError("The league's web address, e.g. golfscorehq.app/l/maple-wednesday.");
        const ok = await run(async () => { await api.staffSetCourseLeague(c.id, s, true); return true; });
        if (ok) { setSlug(''); onChanged(); }
      }}>
        <input className="grow" placeholder="Add a league: golfscorehq.app/l/…" value={slug} onChange={(e) => { setSlug(e.target.value); setError(null); }} />
        <button className="btn btn-sm" disabled={busy}>Add league</button>
      </form>

      {!c.billing && !billing && <div><button className="btn btn-sm" onClick={() => setBilling(true)}>Send the invoice…</button></div>}
      {!c.billing && billing && <InvoiceForm clubId={c.id} onDone={(inv) => { setInvoice(inv); setBilling(false); onChanged(); }} onCancel={() => setBilling(false)} />}
      {c.billing && (
        <div className="row wrap">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { const inv = await run(() => api.courseInvoiceLink(c.id)); if (inv) setInvoice(inv); }}>Invoice link</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
            if (!window.confirm(`Mark ${c.name}'s open invoice as paid by check?`)) return;
            const inv = await run(() => api.courseMarkPaid(c.id));
            if (inv) { setInvoice(inv); onChanged(); }
          }}>Paid by check</button>
        </div>
      )}
      {invoice && <InvoiceLine invoice={invoice} />}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function InvoiceForm({ clubId, onDone, onCancel }: { clubId: string; onDone: (inv: CourseInvoice) => void; onCancel: () => void }) {
  const [price, setPrice] = useState(PRICE.course.replace(/\D/g, ''));
  const [days, setDays] = useState('30');
  const [email, setEmail] = useState(true);
  // The Founding Course offer: no cost through January 31, 2027 (see ForCoursesPage).
  const [freeUntil, setFreeUntil] = useState(new Date() < new Date('2027-01-30') ? '2027-01-31' : '');
  const { busy, error, setError, run } = useAction();
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      const dollarsPerYear = Number(price);
      if (!(dollarsPerYear >= 100 && dollarsPerYear <= 10000)) return setError('The price is $100 to $10,000 a year.');
      const d = Number(days);
      if (!(d >= 1 && d <= 90)) return setError('Give the course 1 to 90 days to pay.');
      const inv = await run(() => api.courseInvoice(clubId, { priceCents: Math.round(dollarsPerYear * 100), daysUntilDue: d, email, freeUntil: freeUntil || null }));
      if (inv) onDone(inv);
    }}>
      <div className="row wrap">
        <label className="inline">Price a year ($)<input inputMode="numeric" value={price} onChange={(e) => { setPrice(e.target.value.replace(/\D/g, '')); setError(null); }} /></label>
        <label className="inline">Days to pay<input inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value.replace(/\D/g, '')); setError(null); }} /></label>
        <label className="inline">Free until<input type="date" value={freeUntil} onChange={(e) => { setFreeUntil(e.target.value); setError(null); }} /></label>
      </div>
      <label className="check-row small"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email the invoice to the manager</label>
      <p className="small muted">
        With a free-until date, nothing is charged now and the first invoice goes out that day. Clear the date to invoice today.
        It renews every year with a new invoice. They can pay by card or bank transfer on Stripe's page, or you mark it paid when a check comes.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Sending…' : 'Send the invoice'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function InvoiceLine({ invoice: i }: { invoice: CourseInvoice }) {
  return (
    <div className="stack">
      <p className="small">
        {i.freeUntil ? <><strong>Free until {fmtDay(i.freeUntil)}</strong>. The first invoice goes out that day.</> : <>
          <strong>{INVOICE_STATUS[i.status] ?? i.status}</strong>
          {i.status === 'open' && <> · {dollars(i.amountDue)} due{i.dueDate ? ` by ${fmtDay(i.dueDate)}` : ''}</>}
        </>}
      </p>
      {i.url && !i.freeUntil && <>
        <CopyField value={i.url} />
        <div><a className="btn btn-sm" href={i.url} target="_blank" rel="noreferrer">Open the pay page</a></div>
      </>}
    </div>
  );
}

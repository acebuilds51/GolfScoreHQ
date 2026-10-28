// "Are you playing?" reminder emails.
//
//   Hourly timer (header x-cron-secret): every Pro league with reminders on gets
//     its email at 9 AM league time, the chosen number of days before league night.
//   POST { eventId } as a commissioner: preview (how many get it, who has no email).
//   POST { eventId, send: true } as a commissioner: send now.
//
// Goes to active regular golfers who haven't answered and aren't on the tee
// sheet yet, unless they turned reminders off. Each email has a private
// one-tap answer link per golfer per week.
// Deploy with --no-verify-jwt (the timer has no user); this function checks
// the timer's secret or the commissioner itself.
// Secrets: RESEND_API_KEY, RECAP_FROM_EMAIL, APP_URL.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { senderFrom } from '../_shared/sender.ts';
import { buildReminderEmail, reminderDue } from './email.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
type Row = Record<string, any>;

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const newToken = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

/** Who gets this week's reminder (with an email), and who would but has no email. */
async function recipientsFor(admin: SupabaseClient, event: Row) {
  const [{ data: players }, { data: rsvps }, { data: lineup }, { data: prefs }, { data: contacts }] = await Promise.all([
    admin.from('players').select('id, display_name, user_id, active, is_sub').eq('league_id', event.league_id),
    admin.from('event_rsvps').select('player_id').eq('event_id', event.id),
    admin.from('event_lineup').select('player_id').eq('event_id', event.id),
    admin.from('notification_prefs').select('player_id, rsvp_reminders').eq('league_id', event.league_id),
    admin.from('player_contacts').select('player_id, email').eq('league_id', event.league_id),
  ]);
  const answered = new Set([...(rsvps ?? []), ...(lineup ?? [])].map((r: Row) => r.player_id));
  const off = new Set((prefs ?? []).filter((p: Row) => p.rsvp_reminders === false).map((p: Row) => p.player_id));
  const contactEmail = new Map((contacts ?? []).filter((c: Row) => c.email).map((c: Row) => [c.player_id, c.email as string]));
  const out: { playerId: string; name: string; email: string }[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const p of (players ?? []) as Row[]) {
    if (!p.active || p.is_sub || answered.has(p.id) || off.has(p.id)) continue;
    let email = contactEmail.get(p.id) ?? null;
    if (!email && p.user_id) email = (await admin.auth.admin.getUserById(p.user_id)).data.user?.email ?? null;
    if (!email) { missing.push(p.display_name); continue; }
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({ playerId: p.id, name: p.display_name, email });
  }
  return { recipients: out, missing };
}

/** Email the week's reminder; returns how many went out. */
async function sendFor(admin: SupabaseClient, event: Row, league: Row): Promise<number> {
  const { recipients } = await recipientsFor(admin, event);
  const key = env('RESEND_API_KEY');
  if (!key) throw new Error("Email isn't set up yet. Add the RESEND_API_KEY secret in Supabase.");
  const appUrl = env('APP_URL') || 'https://golfscorehq.app';
  const { data: branded } = await admin.rpc('league_has_feature', { lid: league.id, feature: 'branding' });
  const from = senderFrom(env('RECAP_FROM_EMAIL'));

  let delivered = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const tokens = chunk.map(() => newToken());
    const links = await Promise.all(chunk.map(async (r, j) => ({ token_hash: await sha256Hex(tokens[j]!), event_id: event.id, player_id: r.playerId, league_id: league.id })));
    const saved = await admin.from('rsvp_links').upsert(links, { onConflict: 'event_id,player_id' });
    if (saved.error) throw new Error(saved.error.message);
    const batch = chunk.map((r, j) => {
      const e = buildReminderEmail({
        leagueName: league.name, playerName: r.name, weekNumber: event.week_number, eventDate: event.event_date,
        answerUrl: `${appUrl}/rsvp/${tokens[j]}`, weekUrl: `${appUrl}/l/${league.slug}/week/${event.id}`,
        brand: branded ? { color: league.brand_color, accent: league.accent_color } : undefined,
      });
      return { from, to: [r.email], subject: e.subject, html: e.html, text: e.text };
    });
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`The email service refused the send (${res.status}). ${detail.slice(0, 200)}`);
    }
    delivered += batch.length;
  }
  await admin.from('reminder_sends').upsert({ event_id: event.id, league_id: league.id, sent_at: new Date().toISOString(), recipients: delivered });
  return delivered;
}

const LEAGUE_COLS = 'id, name, slug, timezone, brand_color, accent_color, rsvp_reminder_days';
const EVENT_COLS = 'id, league_id, week_number, event_date, status';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  // ── The hourly timer ──
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret) {
    const { data: secret } = await admin.from('cron_secret').select('token').maybeSingle();
    if (!secret || secret.token !== cronSecret) return json({ error: 'Not allowed.' }, 401);
    const now = new Date();
    const { data: leagues } = await admin.from('leagues').select(LEAGUE_COLS).not('rsvp_reminder_days', 'is', null);
    const results: { league: string; week: number; sent?: number; error?: string }[] = [];
    for (const league of (leagues ?? []) as Row[]) {
      const { data: allowed } = await admin.rpc('league_has_feature', { lid: league.id, feature: 'rsvp' });
      if (!allowed) continue;
      // League night is at most 6 days out; look a day either side for time zones.
      const from = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
      const to = new Date(now.getTime() + 8 * 86_400_000).toISOString().slice(0, 10);
      const { data: events } = await admin.from('events').select(EVENT_COLS).eq('league_id', league.id).eq('status', 'scheduled')
        .gte('event_date', from).lte('event_date', to);
      for (const ev of (events ?? []) as Row[]) {
        if (!reminderDue(ev.event_date, league.rsvp_reminder_days, now, league.timezone || 'America/New_York')) continue;
        const { data: done } = await admin.from('reminder_sends').select('event_id').eq('event_id', ev.id).maybeSingle();
        if (done) continue;
        try {
          results.push({ league: league.slug, week: ev.week_number, sent: await sendFor(admin, ev, league) });
        } catch (e) {
          console.error('reminder', league.slug, ev.week_number, e);
          results.push({ league: league.slug, week: ev.week_number, error: String((e as Error).message ?? e) });
        }
      }
    }
    return json({ results });
  }

  // ── A commissioner previewing or sending now ──
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: 'Sign in first.' }, 401);
  let body: { eventId?: string; send?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!body.eventId) return json({ error: 'Which week?' }, 400);

  const { data: event } = await admin.from('events').select(EVENT_COLS).eq('id', body.eventId).maybeSingle();
  if (!event) return json({ error: "That week wasn't found." }, 404);
  const { data: isCommish } = await userClient.rpc('is_commissioner', { lid: event.league_id });
  if (!isCommish) return json({ error: 'Only commissioners can send reminders.' }, 403);
  const { data: allowed } = await admin.rpc('league_has_feature', { lid: event.league_id, feature: 'rsvp' });
  if (!allowed) return json({ error: 'Reminder emails need GolfScoreHQ Pro.' }, 403);
  if (event.status !== 'scheduled') return json({ error: 'This week has already started.' }, 400);
  if (!event.event_date) return json({ error: 'Give this week a date first.' }, 400);
  const { data: league } = await admin.from('leagues').select(LEAGUE_COLS).eq('id', event.league_id).single();
  const { data: sent } = await admin.from('reminder_sends').select('sent_at, recipients').eq('event_id', event.id).maybeSingle();

  if (!body.send) {
    const { recipients, missing } = await recipientsFor(admin, event);
    return json({ recipients: recipients.length, missing, alreadySent: sent ?? null });
  }
  try {
    return json({ sent: await sendFor(admin, event, league!) });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});

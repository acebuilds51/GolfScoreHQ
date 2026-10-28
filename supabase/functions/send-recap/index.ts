// Weekly recap email server function.
//
//   POST { eventId }                 → preview: subject, sample text, who gets it, who has no email
//   POST { eventId, send: true }     → email every golfer their personal recap
//   POST { eventId, send: true, force: true } → send again after it was already sent
//   POST { eventId, draftStory: true } → AI-drafted opening paragraph for the commissioner to review
//   `story` (the reviewed write-up) can be passed with a preview or send.
//
// Commissioners of a Pro league only, and only for a settled week. Money comes
// from the posted results. Golfers who turned the recap off are skipped.
// Secrets: RESEND_API_KEY, RECAP_FROM_EMAIL (e.g. "GolfScoreHQ <recaps@yourdomain.com>"), APP_URL,
// ANTHROPIC_API_KEY (AI write-up), RECAP_AI_MODEL (optional).
import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-ignore generated JavaScript bundle of packages/engine (npm run build:functions)
import { recapText, weeklyRecap, withPostedResults } from '../_shared/engine.js';
import { buildRecapEmail } from './email.ts';
import { pushToUsers } from '../_shared/push.ts';
import { engineRounds, ROUND_SELECT } from '../_shared/rounds.ts';
import { senderFrom } from '../_shared/sender.ts';
import { cleanStory, emptyStoryReason, storyFromResponse, storyRequest } from './story.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
type Row = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: 'Sign in first.' }, 401);

  let body: { eventId?: string; send?: boolean; force?: boolean; draftStory?: boolean; story?: string | null };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!body.eventId) return json({ error: 'Which week?' }, 400);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: event } = await admin.from('events').select('id, league_id, season_id, week_number, status, layout_id, rules_override').eq('id', body.eventId).maybeSingle();
  if (!event) return json({ error: "That week wasn't found." }, 404);

  const { data: isCommish } = await userClient.rpc('is_commissioner', { lid: event.league_id });
  if (!isCommish) return json({ error: 'Only commissioners can send the recap.' }, 403);
  const { data: allowed } = await admin.rpc('league_has_feature', { lid: event.league_id, feature: 'weekly_recap' });
  if (!allowed) return json({ error: 'The weekly recap email needs GolfScoreHQ Pro.' }, 403);
  if (event.status !== 'settled') return json({ error: 'Settle the week first, then send the recap.' }, 400);

  const [{ data: league }, { data: season }, { data: layout }, { data: players }, { data: rounds }, { data: seasonLedger }, { data: contacts }, { data: prefs }, { data: payment }, { data: sent }] =
    await Promise.all([
      admin.from('leagues').select('name, slug, logo_url, brand_color, accent_color, show_money').eq('id', event.league_id).single(),
      admin.from('seasons').select('rules').eq('id', event.season_id).single(),
      admin.from('layouts').select('id, name, holes').eq('id', event.layout_id).maybeSingle(),
      admin.from('players').select('id, display_name, user_id, active').eq('league_id', event.league_id),
      admin.from('rounds').select(ROUND_SELECT).eq('event_id', event.id),
      admin.from('ledger_entries').select('event_id, player_id, kind, amount_cents, hole_number, events!inner(season_id, status, week_number)').eq('events.season_id', event.season_id).eq('events.status', 'settled').lte('events.week_number', event.week_number),
      admin.from('player_contacts').select('player_id, email').eq('league_id', event.league_id),
      admin.from('notification_prefs').select('player_id, weekly_recap').eq('league_id', event.league_id),
      admin.from('league_payment_settings').select('venmo_username, paypal_me, zelle_contact').eq('league_id', event.league_id).maybeSingle(),
      admin.from('recap_sends').select('sent_at, recipients').eq('event_id', event.id).maybeSingle(),
    ]);

  if (!layout) return json({ error: 'This week has no course.' }, 400);
  // The week's own rules (e.g. a scramble week), else the season's.
  const rules = event.rules_override ?? season?.rules;
  if (!['bestBallMatch', 'strokePlay', 'stableford', 'scramble'].includes(rules?.format)) return json({ error: "Recap emails for this format aren't available yet." }, 400);

  const toEntry = (e: Row) => ({ playerId: e.player_id, amount: e.amount_cents, kind: e.kind, ...(e.hole_number ? { holeNumber: e.hole_number } : {}) });
  const weekLedger = (seasonLedger ?? []).filter((e: Row) => e.event_id === event.id).map(toEntry);
  const recap = withPostedResults(weeklyRecap(event.week_number, engineRounds(rounds ?? [], layout), layout, rules), weekLedger, (seasonLedger ?? []).map(toEntry));
  const names = new Map((players ?? []).map((p: Row) => [p.id, p.display_name]));
  const recapBody: string = recapText(recap, (id: string) => names.get(id) ?? '?', { leagueName: league!.name });
  const playsForMoney = rules.skins.enabled || rules.ctp.enabled
    || (rules.format === 'bestBallMatch' ? rules.match.stake > 0 || rules.presses.enabled : (rules.payouts ?? []).some((c: number) => c > 0))
    || (rules.format === 'scramble' && rules.teamPot > 0);

  if (body.draftStory) {
    const aiKey = env('ANTHROPIC_API_KEY');
    if (!aiKey) return json({ error: "AI write-ups aren't set up yet. Add the ANTHROPIC_API_KEY secret in Supabase." }, 503);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': aiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(storyRequest({ leagueName: league!.name, weekNumber: event.week_number, recapBody, model: env('RECAP_AI_MODEL') })),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('anthropic', res.status, detail.slice(0, 500));
      return json({ error: `The AI write-up isn't available right now (${res.status}). Write your own or send without one.` }, 502);
    }
    const reply = await res.json();
    const story = storyFromResponse(reply);
    if (!story) {
      console.error('anthropic empty', reply?.model, reply?.stop_reason, JSON.stringify(reply?.usage), (reply?.content ?? []).map((b: Row) => b.type));
      return json({ error: emptyStoryReason(reply) }, 502);
    }
    return json({ story });
  }
  const story = body.story ? cleanStory(String(body.story)) : null;

  // Who gets it: active golfers with an email on file or a linked account, unless they opted out.
  const optedOut = new Set((prefs ?? []).filter((p: Row) => p.weekly_recap === false).map((p: Row) => p.player_id));
  const contactEmail = new Map((contacts ?? []).filter((c: Row) => c.email).map((c: Row) => [c.player_id, c.email as string]));
  const recipients: { playerId: string; name: string; email: string }[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const p of (players ?? []) as Row[]) {
    if (!p.active || optedOut.has(p.id)) continue;
    let email = contactEmail.get(p.id) ?? null;
    if (!email && p.user_id) email = (await admin.auth.admin.getUserById(p.user_id)).data.user?.email ?? null;
    if (!email) { missing.push(p.display_name); continue; }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ playerId: p.id, name: p.display_name, email });
  }

  const leagueUrl = `${env('APP_URL') || 'https://golfscorehq.app'}/l/${league!.slug}`;
  const handles = { venmo: payment?.venmo_username, paypalMe: payment?.paypal_me, zelle: payment?.zelle_contact };
  const { data: branded } = await admin.rpc('league_has_feature', { lid: event.league_id, feature: 'branding' });
  const brand = branded ? { color: league!.brand_color, accent: league!.accent_color, logoUrl: league!.logo_url } : undefined;
  const emailFor = (r: { playerId: string; name: string }) =>
    buildRecapEmail({
      leagueName: league!.name, weekNumber: event.week_number, leagueUrl, recapBody, playerName: r.name, payment: handles, story, brand,
      weekCents: playsForMoney ? recap.weekBalances[r.playerId] ?? 0 : null,
      // Season money only when the league shows it to golfers.
      seasonCents: playsForMoney && league!.show_money !== false ? recap.seasonBalances[r.playerId] ?? 0 : null,
    });

  if (!body.send) {
    const sample = emailFor(recipients[0] ?? { playerId: '', name: 'Golfer' });
    return json({ subject: sample.subject, text: sample.text, recipients: recipients.length, missing, alreadySent: sent ?? null });
  }

  if (sent && !body.force) return json({ error: 'already_sent', alreadySent: sent }, 409);
  const key = env('RESEND_API_KEY');
  if (!key) return json({ error: "Email isn't set up yet. Add the RESEND_API_KEY secret in Supabase." }, 503);
  const from = senderFrom(env('RECAP_FROM_EMAIL'));

  let delivered = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100).map((r) => {
      const e = emailFor(r);
      return { from, to: [r.email], subject: e.subject, html: e.html, text: e.text };
    });
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json({ error: `The email service refused the send (${res.status}). ${detail.slice(0, 200)}`, delivered }, 502);
    }
    delivered += batch.length;
  }
  // Golfers with the app also get a phone notification.
  await pushToUsers(admin, (players ?? []).filter((p: Row) => p.active && !optedOut.has(p.id)).map((p: Row) => p.user_id), {
    title: `${league!.name}: week ${event.week_number} results`, body: 'Results, skins and standings are in.',
    url: `/l/${league!.slug}/standings`, tag: `recap-${event.id}`,
  }).catch((e) => console.error('recap push', e));
  await admin.from('recap_sends').upsert({ event_id: event.id, league_id: event.league_id, sent_at: new Date().toISOString(), recipients: delivered });
  return json({ sent: delivered, missing });
});

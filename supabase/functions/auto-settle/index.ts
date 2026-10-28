// The week settling itself.
//
//   POST {} (header x-cron-secret) → settles the weeks the database queued
//
// The database queues a week when its last group on the tee sheet submits
// (leagues.auto_settle). This works the money out with the same scoring engine
// as the commissioner's Settle button and posts it. A closest-to-the-pin hole
// two groups both claimed is left for the commissioner, who gets a notification.
//
// Deploy with --no-verify-jwt (the database calls it without a user).
import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-ignore generated JavaScript bundle of packages/engine (npm run build:functions)
import { weekPosting } from '../_shared/engine.js';
import { engineRounds, ROUND_SELECT } from '../_shared/rounds.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: secret } = await admin.from('cron_secret').select('token').maybeSingle();
  if (!secret || secret.token !== req.headers.get('x-cron-secret')) return json({ error: 'Not allowed.' }, 401);

  const { data: queued, error } = await admin.rpc('take_settle_queue');
  if (error) return json({ error: error.message }, 500);
  const results: Record<string, string> = {};
  for (const eventId of (queued ?? []) as string[]) {
    results[eventId] = await settle(admin, eventId).catch((e) => { console.error('auto-settle', eventId, e); return `error: ${e?.message ?? e}`; });
  }
  return json({ results });
});

// deno-lint-ignore no-explicit-any
async function settle(admin: any, eventId: string): Promise<string> {
  const { data: ready } = await admin.rpc('event_ready_to_settle', { p_event: eventId });
  if (!ready) return 'not ready';
  const { data: event } = await admin.from('events').select('id, season_id, layout_id, rules_override').eq('id', eventId).single();
  const [{ data: season }, { data: layout }, { data: rounds }, { data: decisions }] = await Promise.all([
    admin.from('seasons').select('rules').eq('id', event.season_id).single(),
    admin.from('layouts').select('id, name, holes').eq('id', event.layout_id).maybeSingle(),
    admin.from('rounds').select(ROUND_SELECT).eq('event_id', eventId),
    admin.from('ctp_decisions').select('hole_number, player_id').eq('event_id', eventId),
  ]);
  if (!layout) return 'no course';
  // The week's own rules (e.g. a scramble week), else the season's.
  const rules = event.rules_override ?? season?.rules;
  if (!rules) return 'no rules';

  const picks = Object.fromEntries(((decisions ?? []) as Row[]).map((d) => [d.hole_number, d.player_id]));
  const posting = weekPosting(engineRounds(rounds ?? [], layout), layout, rules, picks);
  if (posting.undecided.length) {
    await admin.rpc('auto_settle_waiting', { p_event: eventId, p_holes: posting.undecided });
    return 'waiting on a CTP decision';
  }
  const entries = (posting.ledger as Row[]).map((e) => ({
    player_id: e.playerId, round_id: e.roundId ?? null, kind: e.kind, amount_cents: e.amount, hole_number: e.holeNumber ?? null,
  }));
  const { data: done, error } = await admin.rpc('auto_settle_event', { p_event: eventId, p_entries: entries });
  if (error) throw new Error(error.message);
  return done ? 'settled' : 'not ready';
}

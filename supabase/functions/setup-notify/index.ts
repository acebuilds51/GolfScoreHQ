// "We set up your league" emails.
//
//   POST { requestId, event: 'created' } → from the commissioner who sent it: emails
//        GolfScoreHQ support the request, with 7-day download links for the files.
//   POST { requestId, event: 'updated' } → from staff: emails the commissioner the
//        new status and staff's reply.
//
// Secrets: RESEND_API_KEY, RECAP_FROM_EMAIL (sender), SUPPORT_EMAIL (default support@golfscorehq.app), APP_URL.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { senderFrom } from '../_shared/sender.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Row = Record<string, any>;

const WANTS: Record<string, string> = {
  roster: 'Roster and contact info', handicaps: 'Handicaps', course: 'Course and scorecard', history: 'Past rounds and results', side_games: 'Side games and money rules',
};
const STATUS: Record<string, string> = {
  requested: 'Received', in_progress: "We're working on it", needs_info: 'We have a question', done: 'All set up',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: 'Sign in first.' }, 401);

  let body: { requestId?: string; event?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  if (!body.requestId || !['created', 'updated'].includes(body.event ?? '')) return json({ error: 'Bad request.' }, 400);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: r } = await admin.from('setup_requests').select('*').eq('id', body.requestId).maybeSingle();
  if (!r) return json({ error: "That request wasn't found." }, 404);
  const { data: league } = await admin.from('leagues').select('name, slug, plan').eq('id', r.league_id).single();

  const key = env('RESEND_API_KEY');
  if (!key) return json({ error: "Email isn't set up yet." }, 503);
  const from = senderFrom(env('RECAP_FROM_EMAIL'));
  const support = env('SUPPORT_EMAIL') || 'support@golfscorehq.app';
  const appUrl = env('APP_URL') || 'https://golfscorehq.app';
  const requester = (await admin.auth.admin.getUserById(r.requested_by)).data.user?.email ?? null;

  let message: Record<string, unknown>;
  if (body.event === 'created') {
    const { data: isCommish } = await userClient.rpc('is_commissioner', { lid: r.league_id });
    if (!isCommish) return json({ error: 'Only the league\'s commissioners can send this.' }, 403);
    const files = await Promise.all(((r.files ?? []) as Row[]).map(async (f) => {
      const { data } = await admin.storage.from('setup-uploads').createSignedUrl(f.path, 7 * 24 * 3600);
      return { name: String(f.name), size: Number(f.size) || 0, url: data?.signedUrl ?? null };
    }));
    const wants = ((r.wants ?? []) as string[]).map((w) => WANTS[w] ?? w);
    const lines = [
      `League: ${league!.name} (${appUrl}/l/${league!.slug}) · plan ${league!.plan}`,
      `From: ${requester ?? 'unknown'}${r.contact_phone ? ` · ${r.contact_phone}` : ''}`,
      `Wants: ${wants.join(', ') || '—'}`,
      `Support access to the league: ${r.staff_access ? 'yes' : 'no'}`,
      '',
      r.notes || '(no notes)',
      '',
      'Files (links work for 7 days):',
      ...(files.length ? files.map((f) => `  ${f.name} (${Math.round(f.size / 1024)} KB): ${f.url ?? 'link unavailable'}`) : ['  none']),
      '',
      `Staff page: ${appUrl}/staff`,
    ];
    message = {
      from, to: [support], ...(requester ? { reply_to: requester } : {}),
      subject: `Setup request: ${league!.name}`,
      text: lines.join('\n'),
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
        <h2 style="margin:0 0 8px">Setup request: ${esc(league!.name)}</h2>
        <p style="margin:0 0 12px">${lines.slice(0, 4).map(esc).join('<br>')}</p>
        <p style="white-space:pre-wrap;background:#f0f2ef;padding:12px;border-radius:8px">${esc(r.notes || '(no notes)')}</p>
        <p><strong>Files</strong> (links work for 7 days)</p>
        <ul>${files.map((f) => `<li>${f.url ? `<a href="${esc(f.url)}">${esc(f.name)}</a>` : esc(f.name)} <span style="color:#5b6461">${Math.round(f.size / 1024)} KB</span></li>`).join('') || '<li>none</li>'}</ul>
        <p><a href="${esc(appUrl)}/staff">Open the staff page</a></p>
      </div>`,
    };
  } else {
    const { data: staff } = await userClient.rpc('is_staff');
    if (!staff) return json({ error: 'Staff only.' }, 403);
    if (!requester) return json({ error: 'No email for the commissioner who sent this.' }, 400);
    const link = `${appUrl}/l/${league!.slug}/setup`;
    const status = STATUS[r.status] ?? r.status;
    message = {
      from, to: [requester], reply_to: support,
      subject: `${league!.name} setup: ${status}`,
      text: [`${status}.`, '', r.staff_reply || '', '', `See your request: ${link}`, '', 'Reply to this email if you have questions.'].join('\n'),
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">
        <h2 style="margin:0 0 8px">${esc(league!.name)}: ${esc(status)}</h2>
        ${r.staff_reply ? `<p style="white-space:pre-wrap">${esc(r.staff_reply)}</p>` : ''}
        <p><a href="${esc(link)}">See your setup request</a></p>
        <p style="color:#5b6461">Reply to this email if you have questions. — GolfScoreHQ support</p>
      </div>`,
    };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: `The email service refused the message (${res.status}). ${detail.slice(0, 200)}` }, 502);
  }
  return json({ sent: true });
});

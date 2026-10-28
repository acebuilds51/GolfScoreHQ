// Phone notifications (web push) to everyone's saved devices. Free: the
// phone's own push service delivers them. Devices that stopped working (app
// removed, notifications turned off) are dropped.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. "mailto:support@golfscorehq.app").
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it goes, e.g. "/l/oak/week/…". */
  url: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

const env = (k: string) => Deno.env.get(k) ?? '';
export const pushReady = () => !!(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'));

/** Send to every device of these users; returns how many devices got it. */
export async function pushToUsers(admin: SupabaseClient, userIds: (string | null | undefined)[], msg: PushMessage): Promise<number> {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  if (!pushReady() || !ids.length) return 0;
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:support@golfscorehq.app', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids);
  const dead: string[] = [];
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) dead.push(s.id);
      else console.error('push', status, (e as { body?: string }).body ?? e);
    }
  }));
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);
  return sent;
}

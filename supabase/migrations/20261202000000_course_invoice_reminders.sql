-- Reminders for unpaid Course plan invoices: two weeks before the due date,
-- then a final one a week before (the course-reminders function).

-- Which reminders went out for which Stripe invoice, so each is sent once.
create table if not exists course_invoice_reminders (
  invoice_id text not null,
  kind text not null check (kind in ('14', '7')),
  club_id uuid references clubs(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (invoice_id, kind)
);
-- Only the server function reads or writes it.
alter table course_invoice_reminders enable row level security;
revoke all on course_invoice_reminders from anon, authenticated;

-- Timer (Supabase only: pg_cron and pg_net aren't in local test databases):
--   daily at 13:00 UTC (9 AM Eastern): course-reminders
do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then return; end if;
  perform cron.schedule('course-reminders', '0 13 * * *', $job$
    select net.http_post(
      url := 'https://foxthtwxgfnoqxrcbxfc.supabase.co/functions/v1/course-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select token from public.cron_secret)),
      body := '{}'::jsonb
    )
  $job$);
end $$;

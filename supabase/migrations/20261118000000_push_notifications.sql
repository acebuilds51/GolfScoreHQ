-- Phone notifications (web push, free). Each phone or browser where someone
-- turned notifications on is one row; the server functions send to them
-- (reminders, "results are in") and drop the ones that stopped working.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text check (length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
create policy "own devices: read" on push_subscriptions for select using (user_id = auth.uid());
create policy "own devices: add" on push_subscriptions for insert with check (user_id = auth.uid());
create policy "own devices: remove" on push_subscriptions for delete using (user_id = auth.uid());
revoke update on push_subscriptions from anon, authenticated;
revoke all on push_subscriptions from anon;

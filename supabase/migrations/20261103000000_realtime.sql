-- Live leaderboard: broadcast scoring changes over Supabase Realtime.
-- Realtime still applies each table's row-level security, so golfers only
-- receive changes from leagues they belong to. Safe to run more than once.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    return;
  end if;
  foreach t in array array['hole_scores', 'rounds', 'ctp_reports', 'presses', 'events'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

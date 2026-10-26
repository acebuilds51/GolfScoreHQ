-- Five Pro features:
--   weekly_recap   results email after each week settles (sent by a server job)
--   rsvp           "Are you playing?" plus a sub finder, first sub to accept gets the spot
--   setup_service  we import the league's roster and history for them
--   awards         end-of-season awards and player stats (computed by the engine)
--   tv_mode        Clubhouse TV display links

update plans
set features = features || array['weekly_recap', 'rsvp', 'setup_service', 'awards', 'tv_mode']
where code in ('pro', 'club', 'pilot', 'comp');

-- The golfer linked to a roster spot, or a commissioner, may act for that spot.
create function acts_for_player(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players p
    where p.id = pid and (p.user_id = auth.uid() or is_commissioner(p.league_id))
  )
$$;

-- ── Notification preferences (per roster spot) ──────────────────────────────

create table notification_prefs (
  player_id uuid primary key,
  league_id uuid not null,
  weekly_recap boolean not null default true,
  rsvp_reminders boolean not null default true,
  sub_alerts boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);

alter table notification_prefs enable row level security;
create policy "golfer or commissioner reads prefs" on notification_prefs for select using (acts_for_player(player_id));
create policy "golfer or commissioner sets prefs" on notification_prefs for insert with check (acts_for_player(player_id));
create policy "golfer or commissioner edits prefs" on notification_prefs for update
  using (acts_for_player(player_id)) with check (acts_for_player(player_id));

-- ── Weekly recap send log (written by the server job) ───────────────────────

create table recap_sends (
  event_id uuid primary key,
  league_id uuid not null,
  sent_at timestamptz not null default now(),
  recipients integer not null default 0,
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade
);

alter table recap_sends enable row level security;
create policy "commissioners see recap sends" on recap_sends for select using (is_commissioner(league_id));

-- ── RSVP ─────────────────────────────────────────────────────────────────────

create table event_rsvps (
  event_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  status text not null check (status in ('in', 'out', 'maybe')),
  note text check (length(note) <= 140),
  responded_by uuid references auth.users (id),
  responded_at timestamptz not null default now(),
  primary key (event_id, player_id),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);

alter table event_rsvps enable row level security;
create policy "members read rsvps" on event_rsvps for select using (event_visible(event_id));
create policy "golfers answer rsvp" on event_rsvps for insert
  with check (acts_for_player(player_id) and league_has_feature(league_id, 'rsvp') and responded_by = auth.uid());
create policy "golfers change rsvp" on event_rsvps for update
  using (acts_for_player(player_id))
  with check (acts_for_player(player_id) and league_has_feature(league_id, 'rsvp') and responded_by = auth.uid());

-- ── Sub finder ───────────────────────────────────────────────────────────────

create table sub_requests (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  event_id uuid not null,
  tee_slot smallint,
  spots smallint not null default 1 check (spots between 1 and 4),
  filled smallint not null default 0,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (league_id, id),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade
);

create table sub_offers (
  request_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'too_late')),
  offered_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (request_id, player_id),
  foreign key (league_id, request_id) references sub_requests (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);

alter table sub_requests enable row level security;
alter table sub_offers enable row level security;

create policy "members read sub requests" on sub_requests for select using (is_league_member(league_id));
create policy "commissioners open sub requests" on sub_requests for insert
  with check (is_commissioner(league_id) and league_has_feature(league_id, 'rsvp') and created_by = auth.uid());
create policy "commissioners close sub requests" on sub_requests for update
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));

create policy "members read sub offers" on sub_offers for select using (is_league_member(league_id));
create policy "commissioners send sub offers" on sub_offers for insert
  with check (is_commissioner(league_id) and league_has_feature(league_id, 'rsvp'));
-- Subs answer through respond_to_sub_offer() so two subs can't take the same spot.

-- First to accept gets the spot. Returns the offer's resulting status.
create function respond_to_sub_offer(p_request uuid, p_player uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  req sub_requests;
  off sub_offers;
  result text;
begin
  if not acts_for_player(p_player) then raise exception 'not your offer'; end if;
  select * into req from sub_requests where id = p_request for update;
  select * into off from sub_offers where request_id = p_request and player_id = p_player for update;
  if off.request_id is null then raise exception 'no such offer'; end if;
  if off.status <> 'offered' then return off.status; end if;

  if not p_accept then
    result := 'declined';
  elsif req.closed_at is not null or req.filled >= req.spots then
    result := 'too_late';
  else
    result := 'accepted';
    update sub_requests
      set filled = filled + 1,
          closed_at = case when filled + 1 >= spots then now() else null end
      where id = p_request;
    insert into event_rsvps (event_id, player_id, league_id, status, responded_by)
      values (req.event_id, p_player, req.league_id, 'in', auth.uid())
      on conflict (event_id, player_id) do update set status = 'in', responded_by = excluded.responded_by, responded_at = now();
  end if;

  update sub_offers set status = result, responded_at = now() where request_id = p_request and player_id = p_player;
  return result;
end $$;

grant execute on function respond_to_sub_offer(uuid, uuid, boolean) to authenticated;
revoke execute on function respond_to_sub_offer(uuid, uuid, boolean) from anon, public;

-- ── Clubhouse TV ─────────────────────────────────────────────────────────────
-- The TV opens /tv/<token>; a server function looks the league up by the
-- token's hash and serves read-only live data. The raw token is never stored.

create table tv_displays (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  name text not null default 'Clubhouse TV',
  token_hash text not null unique,
  settings jsonb not null default '{"hideMoney": true, "secondsPerPanel": 15, "panels": ["live", "matches", "skins", "ctp", "highlights", "standings"]}',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table tv_displays enable row level security;
create policy "commissioners see tv displays" on tv_displays for select using (is_commissioner(league_id));
create policy "commissioners add tv displays" on tv_displays for insert
  with check (is_commissioner(league_id) and league_has_feature(league_id, 'tv_mode') and created_by = auth.uid());
create policy "commissioners edit tv displays" on tv_displays for update
  using (is_commissioner(league_id)) with check (is_commissioner(league_id) and league_has_feature(league_id, 'tv_mode'));
create policy "commissioners remove tv displays" on tv_displays for delete using (is_commissioner(league_id));

-- ── "We set up your league" ──────────────────────────────────────────────────

create table setup_requests (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  -- Path of the uploaded spreadsheet in private storage.
  file_path text,
  notes text,
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'done', 'needs_info')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table setup_requests enable row level security;
create policy "commissioners see setup requests" on setup_requests for select using (is_commissioner(league_id));
create policy "commissioners request setup" on setup_requests for insert
  with check (is_commissioner(league_id) and league_has_feature(league_id, 'setup_service') and requested_by = auth.uid() and status = 'requested');
-- Status updates come from GolfScoreHQ staff through the service role.

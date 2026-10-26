-- CTP "marker chain": each claim records whose marker the group's player got
-- inside of. Null means there was no marker yet (first group on the green).
-- The winner is the one claim nobody else beat, so tee order doesn't matter.

alter table ctp_reports
  add column beat_player_id uuid,
  add constraint ctp_reports_beat_player_fk
    foreign key (league_id, beat_player_id) references players (league_id, id),
  add constraint ctp_reports_beat_needs_winner
    check (beat_player_id is null or player_id is not null),
  add constraint ctp_reports_not_self
    check (beat_player_id is distinct from player_id);

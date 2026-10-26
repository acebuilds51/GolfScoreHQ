-- Fix: "nobody in our group got inside the marker" (no winner, no marker) was
-- rejected. The not-self rule compared two empty values and treated them as
-- the same golfer. It should only stop a golfer beating their own ball.

alter table ctp_reports drop constraint ctp_reports_not_self;
alter table ctp_reports
  add constraint ctp_reports_not_self check (beat_player_id is null or beat_player_id <> player_id);

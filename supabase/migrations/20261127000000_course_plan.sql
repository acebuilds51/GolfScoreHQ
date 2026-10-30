-- The Club plan is now sold to golf courses as the Course plan: every league
-- at the course, set up by staff and invoiced. No 5-league cap.
-- enforce_club_league_limit() compares against max_leagues; null means no limit.

update plans set name = 'Course', max_leagues = null where code = 'club';

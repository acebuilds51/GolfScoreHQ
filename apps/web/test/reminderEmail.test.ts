import { describe, expect, it } from 'vitest';
import { buildReminderEmail, leagueDay, localNow, reminderDue } from '../../../supabase/functions/send-reminders/email';

describe('reminder email', () => {
  it('asks about the right day, with one-tap answers and a way to stop', () => {
    const e = buildReminderEmail({
      leagueName: 'Oak <Creek>', playerName: 'Ben Gregory', weekNumber: 3, eventDate: '2027-04-29',
      answerUrl: 'https://golfscorehq.app/rsvp/abc', weekUrl: 'https://golfscorehq.app/l/oak/week/1',
    });
    expect(e.subject).toBe('Are you playing Thursday? Oak <Creek>, week 3');
    expect(e.text).toContain('Hi Ben,');
    expect(e.text).toContain("I'm in: https://golfscorehq.app/rsvp/abc?a=in");
    expect(e.text).toContain('https://golfscorehq.app/rsvp/abc?a=stop');
    expect(e.html).toContain('Oak &lt;Creek&gt;');
    expect(e.html).not.toContain('Oak <Creek>');
    expect(e.html).toContain('href="https://golfscorehq.app/rsvp/abc?a=out"');
  });

  it('goes out at 9 AM league time on the right day', () => {
    expect(leagueDay('2027-04-29')).toEqual({ day: 'Thursday', date: 'Apr 29' });
    // 2027-04-27 13:30 UTC is 9:30 AM in Detroit (EDT), 6:30 AM in Los Angeles.
    const now = new Date('2027-04-27T13:30:00Z');
    expect(localNow(now, 'America/Detroit')).toEqual({ date: '2027-04-27', hour: 9 });
    expect(reminderDue('2027-04-29', 2, now, 'America/Detroit')).toBe(true);
    expect(reminderDue('2027-04-29', 2, now, 'America/Los_Angeles')).toBe(false); // not 9 yet
    expect(reminderDue('2027-04-29', 1, now, 'America/Detroit')).toBe(false); // tomorrow
    expect(reminderDue('2027-05-01', 2, new Date('2027-04-29T23:00:00Z'), 'America/Detroit')).toBe(true); // later that day still counts
  });
});

import { describe, expect, it } from 'vitest';
import { daysLeft, reminderEmail, reminderFor } from '../../../supabase/functions/course-reminders/reminder';

const due = Date.parse('2027-01-31T12:00:00Z') / 1000; // first Founding invoice: sent Jan 1, 30 days to pay
const at = (iso: string) => Date.parse(`${iso}T13:00:00Z`); // the daily timer

describe('course invoice reminders', () => {
  it('counts calendar days to the due date', () => {
    expect(daysLeft(due, at('2027-01-17'))).toBe(14);
    expect(daysLeft(due, at('2027-01-24'))).toBe(7);
    expect(daysLeft(due, at('2027-01-31'))).toBe(0);
  });

  it('sends two weeks out, then the final one a week out, once each', () => {
    expect(reminderFor(due, at('2027-01-16'), [])).toBeNull();
    expect(reminderFor(due, at('2027-01-17'), [])).toBe('14');
    expect(reminderFor(due, at('2027-01-18'), ['14'])).toBeNull();
    expect(reminderFor(due, at('2027-01-24'), ['14'])).toBe('7');
    expect(reminderFor(due, at('2027-01-25'), ['14', '7'])).toBeNull();
  });

  it('catches up after a missed day and skips the two-week one when it is too late', () => {
    expect(reminderFor(due, at('2027-01-19'), [])).toBe('14');
    expect(reminderFor(due, at('2027-01-26'), [])).toBe('7');
    expect(reminderFor(due, at('2027-01-26'), ['7'])).toBeNull();
    expect(reminderFor(due, at('2027-02-01'), [])).toBeNull(); // overdue: Stripe's own emails take over
  });

  it('final reminder says what switches off and when', () => {
    const e = reminderEmail({ kind: '7', courseName: 'Crystal Lake', leagues: ['Tuesday Men', 'Ladies 9'], amountCents: 99000, dueSec: due, graceDays: 3, payUrl: 'https://pay.example/x', supportEmail: 'support@golfscorehq.app' });
    expect(e.subject).toContain('Final reminder');
    expect(e.subject).toContain('February 3, 2027');
    expect(e.text).toContain('$990');
    expect(e.text).toContain('Sunday, January 31, 2027');
    expect(e.text).toContain('Tuesday Men, Ladies 9');
    expect(e.text).toContain('they lose');
    expect(e.text).not.toContain('Nothing is deleted');
    expect(e.text).toContain('https://pay.example/x');
    const first = reminderEmail({ kind: '14', courseName: 'Crystal Lake', leagues: [], amountCents: 99000, dueSec: due, graceDays: 3, payUrl: null, supportEmail: 's@x.com' });
    expect(first.text).toContain('two weeks');
    expect(first.text).not.toContain('switches off');
  });
});

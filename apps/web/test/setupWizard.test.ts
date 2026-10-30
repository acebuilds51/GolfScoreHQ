import { describe, expect, it } from 'vitest';
import {
  answersForUs, buildPlan, checkAnswers, defaultAnswers, duesCents, planFeatures, seasonRules, seasonWeeks, teeTimes, type SetupAnswers,
} from '../src/lib/setupWizard';

const PRO = planFeatures(['side_games', 'all_formats', 'lineup', 'payments']);
const FREE = planFeatures([]);
const ctx = { hasCourse: true, hasSeason: false, existingNames: [] as string[] };

/** OCBC's answers: Thursdays, $5 a man with $10 presses, $180 skins, $36 CTP, $150 dues. */
function ocbc(): SetupAnswers {
  const a = defaultAnswers(new Date(2026, 9, 30));
  return {
    ...a,
    form: { ...a.form, format: 'bestBallMatch', matchStake: '5', pressesEnabled: true, pressStake: '10', skinsEnabled: true, skinsPot: '180', ctpEnabled: true, ctpAmount: '36' },
    firstWeek: '2027-04-29', weeks: '5', skipped: ['2027-05-27'],
    teeFirst: '17:00', teeEvery: '8', teeCount: '3', dues: '150',
    roster: 'Mike Walsh, mike@example.com\nChris Lee, sub\nSmith, John',
  };
}

describe('setup questions', () => {
  it('starts next year once the season is over', () => {
    expect(defaultAnswers(new Date(2026, 9, 30)).year).toBe('2027');
    expect(defaultAnswers(new Date(2027, 2, 1)).year).toBe('2027');
  });

  it("turns OCBC's answers into the season, weeks, tee times and dues", () => {
    const a = ocbc();
    const rules = seasonRules(a, PRO);
    expect(rules).toMatchObject({ format: 'bestBallMatch', match: { stake: 500 }, presses: { enabled: true, stake: 1000 }, skins: { enabled: true, pot: 18000 }, ctp: { enabled: true, amountPerHole: 3600 } });
    // Memorial Day week off: the 5 weeks move along.
    expect(seasonWeeks(a).dates).toEqual(['2027-04-29', '2027-05-06', '2027-05-13', '2027-05-20', '2027-06-03']);
    expect(teeTimes(a, PRO)).toEqual(['17:00', '17:08', '17:16']);
    expect(duesCents(a, PRO)).toBe(15000);
    expect(checkAnswers(a, PRO, false)).toBeNull();

    const plan = buildPlan(a, PRO, ctx);
    expect(plan[0]).toMatch(/^Start the 2027 season on Thursdays: 2 vs 2 best ball match, \$5 a man on the match, presses \$10 a man/);
    expect(plan).toContain('Tee times every week: 5:00 PM, 5:08 PM, 5:16 PM');
    expect(plan).toContain("Season dues: $150 a golfer, with a checklist of who's paid");
    expect(plan).toContain('Match and press money: golfers settle it with each other');
    expect(plan.at(-1)).toBe('Add 2 golfers and 1 sub to the roster');
  });

  it('keeps Free leagues to what Free allows', () => {
    const a = ocbc();
    const rules = seasonRules(a, FREE);
    expect(rules).toMatchObject({ skins: { enabled: false }, ctp: { enabled: false } });
    expect(teeTimes(a, FREE)).toEqual([]);
    expect(duesCents(a, FREE)).toBeNull();
    expect(checkAnswers({ ...a, form: { ...a.form, format: 'stableford' } }, FREE, false)).toMatch(/Stableford needs GolfScoreHQ Pro/);
  });

  it('only adds what is missing when the season already exists', () => {
    const a = ocbc();
    const plan = buildPlan(a, PRO, { hasCourse: true, hasSeason: true, existingNames: ['Mike Walsh'] });
    expect(plan).toEqual(['Add 1 golfer and 1 sub to the roster']);
    expect(checkAnswers({ ...a, year: 'x' }, PRO, true)).toBeNull(); // season answers aren't used
  });

  it('asks for what is missing', () => {
    const a = ocbc();
    expect(checkAnswers({ ...a, year: '27' }, PRO, false)).toMatch(/season year/);
    expect(checkAnswers({ ...a, weeks: '0' }, PRO, false)).toMatch(/How many weeks/);
    expect(checkAnswers({ ...a, teeFirst: '' }, PRO, false)).toMatch(/tee off/);
  });

  it('writes the answers up for "We set up your league"', () => {
    const text = answersForUs(ocbc(), FREE, ctx);
    expect(text).toContain('Season: 2027, Thursdays, first week 2027-04-29, 5 weeks, off: 2027-05-27');
    expect(text).toContain('skins $180 pot');
    expect(text).toContain('Tee times: 3 groups from 5:00 PM, 8 minutes apart');
    expect(text).toContain('Golfers (3): Mike Walsh, Chris Lee (sub), John Smith');
    expect(text).toContain('side games will need Pro');
  });
});

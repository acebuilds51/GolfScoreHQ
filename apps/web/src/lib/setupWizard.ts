// "Set up my league" questionnaire: plain questions a commissioner can answer
// in a few minutes, turned into the season, its weeks, tee times, dues and
// roster. Kept apart from the screen so it's easy to test.
import type { FormatRules } from '@golfscorehq/engine';
import { BASIC_FORMATS, describeRules, FORMAT_NAMES, handicapsFromForm, OCBC_STYLE_FORM, plainRules, playsForMoney, rulesFromForm, type SideGameForm } from './scoring';
import { scheduleDates } from './schedule';
import { fmtTeeTime, teeTimesFrom } from './teeSheet';
import { parseRoster } from './util';
import type { MatchMoney } from './types';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface SetupAnswers {
  /** Format, side games and handicaps (the same fields as the season form). */
  form: SideGameForm;
  year: string;
  leagueDay: number;
  /** First league night, yyyy-mm-dd ('' = not decided yet). */
  firstWeek: string;
  weeks: string;
  /** Nights off (holidays, course events), yyyy-mm-dd. */
  skipped: string[];
  /** First tee time "17:00"; '' = no tee times. */
  teeFirst: string;
  teeEvery: string;
  teeCount: string;
  /** What each golfer pays the commissioner up front for the season, in dollars ('' = no dues). */
  dues: string;
  matchMoney: MatchMoney;
  /** Golfers pasted one per line. */
  roster: string;
}

export function defaultAnswers(today = new Date()): SetupAnswers {
  const year = today.getMonth() >= 8 ? today.getFullYear() + 1 : today.getFullYear();
  return {
    form: { ...OCBC_STYLE_FORM, matchStake: '0', pressesEnabled: false, skinsEnabled: false, ctpEnabled: false },
    year: String(year), leagueDay: 4, firstWeek: '', weeks: '18', skipped: [],
    teeFirst: '', teeEvery: '8', teeCount: '', dues: '', matchMoney: 'golfers', roster: '',
  };
}

/** What the league's plan allows (from league.features). */
export interface PlanFeatures {
  sideGames: boolean;
  allFormats: boolean;
  teeSheet: boolean;
  payments: boolean;
}

export const planFeatures = (features: string[]): PlanFeatures => ({
  sideGames: features.includes('side_games'),
  allFormats: features.includes('all_formats'),
  teeSheet: features.includes('lineup'),
  payments: features.includes('payments'),
});

/** The season's rules. Free leagues keep the format and handicaps; side games need Pro. */
export function seasonRules(a: SetupAnswers, plan: PlanFeatures): FormatRules {
  if (plan.sideGames) return rulesFromForm(a.form);
  return { ...plainRules(a.form.format), handicaps: handicapsFromForm(a.form) } as FormatRules;
}

export const seasonWeeks = (a: SetupAnswers) =>
  a.firstWeek ? scheduleDates(a.firstWeek, Math.min(40, Math.max(0, Number(a.weeks) || 0)), new Set(a.skipped)) : { dates: [], all: [] };

export function teeTimes(a: SetupAnswers, plan: PlanFeatures): string[] {
  const n = Math.min(30, Math.max(0, Number(a.teeCount) || 0));
  if (!plan.teeSheet || !/^\d{1,2}:\d{2}$/.test(a.teeFirst) || !n) return [];
  return teeTimesFrom(a.teeFirst, Math.min(30, Math.max(1, Number(a.teeEvery) || 8)), n);
}

export const duesCents = (a: SetupAnswers, plan: PlanFeatures): number | null => {
  const d = Math.round((Number(a.dues.replace(/^\$/, '')) || 0) * 100);
  return plan.payments && d > 0 ? d : null;
};

export const rosterFrom = (a: SetupAnswers, existingNames: string[] = []) => parseRoster(a.roster, existingNames);

/** A problem that stops the build, in words the commissioner can act on; null when it's good to go. */
export function checkAnswers(a: SetupAnswers, plan: PlanFeatures, hasSeason: boolean): string | null {
  if (!hasSeason) {
    const y = Number(a.year);
    if (!(y >= 2020 && y <= 2100)) return 'Enter the season year, e.g. 2027.';
    if (!plan.allFormats && !BASIC_FORMATS.includes(a.form.format)) return `${FORMAT_NAMES[a.form.format]} needs GolfScoreHQ Pro. Pick another format, or upgrade first.`;
    if (a.firstWeek && !seasonWeeks(a).dates.length) return 'How many weeks do you play?';
    if (a.teeCount && !/^\d{1,2}:\d{2}$/.test(a.teeFirst)) return 'When does the first group tee off?';
  }
  if (a.dues && !(Number(a.dues.replace(/^\$/, '')) >= 0)) return 'Season dues: enter a dollar amount, like 150.';
  return null;
}

export interface SetupContext {
  hasCourse: boolean;
  hasSeason: boolean;
  existingNames: string[];
}

/** What "Build my league" will do, in order, for the review screen. */
export function buildPlan(a: SetupAnswers, plan: PlanFeatures, ctx: SetupContext): string[] {
  const out: string[] = [];
  if (!ctx.hasSeason) {
    const rules = seasonRules(a, plan);
    out.push(`Start the ${a.year} season on ${DAYS[a.leagueDay]}s: ${describeRules(rules).join(', ')}`);
    const { dates } = seasonWeeks(a);
    if (dates.length) out.push(`Add ${dates.length} week${dates.length === 1 ? '' : 's'}, ${fmtDay(dates[0]!)} to ${fmtDay(dates.at(-1)!)}${ctx.hasCourse ? '' : ' (pick the course for each week once it\'s added)'}`);
    const times = teeTimes(a, plan);
    if (times.length) out.push(`Tee times every week: ${times.map(fmtTeeTime).join(', ')}`);
    const dues = duesCents(a, plan);
    if (dues && playsForMoney(rules)) out.push(`Season dues: $${dues / 100} a golfer, with a checklist of who's paid`);
    if (plan.payments && rules.format === 'bestBallMatch' && (rules.match.stake > 0 || rules.presses.enabled)) {
      out.push(a.matchMoney === 'golfers' ? 'Match and press money: golfers settle it with each other' : 'Match and press money: it goes through you');
    }
  }
  const { players } = rosterFrom(a, ctx.existingNames);
  if (players.length) {
    const subs = players.filter((p) => p.isSub).length;
    out.push(`Add ${players.length - subs} golfer${players.length - subs === 1 ? '' : 's'}${subs ? ` and ${subs} sub${subs === 1 ? '' : 's'}` : ''} to the roster`);
  }
  return out;
}

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** The answers as a note for "We set up your league", so staff start from them. */
export function answersForUs(a: SetupAnswers, plan: PlanFeatures, ctx: SetupContext): string {
  const proRules = rulesFromForm(a.form);
  const lines = [
    'From the setup questions:',
    `Season: ${a.year}, ${DAYS[a.leagueDay]}s${a.firstWeek ? `, first week ${a.firstWeek}, ${a.weeks} weeks` : ''}${a.skipped.length ? `, off: ${a.skipped.join(', ')}` : ''}`,
    `Format: ${describeRules(proRules).join(', ')}`,
    a.teeFirst && a.teeCount ? `Tee times: ${a.teeCount} groups from ${fmtTeeTime(a.teeFirst)}, ${a.teeEvery} minutes apart` : 'Tee times: none given',
    a.dues ? `Season dues: $${a.dues.replace(/^\$/, '')} a golfer` : 'Season dues: none',
    `Match money: ${a.matchMoney === 'golfers' ? 'golfers settle it themselves' : 'goes through the commissioner'}`,
  ];
  const { players } = rosterFrom(a, ctx.existingNames);
  if (players.length) lines.push(`Golfers (${players.length}): ${players.map((p) => p.displayName + (p.isSub ? ' (sub)' : '')).join(', ')}`);
  if (!plan.sideGames) lines.push('(League is on Free: side games will need Pro.)');
  return lines.join('\n');
}

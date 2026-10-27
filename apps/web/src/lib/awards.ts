import type { Award } from '@golfscorehq/engine';
import { fmtMoney } from './scoring';
import { fmtToPar } from './standings';

// How each season award reads on screen and on the share picture.

export const AWARD_UNITS: Record<Award['key'], (v: number) => string> = {
  lowAverage: (v) => `${fmtToPar(v)} a round`,
  bestRound: (v) => `${fmtToPar(v)} round`,
  mostSkins: (v) => `${v} skin${v === 1 ? '' : 's'}`,
  ctpKing: (v) => `${v} CTP${v === 1 ? '' : 's'}`,
  birdieMachine: (v) => `${v} birdie${v === 1 ? '' : 's'}`,
  eagleClub: () => '',
  aceClub: () => '',
  matchPlayChamp: (v) => `${v} match win${v === 1 ? '' : 's'}`,
  weeklyWins: (v) => `${v} week${v === 1 ? '' : 's'} won`,
  pointsLeader: (v) => `${v} points`,
  moneyLeader: (v) => `+${fmtMoney(v)}`,
  hotStreak: (v) => `${v} better lately`,
  mostImproved: (v) => `handicap down ${v}`,
};

export const AWARD_ICONS: Record<Award['key'], string> = {
  lowAverage: '🏆', bestRound: '⛳', mostSkins: '💰', ctpKing: '🎯', birdieMachine: '🐦', eagleClub: '🦅', aceClub: '🕳️',
  matchPlayChamp: '🤝', weeklyWins: '🥇', pointsLeader: '📈', moneyLeader: '💵', hotStreak: '🔥', mostImproved: '📉',
};

/** Awards with money in them, for hiding when the league doesn't want amounts shown. */
export const MONEY_AWARDS: Award['key'][] = ['moneyLeader'];

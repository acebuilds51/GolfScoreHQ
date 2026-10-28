import { settleIndividualWeek } from './individual';
import { isIndividual, type FormatRules } from './rules';
import { scrambleRoundFrom, settleScrambleWeek } from './scramble';
import type { Layout, LedgerEntry, MatchRoundInput, PlayerId } from './types';
import { settleBestBallWeek } from './week';

/** Settle a week in any format. */
export function settleAnyWeek(rounds: MatchRoundInput[], layout: Layout, rules: FormatRules) {
  if (rules.format === 'scramble') return settleScrambleWeek(rounds.map(scrambleRoundFrom), layout, rules);
  if (isIndividual(rules)) return settleIndividualWeek(rounds, layout, rules);
  return settleBestBallWeek(rounds, layout, rules);
}

export interface WeekPosting {
  /** Everything to post: the week's ledger plus CTP holes the commissioner decided. */
  ledger: LedgerEntry[];
  /** CTP holes two groups both claimed that nobody has decided yet (they pay nothing). */
  undecided: number[];
  /** The week as the engine settled it (matches, skins, CTP, leaderboards). */
  week: ReturnType<typeof settleAnyWeek>;
}

/**
 * What settling the week posts. Used by the commissioner's Settle button and by
 * the server's auto-settle, so both give the same money.
 * decisions: the commissioner's pick for each disputed CTP hole.
 */
export function weekPosting(rounds: MatchRoundInput[], layout: Layout, rules: FormatRules, decisions: Record<number, PlayerId> = {}): WeekPosting {
  const week = settleAnyWeek(rounds, layout, rules);
  const ledger = [...week.ledger];
  const undecided: number[] = [];
  for (const h of week.ctp.holes) {
    if (!h.conflict) continue;
    const pick = decisions[h.holeNumber];
    if (pick && h.contenders.includes(pick)) {
      const round = rounds.find((r) => r.players.some((p) => p.id === pick));
      if (rules.ctp.amountPerHole > 0) ledger.push({ playerId: pick, amount: rules.ctp.amountPerHole, kind: 'ctp', holeNumber: h.holeNumber, ...(round ? { roundId: round.id } : {}) });
    } else {
      undecided.push(h.holeNumber);
    }
  }
  return { ledger, undecided, week };
}

import { dollars } from './money';
import type { BestBallMatchRules, ScrambleRules } from './rules';

// Format templates commissioners start from. Each is a plain rules object;
// a league copies one and adjusts the dials.

/** OCBC Golf League regular week: 2v2 best-ball match, presses, field skins, CTP. */
export const OCBC_BEST_BALL: BestBallMatchRules = {
  format: 'bestBallMatch',
  holeScoring: 'bestBall',
  match: { stake: dollars(5) },
  presses: { enabled: true, stake: dollars(10) },
  skins: { enabled: true, tieRule: 'noSkin', payout: 'splitPot', pot: dollars(180) },
  ctp: { enabled: true, amountPerHole: dollars(36), resolution: 'latestTeeSlot' },
};

/**
 * OCBC scramble week: lowest team total takes the team pot, team skins carry
 * over on ties. The legacy app never paid scramble CTP or credited scramble
 * skins to anyone's money, so CTP is $0 here until the league decides.
 */
export const OCBC_SCRAMBLE: ScrambleRules = {
  format: 'scramble',
  teamPot: dollars(120),
  skins: { enabled: true, tieRule: 'carryover', payout: 'perHole', pot: dollars(130) },
  ctp: { enabled: true, amountPerHole: 0, resolution: 'latestTeeSlot' },
};

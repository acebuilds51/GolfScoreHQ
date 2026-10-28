import { describe, expect, it } from 'vitest';
import { fmtTeeTime, matchRecipients, openSpotRecipients, partnerRecipients, sheetView, teeTimesFrom } from '../src/lib/teeSheet';
import type { Player, TeeSheet } from '../src/lib/types';

const p = (id: string, isSub = false): Player => ({ id, displayName: id, isSub, active: true, userId: null, handicapIndex: null, ghinNumber: null, handicapIndexUpdatedAt: null });
const players = ['cap1', 'a', 'b', 'cap2', 'me', 'mate', 'lone', 'pair1', 'pair2', 'gone', 'quiet', 'maybe'].map((id) => p(id)).concat([p('sub', true)]);

// T1 is full, T2 has the captain only; I need a partner; pair1/pair2 need a match; gone is out.
const sheet: TeeSheet = {
  times: [{ slot: 1, time: '17:10', captainId: 'cap1' }, { slot: 2, time: '17:17', captainId: 'cap2' }],
  lineup: [
    { playerId: 'a', slot: 1, looking: null, partnerId: null },
    { playerId: 'cap1', slot: 1, looking: null, partnerId: null },
    { playerId: 'b', slot: 1, looking: null, partnerId: null },
    { playerId: 'mate', slot: 1, looking: null, partnerId: null },
    { playerId: 'cap2', slot: 2, looking: null, partnerId: null },
    { playerId: 'lone', slot: null, looking: 'partner', partnerId: null },
    { playerId: 'pair1', slot: null, looking: 'match', partnerId: 'pair2' },
    { playerId: 'pair2', slot: null, looking: 'match', partnerId: 'pair1' },
  ],
  custom: false,
  seasonTimes: 2,
};
const view = sheetView(sheet, players, { gone: 'out', maybe: 'maybe', me: 'in' });

describe('tee sheet', () => {
  it('lists groups (captain first), who is looking, out, and who has not answered', () => {
    expect(view.groups.map((g) => [g.slot, g.members, g.open])).toEqual([[1, ['cap1', 'a', 'b', 'mate'], 0], [2, ['cap2'], 3]]);
    expect(view.needPartner).toEqual(['lone']);
    expect(view.teams).toEqual([['pair1', 'pair2']]);
    expect(view.out).toEqual(['gone']);
    expect(view.playingNoGroup).toEqual(['me', 'maybe']);
    expect(view.noReply).toEqual(['quiet']); // subs aren't chased
  });

  it('"I need a partner" goes to everyone not in a group, not paired up and not out', () => {
    expect(partnerRecipients(view, players, 'me').sort()).toEqual(['lone', 'maybe', 'quiet', 'sub']);
  });

  it('"we need a match" goes to groups with room, golfers looking and other pairs', () => {
    expect(matchRecipients(view, 'pair1', 'pair2').sort()).toEqual(['cap2', 'lone']);
    expect(matchRecipients(view, 'me', 'lone').sort()).toEqual(['cap2', 'pair1', 'pair2']);
  });

  it('"our group has room" goes to golfers looking and golfers playing without a group', () => {
    expect(openSpotRecipients(view, 'cap2').sort()).toEqual(['lone', 'maybe', 'me', 'pair1', 'pair2']);
  });

  it('reads and makes tee times', () => {
    expect(teeTimesFrom('17:10', 7, 3)).toEqual(['17:10', '17:17', '17:24']);
    expect(teeTimesFrom('11:55', 10, 2)).toEqual(['11:55', '12:05']);
    expect([fmtTeeTime('17:10'), fmtTeeTime('12:05'), fmtTeeTime('00:30'), fmtTeeTime(null)]).toEqual(['5:10 PM', '12:05 PM', '12:30 AM', '']);
  });
});

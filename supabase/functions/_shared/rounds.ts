// A week's groups from the database, in the shape the scoring engine takes
// (the same shape the app builds with toEngineRound).
// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

/** What to select from rounds to build engine rounds. */
export const ROUND_SELECT = 'id, tee_slot, round_players(player_id, side, position, course_handicap), hole_scores(player_id, hole_number, strokes), presses(start_hole_number, called_by, created_at), ctp_reports(hole_number, player_id, beat_player_id)';

export function engineRounds(rounds: Row[], layout: { holes: Row[] }) {
  return rounds.map((r: Row) => {
    const scores: Record<string, (number | null)[]> = {};
    for (const p of r.round_players as Row[]) {
      scores[p.player_id] = layout.holes.map((h) => (r.hole_scores as Row[]).find((s) => s.player_id === p.player_id && s.hole_number === h.number)?.strokes ?? null);
    }
    const ctp: Record<number, unknown> = {};
    for (const c of r.ctp_reports as Row[]) ctp[c.hole_number] = c.player_id ? { winner: c.player_id, beat: c.beat_player_id } : 'none';
    return {
      id: r.id, teeSlot: r.tee_slot,
      players: (r.round_players as Row[]).sort((a, b) => a.position - b.position).map((p) => (p.side ? { id: p.player_id, side: p.side } : { id: p.player_id })),
      // Handicaps fixed when the group started, so results match the app's (net or gross).
      courseHandicaps: Object.fromEntries((r.round_players as Row[]).map((p) => [p.player_id, p.course_handicap ?? null])),
      scores,
      presses: (r.presses as Row[]).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((p) => ({ startHoleIndex: layout.holes.findIndex((h) => h.number === p.start_hole_number), calledBy: p.called_by }))
        .filter((p) => p.startHoleIndex >= 0),
      ctp,
    };
  });
}

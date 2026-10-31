import type { LedgerKind } from './types';
import type { SeasonData } from './seasonData';

/**
 * Export (Pro): a season as spreadsheets a commissioner can open in Excel or Google Sheets.
 * CSV, one file each: every golfer's scores hole by hole, every dollar posted, and the standings.
 */

const KIND_LABEL: Record<LedgerKind, string> = {
  match: 'Match', press: 'Press', skin: 'Skin', ctp: 'Closest to the pin', scramblePot: 'Scramble pot', place: 'Place',
};

/** One CSV cell: quoted when it has a comma, quote or line break. Leading =, +, - or @ is kept as text so spreadsheets don't run it. */
function cell(v: string | number | null | undefined): string {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** Every golfer's round, hole by hole: one row per golfer per week. */
export function scoresCsv(d: SeasonData): string {
  const events = new Map(d.events.map((e) => [e.id, e]));
  const layouts = new Map(d.layouts.map((l) => [l.id, l]));
  const names = new Map(d.players.map((p) => [p.id, p.displayName]));
  // A column per hole number, so a back nine's scores land under holes 10–18.
  const holes = Math.max(9, ...d.layouts.flatMap((l) => l.holes.map((h) => h.number)));
  const rows: (string | number | null)[][] = [];
  const sorted = [...d.rounds]
    .filter((r) => events.has(r.eventId))
    .sort((a, b) => events.get(a.eventId)!.weekNumber - events.get(b.eventId)!.weekNumber || a.teeSlot - b.teeSlot);
  for (const r of sorted) {
    const ev = events.get(r.eventId)!;
    const layout = ev.layoutId ? layouts.get(ev.layoutId) : undefined;
    for (const rp of [...r.players].sort((a, b) => a.position - b.position)) {
      const byHole = r.scores[rp.playerId] ?? {};
      const strokes = Array.from({ length: holes }, (_, i) => byHole[i + 1] ?? null);
      const played = strokes.filter((s): s is number => s != null);
      rows.push([
        ev.weekNumber, ev.eventDate, layout?.name ?? '', r.teeSlot, names.get(rp.playerId) ?? '', rp.courseHandicap ?? null,
        ...strokes, played.length ? played.reduce((a, b) => a + b, 0) : null,
      ]);
    }
  }
  const head = ['Week', 'Date', 'Course', 'Tee time', 'Golfer', 'Course handicap', ...Array.from({ length: holes }, (_, i) => `Hole ${i + 1}`), 'Total'];
  return toCsv([head, ...rows]);
}

/** Every dollar posted for the season's settled weeks: who, what for, and how much (minus = owed). */
export function moneyCsv(d: SeasonData): string {
  const events = new Map(d.events.map((e) => [e.id, e]));
  const names = new Map(d.players.map((p) => [p.id, p.displayName]));
  const rows = d.ledger
    .filter((e) => events.get(e.eventId)?.status === 'settled')
    .sort((a, b) => events.get(a.eventId)!.weekNumber - events.get(b.eventId)!.weekNumber || (names.get(a.playerId) ?? '').localeCompare(names.get(b.playerId) ?? ''))
    .map((e) => [events.get(e.eventId)!.weekNumber, names.get(e.playerId) ?? '', KIND_LABEL[e.kind] ?? e.kind, e.holeNumber, dollars(e.amountCents)]);
  return toCsv([['Week', 'Golfer', 'For', 'Hole', 'Amount ($)'], ...rows]);
}

/** The season's standings, as the Standings page shows them. */
export function standingsCsv(d: SeasonData): string {
  const rows = d.standings.rows.map((r) => [
    r.name, r.isSub ? 'Sub' : '', r.rounds, r.average, r.averageToPar, r.wins, r.losses, r.halves, r.weekWins, r.points, r.skins, r.ctps, dollars(r.money),
  ]);
  return toCsv([['Golfer', 'Sub', 'Rounds', 'Average', 'Average to par', 'Match wins', 'Losses', 'Halves', 'Weeks won', 'Stableford points', 'Skins', 'Closest to the pin', 'Money ($)'], ...rows]);
}

/** Save a file the browser hands to the person (Downloads on a computer, Files on a phone). */
export function download(filename: string, csv: string) {
  // The byte-order mark tells Excel the file is UTF-8, so names with accents come out right.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "maple-wednesday-2026-scores.csv" */
export function exportName(leagueSlug: string, seasonName: string, what: string): string {
  const part = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${part(leagueSlug)}-${part(seasonName)}-${what}.csv`;
}

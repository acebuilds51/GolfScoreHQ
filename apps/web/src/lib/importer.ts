import type { Layout, Player } from './types';

// Spreadsheet import: turn what a league already has (a pasted or CSV sheet
// with one row per golfer per round, or the old OCBC app's export) into weeks,
// groups and hole-by-hole scores. Pure: nothing here touches the database.

// ── Reading a table ──────────────────────────────────────────────────────────

/** CSV, or tab-separated (what you get copying cells out of Excel or Google Sheets). Quotes are handled. */
export function parseTable(text: string): string[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = clean.split('\n', 1)[0] ?? '';
  const delim = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

// ── Columns ──────────────────────────────────────────────────────────────────

export type ColumnRole = 'ignore' | 'week' | 'date' | 'golfer' | 'tee' | 'team' | 'nine' | 'total' | `hole:${number}`;

/** Best guess at what each header means; the commissioner can change any of them. */
export function guessColumns(header: string[]): ColumnRole[] {
  const used = new Set<string>();
  return header.map((raw) => {
    const h = raw.toLowerCase().replace(/[^a-z0-9# ]/g, ' ').replace(/\s+/g, ' ').trim();
    const hole = h.match(/^(?:h|hole|hole #|#)?\s*(\d{1,2})$/);
    let role: ColumnRole = 'ignore';
    if (hole && Number(hole[1]) >= 1 && Number(hole[1]) <= 18) role = `hole:${Number(hole[1])}`;
    else if (/^(wk|week|week #|week no|week number|rd|round|round #)$/.test(h)) role = 'week';
    else if (/date/.test(h)) role = 'date';
    else if (/^(name|golfer|player|golfer name|player name|first last)$/.test(h) || /name$/.test(h)) role = 'golfer';
    else if (/^(tee|tee time|tee slot|group|flight|tee #|tt)$/.test(h)) role = 'tee';
    else if (/^(team|side|match side)$/.test(h)) role = 'team';
    else if (/^(nine|9|front back|course|layout)$/.test(h)) role = 'nine';
    else if (/^(total|tot|score|gross|gross score)$/.test(h)) role = 'total';
    if (role !== 'ignore' && !role.startsWith('hole:') && used.has(role)) return 'ignore';
    used.add(role);
    return role;
  });
}

// ── The plan ─────────────────────────────────────────────────────────────────

export interface PlanPlayer {
  name: string;
  side: 'A' | 'B' | null;
  isSub: boolean;
  /** Keyed by the layout's hole number. */
  scores: Record<number, number>;
}

export interface PlanGroup {
  teeSlot: number;
  players: PlanPlayer[];
  presses: { startHole: number; calledBy: 'A' | 'B' }[];
  /** Hole number → who in this group won closest to the pin (null = nobody). */
  ctp: Record<number, string | null>;
}

export interface PlanWeek {
  week: number;
  date: string | null;
  layoutId: string;
  groups: PlanGroup[];
}

export interface ImportPlan {
  weeks: PlanWeek[];
  /** Everyone in the file, first spelling seen. */
  names: string[];
  /** Golfers marked as subs in the file (OCBC export). */
  subs: string[];
  /** Things that were skipped, for the commissioner to read before importing. */
  problems: string[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Match a golfer in the file to the roster by name (case and spacing don't matter). */
export function matchRoster(names: string[], roster: Pick<Player, 'id' | 'displayName'>[]): { matched: Record<string, string>; missing: string[] } {
  const byName = new Map(roster.map((p) => [norm(p.displayName), p.id]));
  const matched: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const id = byName.get(norm(n));
    if (id) matched[n] = id;
    else missing.push(n);
  }
  return { matched, missing };
}

/** Which layout a "nine" value means: a layout name, or front/back for the first/second layout. */
function layoutFor(value: string | null, layouts: Layout[], fallback: string): string {
  if (!value) return fallback;
  const v = norm(value);
  const exact = layouts.find((l) => norm(l.name) === v);
  if (exact) return exact.id;
  const front = layouts.find((l) => /front|out/i.test(l.name)) ?? layouts[0];
  const back = layouts.find((l) => /back|in\b/i.test(l.name)) ?? layouts[1];
  if (/^(f|front|out|front 9|1)$/.test(v) && front) return front.id;
  if (/^(b|back|in|back 9|2)$/.test(v) && back) return back.id;
  return layouts.find((l) => norm(l.name).includes(v))?.id ?? fallback;
}

/** Scores in the file's hole order mapped onto the layout's hole numbers (1–9 also fits a back nine). */
function onLayout(holes: Record<number, number>, layout: Layout): Record<number, number> {
  const out: Record<number, number> = {};
  const nums = Object.keys(holes).map(Number).sort((a, b) => a - b);
  const direct = nums.every((n) => layout.holes.some((h) => h.number === n));
  nums.forEach((n, i) => {
    const target = direct ? n : layout.holes[i]?.number;
    if (target !== undefined) out[target] = holes[n]!;
  });
  return out;
}

const score = (s: string | undefined): number | null => {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
};

/**
 * One row per golfer per round. Rows without a week use their date (weeks
 * numbered in date order). Golfers with the same week and tee time are one
 * group; without a tee column, golfers are grouped in fours in sheet order.
 */
export function planFromTable(rows: string[][], roles: ColumnRole[], layouts: Layout[], defaultLayoutId: string): ImportPlan {
  const problems: string[] = [];
  const col = (role: ColumnRole) => roles.indexOf(role);
  const holeCols = roles.map((r, i) => (r.startsWith('hole:') ? { i, n: Number(r.slice(5)) } : null)).filter((x): x is { i: number; n: number } => !!x);
  if (col('golfer') < 0) return { weeks: [], names: [], subs: [], problems: ['Pick which column has the golfer names.'] };
  if (col('week') < 0 && col('date') < 0) return { weeks: [], names: [], subs: [], problems: ['Pick the week or date column.'] };
  if (!holeCols.length) return { weeks: [], names: [], subs: [], problems: ['Pick the hole-by-hole score columns (1, 2, 3…). A total on its own isn\'t enough for averages and handicaps.'] };

  const dates = col('week') < 0 ? [...new Set(rows.map((r) => r[col('date')] ?? '').filter(Boolean))].sort((a, b) => Date.parse(a) - Date.parse(b) || a.localeCompare(b)) : [];
  const names: string[] = [];
  const weeks = new Map<number, { date: string | null; layoutId: string; entries: { tee: number | null; player: PlanPlayer }[] }>();
  let noScores = 0;

  rows.forEach((r, idx) => {
    const name = (r[col('golfer')] ?? '').trim();
    if (!name) return;
    const week = col('week') >= 0 ? Number((r[col('week')] ?? '').replace(/[^\d]/g, '')) : dates.indexOf(r[col('date')] ?? '') + 1;
    if (!(week >= 1 && week <= 60)) { problems.push(`Row ${idx + 2}: no week for ${name}, skipped.`); return; }
    const holes: Record<number, number> = {};
    for (const h of holeCols) {
      const s = score(r[h.i]);
      if (s !== null) holes[h.n] = s;
    }
    if (!Object.keys(holes).length) { noScores++; return; }
    const date = col('date') >= 0 ? r[col('date')] || null : null;
    const nine = col('nine') >= 0 ? r[col('nine')] ?? null : null;
    const w = weeks.get(week) ?? { date, layoutId: layoutFor(nine, layouts, defaultLayoutId), entries: [] };
    const layout = layouts.find((l) => l.id === w.layoutId)!;
    const team = col('team') >= 0 ? (r[col('team')] ?? '').trim().toUpperCase() : '';
    const tee = col('tee') >= 0 ? Number((r[col('tee')] ?? '').replace(/[^\d]/g, '')) || null : null;
    if (!names.some((n) => norm(n) === norm(name))) names.push(name);
    w.entries.push({ tee, player: { name, side: team === 'A' || team === '1' ? 'A' : team === 'B' || team === '2' ? 'B' : null, isSub: false, scores: onLayout(holes, layout) } });
    weeks.set(week, w);
  });
  if (noScores) problems.push(`${noScores} row${noScores === 1 ? ' has' : 's have'} no hole scores and ${noScores === 1 ? 'was' : 'were'} skipped.`);

  return {
    weeks: [...weeks].sort((a, b) => a[0] - b[0]).map(([week, w]) => ({ week, date: w.date, layoutId: w.layoutId, groups: groupUp(w.entries) })),
    names,
    subs: [],
    problems,
  };
}

function groupUp(entries: { tee: number | null; player: PlanPlayer }[]): PlanGroup[] {
  const group = (teeSlot: number, players: PlanPlayer[]): PlanGroup => ({ teeSlot, players, presses: [], ctp: {} });
  if (entries.every((e) => e.tee !== null)) {
    const byTee = new Map<number, PlanPlayer[]>();
    for (const e of entries) byTee.set(e.tee!, [...(byTee.get(e.tee!) ?? []), e.player]);
    return [...byTee].sort((a, b) => a[0] - b[0]).map(([t, ps]) => group(t, ps));
  }
  const out: PlanGroup[] = [];
  for (let i = 0; i < entries.length; i += 4) out.push(group(out.length + 1, entries.slice(i, i + 4).map((e) => e.player)));
  return out;
}

// ── The old OCBC app's export ────────────────────────────────────────────────

interface LegacyRound {
  week: number;
  side: 'front' | 'back';
  teeTime: number | string;
  isScramble?: boolean;
  players: { name: string; isSub?: boolean }[];
  scores: Record<string, number>[];
  presses?: { startHole: number | string; calledBy: 'A' | 'B' }[];
  ctpWinners?: Record<string, string>;
}

/**
 * The OCBC app's round records, from any of the shapes it comes in: a plain
 * list, a saved copy of its data ({ weeks }), or what its Google Sheet script
 * returns for ?action=getAllRounds ({ ok, rounds }).
 */
function ocbcRounds(text: string): LegacyRound[] | null {
  try {
    const v = JSON.parse(text);
    const list = Array.isArray(v) ? v : Array.isArray(v?.rounds) ? v.rounds : Array.isArray(v?.weeks) ? v.weeks : null;
    return list?.length && list.every((r: unknown) => typeof r === 'object' && r !== null && 'players' in r && 'scores' in r && 'week' in r) ? list : null;
  } catch {
    return null;
  }
}

/** True when the text is the OCBC app's export. */
export function isOcbcExport(text: string): boolean {
  return ocbcRounds(text) !== null;
}

/**
 * The OCBC export: teams (first two players A, next two B, a fifth plays
 * skins only), hole scores (99 = no score), presses and CTPs. CTPs follow the
 * old app's rule: the latest tee time that claimed a hole won it. Scramble
 * rounds are left out (team scores aren't anyone's own round).
 */
export function planFromOcbc(text: string, layouts: Layout[]): ImportPlan {
  const all = ocbcRounds(text);
  if (!all) throw new Error("this isn't the OCBC app's export");
  const problems: string[] = [];
  const scramble = all.filter((r) => r.isScramble).length;
  if (scramble) problems.push(`${scramble} scramble round${scramble === 1 ? '' : 's'} left out (team scores don't count as anyone's own round).`);
  const front = layouts.find((l) => /front|out/i.test(l.name)) ?? layouts[0]!;
  const back = layouts.find((l) => /back|in\b/i.test(l.name)) ?? layouts[1] ?? front;
  const names: string[] = [];
  const subs = new Set<string>();
  const weeks = new Map<number, PlanWeek>();

  for (const r of all.filter((x) => !x.isScramble)) {
    const layout = r.side === 'back' ? back : front;
    if (r.side === 'back' && back === front) problems.push(`Week ${r.week} was played on the back nine, but this course has one layout; scores went on ${front.name}.`);
    const players: PlanPlayer[] = r.players.map((p, idx) => {
      if (!names.includes(p.name)) names.push(p.name);
      if (p.isSub) subs.add(p.name);
      const scores: Record<number, number> = {};
      layout.holes.forEach((h, hi) => {
        const s = r.scores[hi]?.[`p${idx}`];
        if (s != null && s >= 1 && s < 99) scores[h.number] = s;
      });
      return { name: p.name, side: idx < 2 ? 'A' : idx < 4 ? 'B' : null, isSub: !!p.isSub, scores };
    });
    const ctp: Record<number, string | null> = {};
    for (const [hole, who] of Object.entries(r.ctpWinners ?? {})) {
      const n = Number(hole);
      if (!who) continue;
      ctp[n] = who === '__HIGHER_TEE__' || who === '__none__' ? null : who;
    }
    const w = weeks.get(r.week) ?? { week: r.week, date: null, layoutId: layout.id, groups: [] };
    let tee = Number(r.teeTime) || w.groups.length + 1;
    while (w.groups.some((g) => g.teeSlot === tee)) tee++;
    w.groups.push({
      teeSlot: tee, players,
      presses: (r.presses ?? []).map((p) => ({ startHole: Number(p.startHole), calledBy: p.calledBy })).filter((p) => layout.holes.some((h) => h.number === p.startHole)),
      ctp,
    });
    weeks.set(r.week, w);
  }

  // The old app gave each par 3 to the latest tee time that claimed it; keep only that claim.
  for (const w of weeks.values()) {
    w.groups.sort((a, b) => a.teeSlot - b.teeSlot);
    const holes = new Set(w.groups.flatMap((g) => Object.keys(g.ctp).map(Number)));
    for (const hole of holes) {
      const winner = [...w.groups].reverse().find((g) => g.ctp[hole]);
      for (const g of w.groups) if (g !== winner && hole in g.ctp) g.ctp[hole] = null;
    }
  }
  return { weeks: [...weeks.values()].sort((a, b) => a.week - b.week), names, subs: [...subs], problems };
}

export function planSummary(plan: ImportPlan) {
  const groups = plan.weeks.reduce((s, w) => s + w.groups.length, 0);
  const rounds = plan.weeks.reduce((s, w) => s + w.groups.reduce((t, g) => t + g.players.length, 0), 0);
  return { weeks: plan.weeks.length, groups, rounds };
}

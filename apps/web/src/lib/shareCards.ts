import type { WeeklyRecap } from '@golfscorehq/engine';
import { textOn } from './brand';
import { fmtMoney } from './scoring';

// Shareable pictures of a settled week: the whole league's results (for the
// commissioner to post on Facebook) and the low-round winner's card. Money is
// left off unless the commissioner turns it on.

export interface CardBrand {
  leagueName: string;
  color: string;
  accent: string;
  logoUrl: string | null;
}

export interface CardWeek {
  weekNumber: number;
  courseName: string | null;
}

const toParWords = (n: number) => (n === 0 ? 'Even par' : n < 0 ? `${-n} under` : `${n} over`);
const toParShort = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`);
const first = (name: string) => name.split(' ')[0] || name;
const teamFirst = (ids: string[], name: (id: string) => string) => ids.map((id) => first(name(id))).join(' & ');
/** Full names for one or two golfers; first names for a team. */
const headlineNames = (ids: string[], name: (id: string) => string) => (ids.length > 2 ? teamFirst(ids, name) : ids.map(name).join(' & '));

/**
 * The headline result: the low round in match formats; the week's winner in
 * stroke play and Stableford (points, or the net score when playing net).
 */
function headline(recap: WeeklyRecap): { label: string; ids: string[]; score: number; toPar: string } | null {
  const winners = recap.leaderboard.filter((l) => l.place === 1);
  if (winners.length) {
    const w = winners[0]!;
    const tied = winners.length > 1;
    const ids = winners.flatMap((l) => l.playerIds);
    const label = recap.format === 'scramble' ? (tied ? 'Winning teams (tied)' : 'Winning team') : tied ? 'Winners (tied)' : 'Winner';
    if (recap.format === 'stableford') return { label, ids, score: w.points ?? 0, toPar: 'points' };
    if (recap.net) return { label, ids, score: w.score - w.grossToPar + w.toPar, toPar: `Net · ${toParWords(w.toPar).toLowerCase()}` };
    return { label, ids, score: w.score, toPar: toParWords(w.toPar) };
  }
  const low = recap.lowRound;
  return low ? { label: low.playerIds.length > 1 ? 'Low round (tied)' : 'Low round', ids: low.playerIds, score: low.score, toPar: toParWords(low.toPar) } : null;
}

export interface ResultsModel {
  lowRound: { label: string; names: string; score: number; toPar: string } | null;
  /** "Matches" or "Leaderboard". */
  listLabel: string;
  matches: { text: string; score: string }[];
  moreMatches: number;
  skins: { name: string; count: number; cents: number | null }[];
  moreSkins: number;
  ctp: { hole: number; name: string; cents: number | null }[];
  birdies: number;
  eagles: number;
}

const MAX_MATCHES = 5;
const MAX_LIST = 5;

/** What goes on the league results picture. `ctpCents` is what each CTP paid, by hole, from the posted results. */
export function resultsModel(recap: WeeklyRecap, name: (id: string) => string, opts: { includeMoney: boolean; ctpCents?: Record<number, number> }): ResultsModel {
  const placeScore = (l: WeeklyRecap['leaderboard'][number]) =>
    recap.format === 'stableford' ? `${l.points} pts` : recap.net ? toParShort(l.toPar) : String(l.score);
  const matches = recap.leaderboard.length
    ? recap.leaderboard.map((l) => ({ text: `${l.tied ? 'T' : ''}${l.place}. ${l.playerIds.length > 1 ? teamFirst(l.playerIds, name) : name(l.playerIds[0]!)}`, score: placeScore(l) }))
    : recap.matches.map((m) => {
    const [w, l] = m.winner === 'B' ? [m.teamB, m.teamA] : [m.teamA, m.teamB];
    const [hw, hl] = m.winner === 'B' ? [m.holesWon.B, m.holesWon.A] : [m.holesWon.A, m.holesWon.B];
    if (!l.length) return { text: `${teamFirst(w, name)}`, score: '' };
    return m.winner === null
      ? { text: `${teamFirst(m.teamA, name)} halved ${teamFirst(m.teamB, name)}`, score: `${m.holesWon.A}–${m.holesWon.B}` }
      : { text: `${teamFirst(w, name)} def. ${teamFirst(l, name)}`, score: `${hw}–${hl}` };
  });

  // Skins by winner: one golfer, or a whole scramble team (its skin isn't split into per-player rows).
  const skinCount = new Map<string, { label: string; count: number; cents: number }>();
  const add = (key: string, label: string, cents: number) => {
    const t = skinCount.get(key) ?? { label, count: 0, cents: 0 };
    t.count++;
    t.cents += cents;
    skinCount.set(key, t);
  };
  for (const s of recap.skins) {
    if (recap.format === 'scramble') add(s.playerIds.join('|'), teamFirst(s.playerIds, name), s.value);
    else for (const p of s.playerIds) add(p, name(p), Math.round(s.value / s.playerIds.length));
  }
  const skins = [...skinCount.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((t) => ({ name: t.label, count: t.count, cents: opts.includeMoney ? t.cents : null }));

  const ctp = recap.ctp
    .filter((c) => c.winner)
    .map((c) => ({ hole: c.holeNumber, name: name(c.winner!), cents: opts.includeMoney ? opts.ctpCents?.[c.holeNumber] ?? null : null }));

  const top = headline(recap);
  return {
    lowRound: top ? { label: top.label, names: headlineNames(top.ids, name), score: top.score, toPar: top.toPar } : null,
    listLabel: recap.leaderboard.length ? 'Leaderboard' : 'Matches',
    matches: matches.slice(0, MAX_MATCHES),
    moreMatches: Math.max(0, matches.length - MAX_MATCHES),
    skins: skins.slice(0, MAX_LIST),
    moreSkins: Math.max(0, skins.length - MAX_LIST),
    ctp: ctp.slice(0, MAX_LIST),
    birdies: recap.highlights.filter((h) => h.kind === 'birdie').length,
    eagles: recap.highlights.filter((h) => h.kind !== 'birdie').length,
  };
}

export interface WinnerModel {
  label: string;
  name: string;
  score: number;
  toPar: string;
  /** Only the stats this golfer actually has. */
  stats: { value: string; label: string }[];
}

/** The low-round winner's card. Ties name everyone tied. */
export function winnerModel(recap: WeeklyRecap, name: (id: string) => string): WinnerModel | null {
  const top = headline(recap);
  if (!top) return null;
  const ids = new Set(top.ids);
  const birdies = recap.highlights.filter((h) => ids.has(h.playerId) && h.kind === 'birdie').length;
  const eagles = recap.highlights.filter((h) => ids.has(h.playerId) && h.kind !== 'birdie').length;
  const skins = recap.skins.filter((s) => s.playerIds.some((p) => ids.has(p))).length;
  const ctps = recap.ctp.filter((c) => c.winner && ids.has(c.winner)).map((c) => `#${c.holeNumber}`);
  const stats: WinnerModel['stats'] = [];
  if (eagles) stats.push({ value: String(eagles), label: eagles === 1 ? 'Eagle' : 'Eagles' });
  if (birdies) stats.push({ value: String(birdies), label: birdies === 1 ? 'Birdie' : 'Birdies' });
  if (skins) stats.push({ value: String(skins), label: skins === 1 ? 'Skin' : 'Skins' });
  if (ctps.length) stats.push({ value: ctps.join(' '), label: 'CTP' });
  return {
    label: top.label === 'Winner' ? 'Week winner' : top.label,
    name: headlineNames(top.ids, name),
    score: top.score,
    toPar: top.toPar,
    stats: stats.slice(0, 3),
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────────

export const CARD_W = 1080;
export const CARD_H = 1350; // 4:5, the tallest shape Facebook and Instagram show in full

const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

function palette(brand: CardBrand) {
  const on = textOn(brand.color);
  // The accent is for small labels; if it doesn't stand out on the main color, use a softened text color.
  const accent = contrast(brand.accent, brand.color) >= 2.6 ? brand.accent : on === '#ffffff' ? 'rgba(255,255,255,0.75)' : 'rgba(17,17,17,0.7)';
  const soft = on === '#ffffff' ? 'rgba(255,255,255,0.78)' : 'rgba(17,17,17,0.72)';
  const panel = on === '#ffffff' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)';
  const line = on === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.15)';
  return { on, accent, soft, panel, line };
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    setTimeout(() => resolve(null), 8000);
  });
}

async function fontsReady() {
  try {
    await Promise.all([document.fonts.load(`700 80px ${DISPLAY}`), document.fonts.load(`600 40px ${DISPLAY}`)]);
  } catch {
    /* fall back to the system font */
  }
}

/** Shrink the font until the text fits, then cut it with "…" if it still doesn't. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (px: number) => string, size: number, minSize: number) {
  let px = size;
  ctx.font = font(px);
  while (ctx.measureText(text).width > maxWidth && px > minSize) {
    px -= 2;
    ctx.font = font(px);
  }
  let t = text;
  while (ctx.measureText(t).width > maxWidth && t.length > 1) t = t.slice(0, -2) + '…';
  return t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawHeader(ctx: CanvasRenderingContext2D, brand: CardBrand, subtitle: string, c: ReturnType<typeof palette>) {
  const logo = brand.logoUrl ? await loadImage(brand.logoUrl) : null;
  const S = 120, X = 70, Y = 70;
  ctx.save();
  ctx.beginPath();
  ctx.arc(X + S / 2, Y + S / 2, S / 2, 0, Math.PI * 2);
  ctx.fillStyle = logo ? '#ffffff' : brand.accent;
  ctx.fill();
  if (logo) {
    ctx.clip();
    const k = Math.min((S - 14) / logo.width, (S - 14) / logo.height);
    ctx.drawImage(logo, X + (S - logo.width * k) / 2, Y + (S - logo.height * k) / 2, logo.width * k, logo.height * k);
  } else {
    ctx.fillStyle = textOn(brand.accent);
    ctx.font = `700 52px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(brand.leagueName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(), X + S / 2, Y + S / 2 + 3);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.on;
  ctx.fillText(fitText(ctx, brand.leagueName, CARD_W - 240 - 70, (px) => `600 ${px}px ${BODY}`, 50, 34), 220, 122);
  ctx.fillStyle = c.soft;
  ctx.fillText(fitText(ctx, subtitle, CARD_W - 240 - 70, (px) => `400 ${px}px ${BODY}`, 34, 26), 220, 170);
}

function drawFooter(ctx: CanvasRenderingContext2D, left: string, c: ReturnType<typeof palette>) {
  const y = CARD_H - 62;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = c.soft;
  ctx.font = `400 30px ${BODY}`;
  if (left) ctx.fillText(left, 70, y);
  // GolfScoreHQ mark: a little flag tile + name.
  const label = 'Scored with GolfScoreHQ';
  ctx.font = `600 30px ${BODY}`;
  const w = ctx.measureText(label).width;
  const x = CARD_W - 70 - w;
  ctx.fillStyle = c.on;
  ctx.fillText(label, x, y);
  const t = 40, tx = x - t - 14, ty = y - t / 2;
  roundRect(ctx, tx, ty, t, t, 9);
  ctx.fillStyle = c.on;
  ctx.fill();
  ctx.strokeStyle = c.on === '#ffffff' ? '#14365c' : '#ffffff';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tx + 15, ty + 32);
  ctx.lineTo(tx + 15, ty + 8);
  ctx.lineTo(tx + 29, ty + 14);
  ctx.lineTo(tx + 15, ty + 20);
  ctx.stroke();
}

function canvas() {
  const el = document.createElement('canvas');
  el.width = CARD_W;
  el.height = CARD_H;
  return { el, ctx: el.getContext('2d')! };
}

const toBlob = (el: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => el.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture couldn't be made."))), 'image/png'));

export async function drawResultsCard(m: ResultsModel, brand: CardBrand, week: CardWeek): Promise<Blob> {
  await fontsReady();
  const { el, ctx } = canvas();
  const c = palette(brand);
  ctx.fillStyle = brand.color;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = brand.accent;
  ctx.fillRect(0, CARD_H - 14, CARD_W, 14);

  await drawHeader(ctx, brand, `Week ${week.weekNumber} results${week.courseName ? ` · ${week.courseName}` : ''}`, c);

  // Size the results panel to what's in it, then center the low round + panel between header and footer.
  const listRows = Math.max(m.skins.length + (m.moreSkins ? 1 : 0), m.ctp.length);
  const panelH =
    (m.matches.length ? 58 + m.matches.length * 54 + (m.moreMatches ? 46 : 0) + 24 : 0) +
    (m.skins.length || m.ctp.length ? 58 + listRows * 52 : 0) + 40;
  const blockH = (m.lowRound ? 220 : 0) + panelH;
  const areaTop = 260, areaBottom = CARD_H - 120;
  let y = areaTop + 40 + Math.max(0, (areaBottom - areaTop - blockH) / 2);

  // Low round, the headline.
  if (m.lowRound) {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = c.accent;
    ctx.font = `600 32px ${BODY}`;
    ctx.fillText(m.lowRound.label, 70, y);
    ctx.fillStyle = c.on;
    ctx.fillText(fitText(ctx, m.lowRound.names, 640, (px) => `700 ${px}px ${DISPLAY}`, 92, 52), 70, y + 92);
    ctx.textAlign = 'right';
    ctx.font = `700 210px ${DISPLAY}`;
    ctx.fillText(String(m.lowRound.score), CARD_W - 70, y + 110);
    ctx.fillStyle = c.accent;
    ctx.font = `700 54px ${DISPLAY}`;
    ctx.fillText(m.lowRound.toPar, CARD_W - 70, y + 170);
    y += 220;
  }

  // Results panel.
  const px = 50, top = y - 4;
  roundRect(ctx, px, top, CARD_W - px * 2, Math.min(panelH + 24, areaBottom - top), 28);
  ctx.fillStyle = c.panel;
  ctx.fill();
  const inner = px + 40, innerW = CARD_W - inner * 2;
  y = top + 64;
  const label = (text: string, x: number) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = c.accent;
    ctx.font = `600 30px ${BODY}`;
    ctx.fillText(text, x, y);
  };
  const row = (text: string, right: string, x: number, w: number) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = c.on;
    const rightW = right ? (ctx.font = `700 44px ${DISPLAY}`, ctx.measureText(right).width + 20) : 0;
    ctx.fillText(fitText(ctx, text, w - rightW, (p) => `400 ${p}px ${BODY}`, 36, 28), x, y);
    if (right) {
      ctx.textAlign = 'right';
      ctx.font = `700 44px ${DISPLAY}`;
      ctx.fillText(right, x + w, y);
    }
  };

  if (m.matches.length) {
    label(m.listLabel, inner);
    y += 58;
    for (const mt of m.matches) { row(mt.text, mt.score, inner, innerW); y += 54; }
    if (m.moreMatches) { ctx.fillStyle = c.soft; ctx.font = `400 28px ${BODY}`; ctx.textAlign = 'left'; ctx.fillText(`+ ${m.moreMatches} more`, inner, y); y += 46; }
    y += 24;
  }

  const colW = (innerW - 50) / 2;
  const startY = y;
  if (m.skins.length) {
    y = startY;
    label('Skins', inner);
    y += 58;
    for (const s of m.skins) { row(s.name, s.cents !== null ? fmtMoney(s.cents) : String(s.count), inner, colW); y += 52; }
    if (m.moreSkins) { ctx.fillStyle = c.soft; ctx.font = `400 28px ${BODY}`; ctx.textAlign = 'left'; ctx.fillText(`+ ${m.moreSkins} more`, inner, y); y += 46; }
  }
  if (m.ctp.length) {
    const x = m.skins.length ? inner + colW + 50 : inner;
    const w = m.skins.length ? colW : innerW;
    y = startY;
    label('Closest to the pin', x);
    y += 58;
    for (const t of m.ctp) { row(`#${t.hole} ${t.name}`, t.cents !== null ? fmtMoney(t.cents) : '', x, w); y += 52; }
  }

  const extras = [m.eagles ? `${m.eagles} eagle${m.eagles === 1 ? '' : 's'}` : '', m.birdies ? `${m.birdies} birdie${m.birdies === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  drawFooter(ctx, extras ? `${extras} this week` : '', c);
  return toBlob(el);
}

export async function drawWinnerCard(m: WinnerModel, brand: CardBrand, week: CardWeek): Promise<Blob> {
  await fontsReady();
  const { el, ctx } = canvas();
  const c = palette(brand);
  ctx.fillStyle = brand.color;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = brand.accent;
  ctx.fillRect(0, CARD_H - 14, CARD_W, 14);

  await drawHeader(ctx, brand, `Week ${week.weekNumber}${week.courseName ? ` · ${week.courseName}` : ''}`, c);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.accent;
  ctx.font = `600 38px ${BODY}`;
  ctx.fillText(m.label, 70, 400);
  ctx.fillStyle = c.on;
  ctx.fillText(fitText(ctx, m.name, CARD_W - 140, (px) => `700 ${px}px ${DISPLAY}`, 120, 64), 70, 520);
  ctx.font = `700 400px ${DISPLAY}`;
  ctx.fillText(String(m.score), 56, 880);
  ctx.fillStyle = c.accent;
  ctx.font = `700 84px ${DISPLAY}`;
  ctx.fillText(m.toPar, 70, 980);

  if (m.stats.length) {
    const y = 1040, w = (CARD_W - 140) / m.stats.length;
    ctx.fillStyle = c.line;
    ctx.fillRect(70, y, CARD_W - 140, 2);
    m.stats.forEach((s, i) => {
      const cx = 70 + w * i + w / 2;
      if (i > 0) ctx.fillRect(70 + w * i, y + 30, 2, 120);
      ctx.textAlign = 'center';
      ctx.fillStyle = c.on;
      ctx.fillText(fitText(ctx, s.value, w - 30, (px) => `700 ${px}px ${DISPLAY}`, 90, 48), cx, y + 120);
      ctx.fillStyle = c.soft;
      ctx.font = `400 30px ${BODY}`;
      ctx.fillText(s.label, cx, y + 162);
      ctx.fillStyle = c.line;
    });
  }

  drawFooter(ctx, '', c);
  return toBlob(el);
}

/**
 * Phones: open the share menu with the picture attached (Facebook, Messages, the
 * group chat…). Computers: save the picture, since Facebook won't take pictures
 * from other websites. Returns what happened.
 */
export async function shareImage(blob: Blob, fileName: string, text: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  saveImage(blob, fileName);
  return 'saved';
}

export function saveImage(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

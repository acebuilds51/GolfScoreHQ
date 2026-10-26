import type { NewPlayer } from './types';

/** "Oak Creek Men's League!" → "oak-creek-mens-league" (matches the database's slug rule). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41)
    .replace(/-+$/, '');
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

/**
 * Tidy whatever was typed into the league link box. People paste their
 * course's website here, so "https://www.shepherdshollow.com/" becomes
 * "shepherdshollow".
 */
export function cleanSlugInput(raw: string): string {
  const noScheme = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  const lastPart = noScheme.split(/[/?#]/).filter(Boolean).pop() ?? '';
  const host = noScheme.split(/[/?#]/)[0] ?? '';
  // A bare domain ("shepherdshollow.com") keeps its name; a path keeps its last segment.
  const part = lastPart === host ? host.replace(/\.[a-z]{2,}$/, '') : lastPart;
  return slugify(part);
}

/** 6 characters, no look-alikes (0/O, 1/I/L). */
export function randomJoinCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-.\s\d]{7,}$/;
const EMAIL_IN_RE = /[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+/;
const PHONE_IN_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const HEADER_RE = /^(names?|first( name)?|last( name)?|full name|players?|golfers?|e-?mail( address)?|phone( number)?|cell|mobile|type|status|subs?|member)$/i;

export interface ParsedRoster {
  players: NewPlayer[];
  /** Lines that couldn't be used, with the reason, for the commissioner to fix. */
  skipped: { line: string; reason: string }[];
}

/**
 * Parse a pasted roster: one golfer per line, copied from a spreadsheet
 * (tab-separated) or typed with commas. Recognizes an email, a phone number
 * and the word "sub" in any column. "Smith, John" becomes "John Smith".
 * Names already on the roster (any capitalization) are skipped.
 */
export function parseRoster(text: string, existingNames: string[] = []): ParsedRoster {
  const onRoster = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();
  const players: NewPlayer[] = [];
  const skipped: ParsedRoster['skipped'] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = (line.includes('\t') ? line.split('\t') : line.split(',')).map((f) => f.trim()).filter(Boolean);
    if (fields.every((f) => HEADER_RE.test(f))) continue; // a spreadsheet's header row
    let email: string | undefined;
    let phone: string | undefined;
    let isSub = false;
    const nameParts: string[] = [];
    // An email or phone typed after the name with only spaces ("Jim Jones jim@x.com 248-555-1212").
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      if (EMAIL_RE.test(f) || PHONE_RE.test(f)) continue;
      let rest = f;
      const e = !email ? rest.match(EMAIL_IN_RE) : null;
      if (e) { email = e[0].toLowerCase(); rest = rest.replace(e[0], ' '); }
      const p = !phone ? rest.match(PHONE_IN_RE) : null;
      if (p) { phone = p[0].trim(); rest = rest.replace(p[0], ' '); }
      rest = rest.replace(/\s+/g, ' ').trim();
      if (rest !== f && /\s(sub|substitute)$/i.test(rest)) { isSub = true; rest = rest.replace(/\s\S+$/, ''); }
      fields[i] = rest;
    }
    for (const f of fields.filter(Boolean)) {
      if (!email && EMAIL_RE.test(f)) email = f.toLowerCase();
      else if (!phone && PHONE_RE.test(f) && f.replace(/\D/g, '').length >= 7) phone = f;
      else if (/^(sub|substitute)$/i.test(f)) isSub = true;
      else if (/^(regular|member)$/i.test(f)) isSub = false;
      else nameParts.push(f);
    }
    let name = nameParts.length === 2 && !line.includes('\t') ? `${nameParts[1]} ${nameParts[0]}` : nameParts.join(' ');
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) {
      skipped.push({ line, reason: 'No name found' });
      continue;
    }
    if (name.length > 60) {
      skipped.push({ line, reason: 'Name is longer than 60 characters' });
      continue;
    }
    const key = name.toLowerCase();
    if (onRoster.has(key) || seen.has(key)) {
      skipped.push({ line, reason: onRoster.has(key) ? `${name} is already on the roster` : `${name} is listed twice` });
      continue;
    }
    seen.add(key);
    players.push({ displayName: name, isSub, ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
  }
  return { players, skipped };
}

export interface GolferRow {
  name: string;
  email: string;
  phone: string;
  isSub: boolean;
}

/**
 * Check the "Add golfers" form. Blank rows are ignored. Returns the golfers
 * to add, or a problem per row (by index) for the commissioner to fix.
 */
export function checkGolferRows(rows: GolferRow[], existingNames: string[] = []): { players: NewPlayer[]; problems: Record<number, string> } {
  const onRoster = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();
  const players: NewPlayer[] = [];
  const problems: Record<number, string> = {};
  rows.forEach((r, i) => {
    const name = r.name.replace(/\s+/g, ' ').trim();
    const email = r.email.trim().toLowerCase();
    const phone = r.phone.trim();
    if (!name && !email && !phone) return;
    const key = name.toLowerCase();
    if (!name) problems[i] = 'Enter a name.';
    else if (name.length > 60) problems[i] = 'Name is longer than 60 characters.';
    else if (EMAIL_IN_RE.test(name) || PHONE_IN_RE.test(name)) problems[i] = 'Put the email and phone in their own boxes, not in the name.';
    else if (email && !EMAIL_RE.test(email)) problems[i] = "That email doesn't look right.";
    else if (phone && phone.replace(/\D/g, '').length < 7) problems[i] = "That phone number looks too short.";
    else if (onRoster.has(key)) problems[i] = `${name} is already on the roster.`;
    else if (seen.has(key)) problems[i] = `${name} is listed twice.`;
    if (problems[i]) return;
    seen.add(key);
    players.push({ displayName: name, isSub: r.isSub, ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
  });
  return { players, problems };
}

/** Standard pars to start a new nine from. */
export const PAR_36 = [4, 4, 3, 5, 4, 4, 3, 5, 4];

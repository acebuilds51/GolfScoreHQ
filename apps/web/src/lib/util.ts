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
    for (const f of fields) {
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

/** Standard pars to start a new nine from. */
export const PAR_36 = [4, 4, 3, 5, 4, 4, 3, 5, 4];

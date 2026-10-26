import type { CSSProperties } from 'react';
import type { League } from './types';

/** Ready-made color pairs: main color first, accent second. */
export const PALETTES: { name: string; brand: string; accent: string }[] = [
  { name: 'Fairway', brand: '#0b5d3b', accent: '#d4a017' },
  { name: 'Navy & gold', brand: '#14365c', accent: '#c9a227' },
  { name: 'Clubhouse red', brand: '#8c1d18', accent: '#1f3a5f' },
  { name: 'Black & gold', brand: '#1b1b1b', accent: '#c9a227' },
  { name: 'Lake blue', brand: '#1f5f8b', accent: '#1d9e75' },
  { name: 'Links', brand: '#3d5a40', accent: '#b5651d' },
  { name: 'Purple', brand: '#4b2e83', accent: '#e8a33d' },
  { name: 'Orange & navy', brand: '#d35400', accent: '#14365c' },
];

export const HEX_RE = /^#[0-9a-f]{6}$/;

/** Read a typed color code: "#0B5D3B", "0b5d3b" or short "#0b5" → "#0b5d3b"; null if it isn't one. */
export function parseHex(s: string): string | null {
  const m = s.trim().toLowerCase().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return `#${h}`;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** White or near-black, whichever reads better on this color. */
export function textOn(hex: string): '#ffffff' | '#111111' {
  const l = luminance(hex);
  // Contrast ratio against white vs against #111111 (luminance ≈ 0.0056).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0556 ? '#ffffff' : '#111111';
}

/** The league's colors as CSS variables, when it has branding and has picked some. */
export function brandStyle(l: Pick<League, 'brandColor' | 'accentColor' | 'features'>): CSSProperties | undefined {
  if (!l.features.includes('branding') || (!l.brandColor && !l.accentColor)) return undefined;
  const vars: Record<string, string> = {};
  if (l.brandColor) Object.assign(vars, { '--league': l.brandColor, '--on-league': textOn(l.brandColor) });
  if (l.accentColor) Object.assign(vars, { '--league-accent': l.accentColor, '--on-league-accent': textOn(l.accentColor) });
  return vars as CSSProperties;
}

/** The league's logo, if it has branding. */
export const brandLogo = (l: Pick<League, 'logoUrl' | 'features'>) => (l.features.includes('branding') ? l.logoUrl : null);

/** The league's course photo banner, if it has branding. */
export const brandBanner = (l: Pick<League, 'bannerUrl' | 'features'>) => (l.features.includes('branding') ? l.bannerUrl : null);

export const MAX_LOGO_PX = 512;
export const MAX_BANNER_PX = 1600;

/** A logo: PNG (keeps a clear background), at most 512px on its longest side. */
export const resizeLogo = (file: File) => resizeImage(file, MAX_LOGO_PX, 'image/png');
/** A course photo: JPEG, at most 1600px wide, small enough for phones on the course. */
export const resizeBanner = (file: File) => resizeImage(file, MAX_BANNER_PX, 'image/jpeg', 0.82);

/**
 * Shrink a picked image so its longest side is at most `maxPx`.
 * Drops camera metadata (including location) and keeps uploads small.
 */
async function resizeImage(file: File, maxPx: number, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Pick a PNG, JPG or WebP picture.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That picture is too large. Pick one under 15 MB.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That picture couldn't be opened. Try a PNG or JPG.");
  });
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("That picture couldn't be read."))), type, quality));
}

// Draws the GolfScoreHQ app icon (the flag from favicon.svg on navy) as PNGs
// for home-screen install. No image libraries: a tiny rasterizer + PNG encoder.
//   node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x14, 0x36, 0x5c];
const FLAG = [0x7f, 0xd1, 0xa8];
const BALL = [0xff, 0xff, 0xff];

// favicon.svg geometry (64-unit box), shrunk to 70% and centered so Android's
// round/squircle masks never clip it.
const S = 0.7, O = 9.6;
const pt = ([x, y]) => [O + x * S, O + y * S];
const flag = [[24, 50], [24, 14], [44, 22], [24, 30]].map(pt);
const strokeR = (5 / 2) * S;
const [bx, by] = pt([24, 52]);
const ballR = 4 * S;

function distToSegment(px, py, [ax, ay], [bx2, by2]) {
  const dx = bx2 - ax, dy = by2 - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function colorAt(x, y) {
  if (Math.hypot(x - bx, y - by) <= ballR) return BALL;
  for (let i = 0; i < flag.length - 1; i++) if (distToSegment(x, y, flag[i], flag[i + 1]) <= strokeR) return FLAG;
  return BG;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const SS = 4; // 4×4 samples per pixel for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt(((px + (sx + 0.5) / SS) / size) * 64, ((py + (sy + 0.5) / SS) / size) * 64);
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(sum[k] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../apps/web/public/', import.meta.url);
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(new URL(name, out), png(size));
  console.log(`wrote ${name} (${size}px)`);
}

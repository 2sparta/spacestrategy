#!/usr/bin/env node
/**
 * Генератор спрайтів дрібних тіл (астероїдів, «картопляних» супутників).
 *
 *   node tools/gen-sprites.mjs
 *
 * Малює процедурно (без зовнішніх залежностей) набір PNG із прозорістю у
 * public/images/bodies/. Кожен спрайт — неправильної форми тіло з рельєфом,
 * кратерами й бічним освітленням (світло згори-зліва, як у решті гри).
 * Родини: rock (камʼяні), metal (металеві, типу Психеї), ice (крижані).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'bodies');
const SIZE = 192;

/* ---------- PNG ---------- */
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                       // фільтр None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 біт, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- шум ---------- */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smoothstep = (t) => t * t * (3 - 2 * t);

/* ---------- тіло ---------- */
function makeSprite(seed, o) {
  const rnd = mulberry32(seed);
  const amp = o.amp;
  // радіус з запасом, щоб жоден виступ силуету не різався краєм полотна
  const R = (SIZE / 2 - 3) / (1 + amp * 1.1);
  const cx = SIZE / 2, cy = SIZE / 2;
  // силует: сума синусоїд → гладка «картоплина» без самоперетинів
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const w = [0.62 + rnd() * 0.3, 0.3 + rnd() * 0.2, 0.12 + rnd() * 0.14];
  const profile = (ang) => 1 + amp * (w[0] * Math.sin(ang + ph[0]) + w[1] * Math.sin(2 * ang + ph[1]) + w[2] * Math.sin(3 * ang + ph[2]));
  // кратери
  const craters = [];
  for (let i = 0; i < o.craters; i++) {
    const a = rnd() * 6.283, d = Math.sqrt(rnd()) * 0.72;
    craters.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: (0.05 + rnd() * 0.2) * (o.craterScale ?? 1), depth: 0.1 + rnd() * 0.22 });
  }
  // плями реголіту
  const spots = [];
  for (let i = 0; i < 26; i++) spots.push({ x: (rnd() * 2 - 1) * 0.85, y: (rnd() * 2 - 1) * 0.85, r: 0.02 + rnd() * 0.06, k: (rnd() - 0.5) * 0.16 });

  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const L = [-0.5, -0.62, 0.6];                     // світло згори-зліва
  const ln = Math.hypot(...L);
  const [lx, ly, lz] = L.map(v => v / ln);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x - cx) / R, v = (y - cy) / R;
      const rr = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const P = profile(ang);
      const edge = (P - rr) * R / 1.4;               // 1.4 px згладжування краю
      if (edge <= 0) continue;
      const alpha = Math.min(1, smoothstep(Math.max(0, Math.min(1, edge))));
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, (rr / P) ** 2)));
      const diff = Math.max(0, u * lx + v * ly + z * lz);
      let k = 0.34 + 0.8 * diff;                      // освітлення півкулі
      k *= 0.55 + 0.45 * z;                           // затемнення до краю
      for (const s of spots) {
        const sd = Math.hypot(u - s.x, v - s.y);
        if (sd < s.r) k *= 1 + s.k * (1 - sd / s.r);
      }
      for (const cr of craters) {
        const dx = u - cr.x, dy = v - cr.y;
        const cd = Math.hypot(dx, dy);
        if (cd < cr.r) k *= 1 - cr.depth * (1 - (cd / cr.r) ** 2);
        else if (cd < cr.r * 1.22) {
          // освітлений вал кратера з боку світла
          const nx = dx / cd, ny = dy / cd;
          const lit = Math.max(0, -(nx * lx + ny * ly));
          k *= 1 + 0.3 * lit * (1 - (cd - cr.r) / (cr.r * 0.22));
        }
      }
      const spec = o.spec ? Math.pow(Math.max(0, diff), 18) * o.spec : 0;
      const i = (y * SIZE + x) * 4;
      rgba[i] = Math.min(255, o.col[0] * k + spec * 255);
      rgba[i + 1] = Math.min(255, o.col[1] * k + spec * 255);
      rgba[i + 2] = Math.min(255, o.col[2] * k + spec * 255);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

/* ---------- набір ---------- */
const FAMILIES = {
  rock: { col: [156, 146, 128], amp: 0.24, craters: 9, spec: 0.05, craterScale: 1 },
  dark: { col: [116, 108, 100], amp: 0.28, craters: 12, spec: 0.03, craterScale: 1.15 },
  metal: { col: [128, 126, 124], amp: 0.19, craters: 7, spec: 0.45, craterScale: 0.9 },
  ice: { col: [196, 214, 230], amp: 0.21, craters: 6, spec: 0.18, craterScale: 1.05 },
  rusty: { col: [162, 122, 96], amp: 0.26, craters: 10, spec: 0.04, craterScale: 1 },
};
mkdirSync(OUT, { recursive: true });
const manifest = {};
let n = 0;
for (const [fam, o] of Object.entries(FAMILIES)) {
  manifest[fam] = [];
  for (let i = 0; i < 5; i++) {
    const seed = 1000 + n * 7919;
    const rgba = makeSprite(seed, o);
    const file = `${fam}-${String(i + 1).padStart(2, '0')}.png`;
    writeFileSync(join(OUT, file), encodePNG(SIZE, SIZE, rgba));
    manifest[fam].push(file);
    n++;
  }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`згенеровано ${n} спрайтів у ${OUT}`);

// контрольний аркуш для очей
const COLS = 5, ROWS = Object.keys(FAMILIES).length;
const sheet = Buffer.alloc(SIZE * COLS * SIZE * ROWS * 4, 0);
let idx = 0;
for (const fam of Object.keys(FAMILIES)) {
  for (let i = 0; i < 5; i++) {
    const rgba = makeSprite(1000 + idx * 7919, FAMILIES[fam]);
    const gx = (i % COLS) * SIZE, gy = idx * 0; // рядки вже враховані порядком
    const row = Math.floor(idx / COLS);
    for (let y = 0; y < SIZE; y++) {
      const srcStart = y * SIZE * 4;
      const dstStart = ((row * SIZE + y) * SIZE * COLS + gx) * 4;
      rgba.copy(sheet, dstStart, srcStart, srcStart + SIZE * 4);
    }
    idx++;
  }
}
writeFileSync(join(OUT, '..', 'bodies-sheet.png'), encodePNG(SIZE * COLS, SIZE * ROWS, sheet));
console.log('контрольний аркуш: public/images/bodies-sheet.png');

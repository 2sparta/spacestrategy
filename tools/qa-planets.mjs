#!/usr/bin/env node
/**
 * Контрольний аркуш планет: бере згенеровані панорами з public/images/planets/
 * і малює їх ТАК САМО, як це робить рендерер гри — диск із термінатором і
 * затемненням лімба (світло згори-зліва) та кільцями в Сатурна й Урана.
 *
 *   node tools/qa-planets.mjs
 *
 * Результат: public/images/planets-preview.png
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'planets');

/* ---------- PNG ---------- */
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; }
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
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(buf) {
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0, b = y > 0 ? out[(y - 1) * stride + x] : 0, c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, data: out };
}

/* ---------- освітлення ---------- */
const mixStop = (stops, t) => {
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    if (t <= t1) { const k = (t - t0) / Math.max(1e-6, t1 - t0); return c0.map((v, j) => v + (c1[j] - v) * k); }
  }
  return stops[stops.length - 1][1];
};
const LIGHT_STOPS = [[0, [255, 255, 255]], [0.44, [201, 207, 223]], [0.78, [58, 66, 86]], [1, [10, 14, 26]]];
const RIM_STOPS = [[0, [255, 255, 255]], [1, [118, 124, 140]]];
const RINGS = { 'sol-saturn': [1.19, 2.32, [226, 208, 176]], 'sol-uranus': [1.55, 2.02, [168, 214, 226]], 'sol-jupiter': [1.42, 1.78, [186, 168, 150]] };

const R = 88, CELL = 208, COLS = 8;
const files = readdirSync(DIR).filter(f => f.endsWith('.png')).sort((a, b) => a.localeCompare(b, 'uk'));
const rows = Math.ceil(files.length / COLS);
const W = CELL * COLS, H = CELL * rows;
const sheet = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { sheet[i * 4] = 5; sheet[i * 4 + 1] = 8; sheet[i * 4 + 2] = 16; sheet[i * 4 + 3] = 255; }

files.forEach((file, i) => {
  const tex = decodePNG(readFileSync(join(DIR, file)));
  const key = file.replace('.png', '');
  const ring = RINGS[key] || null;
  const cx = (i % COLS) * CELL + CELL / 2, cy = Math.floor(i / COLS) * CELL + CELL / 2;
  for (let y = -CELL / 2; y < CELL / 2; y++) for (let x = -CELL / 2; x < CELL / 2; x++) {
    const px = cx + x, py = cy + y;
    const r = Math.hypot(x, y) / R;
    const dRing = ring ? Math.hypot(x / R, y / (R * 0.32)) : 99;
    const inRing = ring && dRing >= ring[0] && dRing <= ring[1] && Math.abs(dRing / ring[1] - 0.42) > 0.03;
    const inDisc = r <= 1.01;
    if (!inDisc && !inRing) continue;
    // кільце: дальня половина ховається за диском, ближня проходить перед ним
    if (inRing && !(inDisc && r <= 1 && y < 0)) {
      const o = (py * W + px) * 4;
      // кільце тоншає до країв і зникає на «вухах» — як справжнє
      const band = (dRing - ring[0]) / (ring[1] - ring[0]);
      const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, band))) ** 0.6;
      const ends = Math.max(0, 1 - Math.pow(Math.abs(x) / (R * ring[1]), 3));
      const k = 0.42 * taper * ends * (inDisc ? 0.7 : 1);
      const col = ring[2];
      sheet[o] = sheet[o] * (1 - k) + col[0] * k;
      sheet[o + 1] = sheet[o + 1] * (1 - k) + col[1] * k;
      sheet[o + 2] = sheet[o + 2] * (1 - k) + col[2] * k;
      if (inDisc && y > 0) continue; else continue;
    }
    if (!inDisc) continue;
    // текстура (панорама 2:1)
    const tx = clampInt(Math.floor(((x / R + 1) / 2) * tex.w), tex.w);
    const ty = clampInt(Math.floor(((y / R + 1) / 2) * tex.h), tex.h);
    const s = (ty * tex.w + tx) * 4;
    // світло: діагональний термінатор + затемнення лімба (як у рендерері)
    const lt = Math.min(1, Math.max(0, (x / R * 0.62 + y / R * 0.62 + 1) / 2));
    const light = mixStop(LIGHT_STOPS, lt);
    const rim = mixStop(RIM_STOPS, Math.min(1, Math.max(0, (r - 0.55) / 0.45)));
    const edge = r > 0.985 ? Math.max(0, (1.01 - r) / 0.025) : 1;
    const o = (py * W + px) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const v = tex.data[s + ch] * (light[ch] / 255) * (rim[ch] / 255);
      sheet[o + ch] = Math.round(sheet[o + ch] * (1 - edge) + v * edge);
    }
    // атмосферний ореол для «живих» світів
    if (r > 0.9 && r <= 1.01) {
      const k = Math.max(0, (r - 0.9) / 0.11) * 0.18;
      sheet[o] = Math.min(255, sheet[o] * (1 - k) + 168 * k);
      sheet[o + 1] = Math.min(255, sheet[o + 1] * (1 - k) + 208 * k);
      sheet[o + 2] = Math.min(255, sheet[o + 2] * (1 - k) + 255 * k);
    }
  }
});
function clampInt(v, max) { return Math.max(0, Math.min(max - 1, v)); }

const out = join(DIR, '..', 'planets-preview.png');
writeFileSync(out, encodePNG(W, H, sheet));
console.log(`✅ ${files.length} дисків → public/images/planets-preview.png (${W}×${H})`);
console.log('   порядок (зліва вгору, по 8 у рядку):');
for (let i = 0; i < files.length; i += COLS) console.log('   ' + files.slice(i, i + COLS).map(f => f.replace('.png', '')).join(', '));

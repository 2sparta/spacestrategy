#!/usr/bin/env node
/**
 * Генератор ТЕКСТУР ПЛАНЕТ (панорам 2:1 у рівнокутній проєкції) — без зовнішніх
 * залежностей.
 *
 *   node tools/gen-planets.mjs [--size=512x256] [--only=sol,sol-earth]
 *
 * Рендерер малює таку панораму всередину диска планети й «прокручує» її з
 * добою тіла (тому текстура мусить безшовно зшиватися по довготі), а освітлення
 * (термінатор і затемнення лімба) накладає вже на екрані множенням — світло
 * завжди згори-зліва, як у решті гри.
 *
 * Сонячна система — 8 планет, 5 карликових і 6 великих супутників: у кожного
 * свій, упізнаваний вигляд (Земля з континентами, Юпітер зі смугами й Великою
 * Червоною Плямою, Марс із каньйонами, Іо з жовтою сіркою тощо).
 * Решта систем — по 3 варіанти на кожен тип планети (A, AB, AC, AF, B, C, D,
 * CD, E, F, G, I, R).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'planets');
const args = process.argv.slice(2);
const argOf = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const [TW, TH] = argOf('size', '448x224').split('x').map(Number);
const ONLY = argOf('only', '').split(',').filter(Boolean).map(s => s.trim());

/* ================= PNG ================= */
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
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ================= шум ================= */
const rngOf = (seed) => {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const hash3 = (x, y, z, s) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
/** Трилінійний value-noise на кубі [0,1] — для рельєфу на сфері */
function noise3(x, y, z, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(x0 + i, y0 + j, z0 + k, s);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
const fbm = (x, y, z, s, oct = 5, gain = 0.5, lac = 2) => {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 131); norm += a; a *= gain; f *= lac; }
  return sum / norm;
};
/** Хребтовий шум — тріщини, гірські хребти, смуги */
const ridge = (x, y, z, s, oct = 4) => 1 - Math.abs(fbm(x, y, z, s, oct) * 2 - 1);

/* ================= палітра ================= */
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/* ================= генерація однієї панорами ================= */
/**
 * @param spec {seed, kind, palette: {base, alt, dark, light}, params}
 * kind: earth | dry | ocean | desert | volcanic | ice | gas | icegiant | dwarf | extreme | rogue | rock | moon-io | moon-europa | moon-titan | moon-moon | moon-ganymede | moon-triton
 */
function makePanorama(spec, W, H) {
  const buf = Buffer.alloc(W * H * 4, 255);
  const rnd = rngOf(spec.seed);
  const P = spec.pal || {};
  const par = spec.params || {};
  const seaLevel = par.sea ?? 0.5;
  const icy = par.icy ?? 0;
  const craterDensity = par.craters ?? 0;
  const roughness = par.rough ?? 1;
  const seedN = spec.seed % 100000;

  // ---- базова поверхня (піксель за пікселем, шум на сфері) ----
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;               // +π/2 — північ
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2;
      const px = cl * Math.cos(lon), py = sl, pz = cl * Math.sin(lon);
      const u = Math.max(6e-3, par.scale ?? 2.2);              // масштаб рельєфу
      const h = fbm(px * u + 5, py * u, pz * u, seedN, par.oct ?? 5, 0.52, 2.05);
      let col;
      switch (spec.kind) {
        case 'earth': {
          if (h < seaLevel) {                                  // океан: глибшає з глибиною
            const d = (seaLevel - h) / seaLevel;
            col = mix(P.shallow || [42, 96, 150], P.deep || [8, 26, 66], Math.min(1, d * 1.5));
          } else {
            const t = (h - seaLevel) / (1 - seaLevel);
            col = t < 0.42 ? mix(P.beach || [150, 140, 96], P.low || [58, 104, 52], t / 0.42)
              : t < 0.78 ? mix(P.low || [58, 104, 52], P.high || [104, 96, 62], (t - 0.42) / 0.36)
                : mix(P.high || [104, 96, 62], P.peak || [176, 176, 176], (t - 0.78) / 0.22);
          }
          const cap = Math.max(0, (Math.abs(lat) - par.cap ?? 1.22) - 1.22);
          if (cap > 0) col = mix(col, [244, 248, 255], Math.min(1, cap * 3.2));
          break;
        }
        case 'ocean': {
          col = h < 0.62 ? mix(P.deep || [6, 30, 72], P.shallow || [34, 104, 158], h / 0.62)
            : mix(P.shallow || [34, 104, 158], P.land || [96, 128, 76], Math.min(1, (h - 0.62) * 6));
          const cap = Math.max(0, Math.abs(lat) - 1.28);
          if (cap > 0) col = mix(col, [240, 246, 255], Math.min(1, cap * 4));
          break;
        }
        case 'dry': {
          const t = h;
          col = t < 0.45 ? mix(P.dark || [86, 66, 48], P.base || [132, 106, 78], t / 0.45)
            : mix(P.base || [132, 106, 78], P.light || [186, 160, 124], (t - 0.45) / 0.55);
          const rip = ridge(px * 3.4 + 2, py * 3.4, pz * 3.4, seedN + 7, 3);
          if (rip > 0.82) col = shade(col, 0.82);              // тріщини/каньйони
          break;
        }
        case 'desert': {
          const dune = Math.sin(lat * 26 + fbm(px * 3, py * 3, pz * 3, seedN + 3, 3) * 9) * 0.5 + 0.5;
          col = mix(P.dark || [138, 92, 52], P.base || [204, 158, 96], h * 0.6 + dune * 0.4);
          col = mix(col, P.light || [232, 200, 148], Math.max(0, h - 0.72) * 2.2);
          break;
        }
        case 'volcanic': {
          const lava = par.lava ?? 0.72;
          const r1 = ridge(px * 2.6 + 3, py * 2.6, pz * 2.6, seedN + 11, 4);
          const r2 = ridge(px * 5.2 + 9, py * 5.2, pz * 5.2, seedN + 23, 3);
          const heat = Math.max(0, r1 - lava) / (1 - lava) + Math.max(0, r2 - 0.86) * 0.8;
          col = mix(P.dark || [38, 32, 32], P.base || [74, 60, 56], h * 0.8);
          if (heat > 0) col = mix(col, heat > 0.35 ? P.hot || [255, 196, 72] : P.lava || [226, 92, 26], Math.min(1, heat * 1.6));
          break;
        }
        case 'ice': {
          const cr = ridge(px * (par.crackScale ?? 3.2) + 4, py * 3.2, pz * 3.2, seedN + 5, 4);
          const cr2 = ridge(px * 7 + 1, py * 7, pz * 7, seedN + 17, 3);
          col = mix(P.base || [206, 224, 238], P.deep || [120, 168, 206], h * 0.55);
          if (cr > 0.86) col = mix(col, P.crack || [96, 132, 170], 0.55);
          if (cr2 > 0.93) col = mix(col, [245, 250, 255], 0.5);
          break;
        }
        case 'gas':
        case 'icegiant': {
          // смуги за широтою з турбулентним викривленням
          const warp = fbm(px * 1.7 + 11, py * 1.7, pz * 1.7, seedN + 13, 4) - 0.5;
          const turb = par.turb ?? 0.16;
          const bands = par.bands ?? 9;
          const latW = py + warp * turb * 2.2 + (fbm(px * 4, py * 4, pz * 4, seedN + 31, 3) - 0.5) * turb;
          const s = Math.sin(latW * bands) * 0.5 + 0.5;
          const s2 = Math.sin(latW * bands * 0.37 + 1.2) * 0.5 + 0.5;
          col = mix(P.band1 || [96, 74, 58], P.band2 || [212, 190, 160], s);
          col = mix(col, P.band3 || [242, 232, 212], Math.max(0, s2 - 0.72) * 2.4);
          const storm = ridge(px * 2.4 + 21, py * 2.4, pz * 2.4, seedN + 41, 3);
          if (storm > 0.88) col = mix(col, P.storm || [200, 120, 82], 0.5);
          break;
        }
        default: { // rock / dwarf / extreme / rogue
          col = mix(P.dark || [64, 58, 54], P.base || [124, 116, 106], h);
          col = mix(col, P.light || [186, 178, 168], Math.max(0, h - 0.78) * 3);
          if ((par.frost ?? 0) > 0) {
            const cap = Math.max(0, Math.abs(lat) - 1.15);
            if (cap > 0) col = mix(col, P.frostCol || [232, 240, 248], Math.min(1, cap * 3.5 * par.frost));
          }
          break;
        }
      }
      const o = (y * W + x) * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
    }
  }

  // ---- зшивання по довготі: 6 пікселів праворуч беремо з лівого краю ----
  for (let y = 0; y < H; y++) for (let k = 0; k < 8; k++) {
    const s = (y * W) * 4, d = (y * W + (W - 8 + k)) * 4;
    buf[d] = buf[d] * (1 - (k + 1) / 8) + buf[s + k * 4] * ((k + 1) / 8);
    buf[d + 1] = buf[d + 1] * (1 - (k + 1) / 8) + buf[s + k * 4 + 1] * ((k + 1) / 8);
    buf[d + 2] = buf[d + 2] * (1 - (k + 1) / 8) + buf[s + k * 4 + 2] * ((k + 1) / 8);
  }

  // ---- кратери (малюються штампами; x загортається) ----
  if (craterDensity > 0) {
    const n = Math.round(craterDensity * 260);
    for (let i = 0; i < n; i++) {
      const r = 2 + Math.pow(rnd(), 2.6) * (Math.min(W, H) * 0.075);
      const cx = rnd() * W, cy = 2 + rnd() * (H - 4);
      stampCrater(buf, W, H, cx, cy, r, rnd);
    }
  }
  // ---- тріщини (для крижаних/вулканічних) ----
  if (par.crackLines) {
    for (let i = 0; i < par.crackLines; i++) {
      let x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI * 2;
      const len = 120 + rnd() * 420, col = par.crackLineCol || [70, 96, 132];
      for (let s = 0; s < len; s++) {
        a += (rnd() - 0.5) * 0.16;              // майже прямі «розломи»
        x += Math.cos(a) * 3.4; y += Math.sin(a) * 3.4 * 0.55;
        if (y < 1 || y > H - 1) break;
        stampDot(buf, W, H, x, y, 0.9 + rnd() * 0.9, col, 0.5);
      }
    }
  }
  // ---- іменовані вихори (Велика Червона Пляма Юпітера тощо) ----
  for (const sp of spec.spots || []) {
    stampSpot(buf, W, H, sp.lon * W, (1 - (sp.lat + 1) / 2) * H, sp.rx * W, sp.ry * H, sp.col, sp.rnd ?? rnd);
  }
  // ---- атмосферні вихори/хмари ----
  if (par.clouds) {
    for (let i = 0; i < par.clouds; i++) {
      const cx = rnd() * W, cy = H * (0.12 + rnd() * 0.76);
      const rr = (0.02 + rnd() * 0.06) * W;
      stampBlob(buf, W, H, cx, cy, rr, par.cloudCol || [250, 252, 255], 0.35 + rnd() * 0.35, rnd);
    }
  }
  // ---- полярні шапки поверх усього (щоб кратери не «пробивали» лід) ----
  if ((par.frost ?? 0) > 0) {
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - (y + 0.5) / H) * Math.PI;
      const cap = Math.max(0, Math.abs(lat) - 1.15);
      if (cap <= 0) continue;
      const k = Math.min(1, cap * 3.5 * (par.frost));
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const fc = par.frostCol || [236, 243, 250];
        const noiseK = 0.75 + 0.25 * fbm(Math.cos(x / W * 6.283) * 3, Math.sin(y / H * 3.14) * 3, 1, seedN + 77, 3);
        for (let ch = 0; ch < 3; ch++) buf[o + ch] = buf[o + ch] * (1 - k * noiseK) + fc[ch] * k * noiseK;
      }
    }
  }
  return buf;
}

/** Кратер з освітленням: світло згори-зліва, тож ближній (верхній-лівий)
 *  внутрішній схил у тіні, дальній — освітлений, вал трохи піднятий. */
function stampCrater(buf, W, H, cx, cy, r, rnd) {
  const sh = 0.16 + rnd() * 0.1;              // глибина
  for (let dy = -Math.ceil(r * 1.22); dy <= Math.ceil(r * 1.22); dy++) {
    const y = Math.round(cy + dy);
    if (y < 0 || y >= H) continue;
    for (let dx = -Math.ceil(r * 1.22); dx <= Math.ceil(r * 1.22); dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy) / r;
      if (dist > 1.22) continue;
      let x = Math.round(cx + dx); x = ((x % W) + W) % W;
      // u > 0 — далі від світла (правий-нижній бік)
      const u = (dx * 0.72 + dy * 0.72) / (r || 1);
      let k = 1;
      if (dist < 0.86) k = 1 - sh * (0.85 - u * 0.7);            // дно + напрямна тінь
      else if (dist < 1.0) k = 1 + sh * (dist - 0.86) * 1.6 + u * sh * 1.5;  // внутрішній схил
      else k = 1 + (1.22 - dist) * 0.14 * (1 - u * 0.7);         // викинута порода по валу
      const o = (y * W + x) * 4;
      buf[o] = Math.max(0, Math.min(255, buf[o] * k));
      buf[o + 1] = Math.max(0, Math.min(255, buf[o + 1] * k));
      buf[o + 2] = Math.max(0, Math.min(255, buf[o + 2] * k));
    }
  }
}
function stampDot(buf, W, H, cx, cy, r, col, a) {
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    const y = Math.round(cy + dy); if (y < 0 || y >= H) continue;
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const d = Math.sqrt(dx * dx + dy * dy); if (d > r) continue;
      let x = Math.round(cx + dx); x = ((x % W) + W) % W;
      const k = a * (1 - d / r);
      const o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) buf[o + ch] = buf[o + ch] * (1 - k) + col[ch] * k;
    }
  }
}
/** Овал-вихор: темніший обід, світлий центр, трохи «закручений» */
function stampSpot(buf, W, H, cx, cy, rx, ry, col, rnd) {
  const jitter = [];
  for (let i = 0; i < 12; i++) jitter.push(0.86 + rnd() * 0.28);
  for (let dy = -Math.ceil(ry * 1.2); dy <= Math.ceil(ry * 1.2); dy++) {
    const y = Math.round(cy + dy); if (y < 0 || y >= H) continue;
    for (let dx = -Math.ceil(rx * 1.2); dx <= Math.ceil(rx * 1.2); dx++) {
      const ang = Math.atan2(dy / (ry || 1), dx / (rx || 1));
      const j = jitter[((ang + Math.PI) / (Math.PI * 2) * 12 | 0) % 12];
      const d = Math.sqrt((dx / (rx * j)) ** 2 + (dy / (ry * j)) ** 2);
      if (d > 1) continue;
      let x = Math.round(cx + dx); x = ((x % W) + W) % W;
      const k = (d > 0.62 ? (1 - d) / 0.38 * 0.55 : 0.55 + (0.62 - d) * 0.6) * (0.75 + 0.5 * (dx > 0 ? 1 : 0.4));
      const o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) buf[o + ch] = buf[o + ch] * (1 - k) + col[ch] * k;
    }
  }
}
function stampBlob(buf, W, H, cx, cy, rr, col, a, rnd) {
  const blobs = 5 + Math.floor(rnd() * 6);
  for (let i = 0; i < blobs; i++) {
    const ox = (rnd() - 0.5) * rr * 2.2, oy = (rnd() - 0.5) * rr * 0.9;
    const r = rr * (0.35 + rnd() * 0.6);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      const y = Math.round(cy + oy + dy); if (y < 0 || y >= H) continue;
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.sqrt(dx * dx + dy * dy); if (d > r) continue;
        let x = Math.round(cx + ox + dx); x = ((x % W) + W) % W;
        const k = a * (1 - d / r) * 0.55;
        const o = (y * W + x) * 4;
        for (let ch = 0; ch < 3; ch++) buf[o + ch] = buf[o + ch] * (1 - k) + col[ch] * k;
      }
    }
  }
}

/* ================= РЕЄСТР АСЕТІВ ================= */
// 3 варіанти на кожен тип планети — різні палітри й рельєф
const TYPES = [];
const typeSet = (fam, specs) => specs.forEach((s, i) => TYPES.push({ name: `${fam}-0${i + 1}`, ...s }));

typeSet('A', [   // земний (океани, континенти, ліс, шапки)
  { kind: 'earth', seed: 1101, pal: { shallow: [46, 104, 156], deep: [7, 24, 62], beach: [176, 162, 116], low: [54, 100, 50], high: [110, 98, 62], peak: [186, 186, 186] }, params: { scale: 2.1, sea: 0.5, clouds: 26, cap: 1.2 } },
  { kind: 'earth', seed: 1102, pal: { shallow: [58, 120, 152], deep: [10, 30, 60], beach: [196, 178, 138], low: [76, 112, 58], high: [126, 108, 70], peak: [210, 206, 198] }, params: { scale: 1.7, sea: 0.44, clouds: 18, cap: 1.3 } },
  { kind: 'earth', seed: 1103, pal: { shallow: [40, 96, 148], deep: [6, 20, 56], beach: [150, 146, 122], low: [46, 92, 64], high: [92, 104, 84], peak: [206, 214, 214] }, params: { scale: 2.6, sea: 0.55, clouds: 32, cap: 1.15 } },
]);
typeSet('AB', [  // сухий земний: материки є, води майже немає
  { kind: 'dry', seed: 1201, pal: { dark: [78, 68, 56], base: [136, 122, 100], light: [186, 170, 142] }, params: { scale: 2.3, craters: 0.35, rough: 1.1, frost: 0.5 } },
  { kind: 'dry', seed: 1202, pal: { dark: [86, 62, 48], base: [150, 116, 88], light: [200, 168, 130] }, params: { scale: 1.9, craters: 0.22, rough: 1, crackLines: 40 } },
  { kind: 'earth', seed: 1203, pal: { shallow: [110, 130, 140], deep: [64, 78, 92], beach: [178, 160, 120], low: [122, 108, 74], high: [150, 130, 96], peak: [212, 206, 196] }, params: { scale: 2.2, sea: 0.72, clouds: 8, cap: 1.25 } },
]);
typeSet('AC', [  // океанічний світ
  { kind: 'ocean', seed: 1301, pal: { deep: [4, 26, 64], shallow: [30, 108, 162], land: [92, 132, 84] }, params: { scale: 2.4, clouds: 22 } },
  { kind: 'ocean', seed: 1302, pal: { deep: [8, 40, 78], shallow: [46, 148, 176], land: [128, 152, 108] }, params: { scale: 1.8, clouds: 14 } },
  { kind: 'ocean', seed: 1303, pal: { deep: [10, 34, 70], shallow: [56, 124, 168], land: [70, 96, 76] }, params: { scale: 3.1, clouds: 30 } },
]);
typeSet('AF', [  // вулканічний земний
  { kind: 'volcanic', seed: 1401, pal: { dark: [34, 26, 26], base: [72, 52, 46], lava: [232, 96, 28], hot: [255, 206, 96] }, params: { scale: 2.6, lava: 0.7, crackLines: 30, crackLineCol: [246, 140, 48], frost: 0.2 } },
  { kind: 'volcanic', seed: 1402, pal: { dark: [26, 22, 30], base: [64, 52, 60], lava: [214, 70, 40], hot: [255, 170, 70] }, params: { scale: 2.1, lava: 0.76, crackLines: 22, crackLineCol: [236, 120, 46] } },
  { kind: 'volcanic', seed: 1403, pal: { dark: [40, 30, 22], base: [86, 64, 44], lava: [255, 168, 44], hot: [255, 232, 150] }, params: { scale: 3, lava: 0.66, crackLines: 40, crackLineCol: [255, 190, 80] } },
]);
typeSet('B', [   // пустельний
  { kind: 'desert', seed: 1501, pal: { dark: [128, 84, 46], base: [206, 158, 96], light: [238, 208, 156] }, params: { scale: 2.2, craters: 0.3 } },
  { kind: 'desert', seed: 1502, pal: { dark: [150, 96, 60], base: [222, 168, 104], light: [248, 226, 180] }, params: { scale: 1.6, craters: 0.14, crackLines: 34 } },
  { kind: 'desert', seed: 1503, pal: { dark: [110, 78, 54], base: [176, 132, 86], light: [222, 190, 138] }, params: { scale: 2.8, craters: 0.45, frost: 0.35 } },
]);
typeSet('C', [   // крижаний / кріогенний
  { kind: 'ice', seed: 1601, pal: { base: [212, 230, 244], deep: [118, 166, 206], crack: [92, 130, 172] }, params: { scale: 2.6, crackScale: 3.4, crackLines: 34, craters: 0.18 } },
  { kind: 'ice', seed: 1602, pal: { base: [228, 238, 246], deep: [150, 182, 208], crack: [110, 150, 184] }, params: { scale: 2, crackScale: 2.6, crackLines: 22, craters: 0.1, frost: 0.6 } },
  { kind: 'ice', seed: 1603, pal: { base: [198, 220, 238], deep: [96, 140, 182], crack: [64, 106, 156] }, params: { scale: 3.2, crackScale: 4.2, crackLines: 46, craters: 0.3 } },
]);
typeSet('D', [   // газовий гігант
  { kind: 'gas', seed: 1701, pal: { band1: [120, 84, 58], band2: [226, 200, 164], band3: [248, 240, 222], storm: [206, 116, 78] }, params: { bands: 11, turb: 0.2 } },
  { kind: 'gas', seed: 1702, pal: { band1: [92, 96, 128], band2: [186, 196, 226], band3: [232, 238, 252], storm: [150, 120, 200] }, params: { bands: 8, turb: 0.14 } },
  { kind: 'gas', seed: 1703, pal: { band1: [140, 110, 70], band2: [238, 214, 168], band3: [252, 244, 226], storm: [222, 138, 92] }, params: { bands: 13, turb: 0.24 } },
]);
typeSet('CD', [  // крижаний гігант
  { kind: 'icegiant', seed: 1801, pal: { band1: [86, 172, 190], band2: [166, 220, 232], band3: [214, 242, 248], storm: [96, 150, 190] }, params: { bands: 6, turb: 0.1 } },
  { kind: 'icegiant', seed: 1802, pal: { band1: [48, 92, 176], band2: [106, 156, 226], band3: [176, 208, 244], storm: [36, 60, 130] }, params: { bands: 5, turb: 0.08 } },
  { kind: 'icegiant', seed: 1803, pal: { band1: [72, 156, 168], band2: [148, 210, 214], band3: [206, 240, 242], storm: [58, 122, 158] }, params: { bands: 7, turb: 0.12 } },
]);
typeSet('E', [   // екстремальний: високий контраст, тріщини й лід
  { kind: 'extreme', seed: 1901, pal: { dark: [24, 24, 30], base: [92, 88, 96], light: [226, 232, 244], frostCol: [242, 246, 252] }, params: { scale: 2.8, craters: 0.5, crackLines: 60, crackLineCol: [236, 156, 72], lava: 0.9 } },
  { kind: 'extreme', seed: 1902, pal: { dark: [30, 20, 26], base: [104, 72, 84], light: [232, 216, 220], frostCol: [250, 240, 244] }, params: { scale: 2.2, craters: 0.35, crackLines: 44, crackLineCol: [228, 96, 132], lava: 0.86 } },
  { kind: 'extreme', seed: 1903, pal: { dark: [20, 28, 34], base: [76, 96, 104], light: [214, 238, 244], frostCol: [236, 250, 255] }, params: { scale: 3.4, craters: 0.6, crackLines: 70, crackLineCol: [120, 220, 236], lava: 0.92 } },
]);
typeSet('F', [   // вулканічний (тип Іо — без кратерів, жовта сірка)
  { kind: 'volcanic', seed: 2001, pal: { dark: [124, 96, 32], base: [220, 190, 84], lava: [226, 96, 32], hot: [255, 216, 120] }, params: { scale: 2.4, lava: 0.84, crackLines: 20, crackLineCol: [240, 140, 60] } },
  { kind: 'volcanic', seed: 2002, pal: { dark: [96, 84, 40], base: [196, 176, 92], lava: [206, 74, 40], hot: [255, 190, 110] }, params: { scale: 3, lava: 0.8, crackLines: 30, crackLineCol: [232, 110, 52] } },
  { kind: 'volcanic', seed: 2003, pal: { dark: [110, 70, 40], base: [214, 160, 88], lava: [236, 112, 40], hot: [255, 226, 150] }, params: { scale: 1.9, lava: 0.88, crackLines: 14, crackLineCol: [246, 168, 70] } },
]);
typeSet('G', [   // карликова: сіро-коричнева, кратерна, іноді з яскравими плямами
  { kind: 'dwarf', seed: 2101, pal: { dark: [58, 52, 48], base: [124, 114, 104], light: [190, 180, 168] }, params: { scale: 2.4, craters: 0.75, frost: 0.3 } },
  { kind: 'dwarf', seed: 2102, pal: { dark: [72, 52, 40], base: [146, 112, 88], light: [214, 186, 156] }, params: { scale: 2, craters: 0.55, crackLines: 26 } },
  { kind: 'dwarf', seed: 2103, pal: { dark: [48, 54, 60], base: [112, 124, 132], light: [206, 216, 224] }, params: { scale: 2.9, craters: 0.7, frost: 0.55 } },
]);
typeSet('I', [   // мандрівна (rogue): темний крижаний світ без зорі
  { kind: 'rogue', seed: 2201, pal: { dark: [16, 22, 34], base: [58, 74, 96], light: [132, 156, 178], frostCol: [186, 214, 236] }, params: { scale: 2.6, craters: 0.5, crackLines: 30, crackLineCol: [96, 150, 190], frost: 0.8 } },
  { kind: 'rogue', seed: 2202, pal: { dark: [20, 18, 30], base: [70, 66, 92], light: [150, 146, 176], frostCol: [206, 206, 232] }, params: { scale: 2, craters: 0.35, crackLines: 40, crackLineCol: [148, 120, 200], frost: 0.7 } },
  { kind: 'rogue', seed: 2203, pal: { dark: [14, 26, 28], base: [52, 84, 84], light: [124, 168, 164], frostCol: [182, 230, 224] }, params: { scale: 3.2, craters: 0.6, crackLines: 24, crackLineCol: [88, 190, 176], frost: 0.9 } },
]);
typeSet('R', [   // кам'янистий без повітря (супутники S-G, великі астероїди)
  { kind: 'rock', seed: 2301, pal: { dark: [54, 50, 46], base: [122, 114, 104], light: [188, 180, 170] }, params: { scale: 2.6, craters: 0.75 } },
  { kind: 'rock', seed: 2302, pal: { dark: [66, 58, 50], base: [140, 126, 110], light: [200, 188, 172] }, params: { scale: 1.9, craters: 0.8, crackLines: 20 } },
  { kind: 'rock', seed: 2303, pal: { dark: [46, 48, 54], base: [110, 116, 126], light: [180, 186, 198] }, params: { scale: 3.2, craters: 0.95 } },
]);

/* --- Сонячна система: унікальні текстури для 8 планет, 5 карликових, 6 супутників --- */
const SOLAR = [
  { name: 'sol-mercury', kind: 'rock', seed: 3001, pal: { dark: [56, 52, 50], base: [124, 118, 112], light: [190, 184, 178] }, params: { scale: 3, craters: 0.9, crackLines: 8, crackLineCol: [96, 92, 88] } },
  { name: 'sol-venus', kind: 'gas', seed: 3002, pal: { band1: [196, 160, 96], band2: [232, 206, 150], band3: [250, 238, 206], storm: [214, 178, 116] }, params: { bands: 4, turb: 0.3 } },
  { name: 'sol-earth', kind: 'earth', seed: 3003, pal: { shallow: [40, 104, 158], deep: [6, 22, 62], beach: [186, 172, 126], low: [52, 96, 48], high: [116, 96, 60], peak: [198, 198, 196] }, params: { scale: 2.05, sea: 0.505, clouds: 30, cap: 1.19 } },
  { name: 'sol-mars', kind: 'desert', seed: 3004, pal: { dark: [116, 58, 34], base: [186, 104, 62], light: [226, 168, 122] }, params: { scale: 1.8, craters: 0.5, crackLines: 12, crackLineCol: [84, 42, 30], frost: 0.55 } },
  { name: 'sol-jupiter', kind: 'gas', seed: 3005, pal: { band1: [126, 88, 58], band2: [228, 204, 170], band3: [250, 244, 228], storm: [198, 104, 70] }, params: { bands: 13, turb: 0.17 },
    // Велика Червона Пляма — овал ~20° пд. ш., довгота 0.62
    // Велика Червона Пляма: темний «комір» + насичене цегляне ядро
    spots: [{ lon: 0.62, lat: -0.37, rx: 0.125, ry: 0.078, col: [96, 48, 44] }, { lon: 0.62, lat: -0.37, rx: 0.104, ry: 0.062, col: [214, 96, 58] },
      { lon: 0.6, lat: -0.36, rx: 0.06, ry: 0.03, col: [236, 142, 92] },
      { lon: 0.18, lat: 0.5, rx: 0.035, ry: 0.018, col: [238, 228, 208] }, { lon: 0.86, lat: -0.68, rx: 0.045, ry: 0.022, col: [148, 116, 92] }] },
  { name: 'sol-saturn', kind: 'gas', seed: 3006, pal: { band1: [184, 150, 94], band2: [232, 210, 166], band3: [248, 238, 212], storm: [216, 180, 122] }, params: { bands: 11, turb: 0.1 },
    spots: [{ lon: 0.3, lat: 0.42, rx: 0.05, ry: 0.022, col: [246, 240, 222] }] },
  { name: 'sol-uranus', kind: 'icegiant', seed: 3007, pal: { band1: [124, 200, 208], band2: [176, 226, 232], band3: [214, 242, 246], storm: [140, 190, 206] }, params: { bands: 4, turb: 0.06 } },
  { name: 'sol-neptune', kind: 'icegiant', seed: 3008, pal: { band1: [28, 62, 152], band2: [70, 120, 204], band3: [138, 176, 232], storm: [16, 30, 86] }, params: { bands: 6, turb: 0.08 },
    spots: [{ lon: 0.7, lat: -0.42, rx: 0.06, ry: 0.032, col: [16, 30, 86] }, { lon: 0.25, lat: 0.3, rx: 0.03, ry: 0.012, col: [246, 250, 255] }] },
  { name: 'sol-pluto', kind: 'dwarf', seed: 3009, pal: { dark: [86, 66, 52], base: [176, 150, 122], light: [230, 214, 190] }, params: { scale: 2.2, craters: 0.5, frost: 0.6, crackLines: 18, crackLineCol: [96, 74, 60] } },
  { name: 'sol-ceres', kind: 'dwarf', seed: 3010, pal: { dark: [48, 46, 44], base: [104, 100, 96], light: [168, 164, 158] }, params: { scale: 2.8, craters: 0.85, crackLines: 10 } },
  { name: 'sol-haumea', kind: 'ice', seed: 3011, pal: { base: [226, 234, 244], deep: [172, 190, 210], crack: [140, 160, 186] }, params: { scale: 2.4, crackScale: 3, crackLines: 26, craters: 0.12 } },
  { name: 'sol-makemake', kind: 'dwarf', seed: 3012, pal: { dark: [108, 56, 40], base: [186, 110, 74], light: [234, 176, 138] }, params: { scale: 2.1, craters: 0.35, frost: 0.4 } },
  { name: 'sol-eris', kind: 'ice', seed: 3013, pal: { base: [238, 242, 246], deep: [196, 210, 222], crack: [168, 184, 202] }, params: { scale: 2.2, crackScale: 3.6, crackLines: 20, craters: 0.3 } },
  { name: 'sol-moon', kind: 'rock', seed: 3014, pal: { dark: [58, 56, 54], base: [128, 124, 120], light: [196, 192, 186] }, params: { scale: 2.5, craters: 1.0 } },
  { name: 'sol-io', kind: 'volcanic', seed: 3015, pal: { dark: [130, 100, 34], base: [226, 196, 88], lava: [222, 88, 30], hot: [255, 218, 122] }, params: { scale: 2.3, lava: 0.8, crackLines: 30, crackLineCol: [238, 132, 52] } },
  { name: 'sol-europa', kind: 'ice', seed: 3016, pal: { base: [230, 236, 242], deep: [186, 200, 214], crack: [170, 116, 78] }, params: { scale: 2, crackScale: 3.2, crackLines: 60, craters: 0.05 } },
  { name: 'sol-ganymede', kind: 'rock', seed: 3017, pal: { dark: [84, 78, 72], base: [148, 140, 132], light: [206, 202, 196] }, params: { scale: 2.4, craters: 0.5, crackLines: 40, crackLineCol: [104, 96, 92], frost: 0.3 } },
  { name: 'sol-titan', kind: 'gas', seed: 3018, pal: { band1: [176, 118, 40], band2: [216, 164, 74], band3: [238, 200, 120], storm: [190, 132, 52] }, params: { bands: 5, turb: 0.22 } },
  { name: 'sol-triton', kind: 'ice', seed: 3019, pal: { base: [226, 226, 236], deep: [186, 180, 200], crack: [150, 142, 168] }, params: { scale: 2.3, crackScale: 2.8, crackLines: 40, craters: 0.2, frost: 0.5 } },
];

/* ================= ЗАПУСК ================= */
mkdirSync(OUT, { recursive: true });
const specAll = [...SOLAR, ...TYPES];
const list = ONLY.length ? specAll.filter(s => ONLY.includes(s.name)) : specAll;
const manifest = {};
for (const spec of list) {
  const size = spec.name.startsWith('sol') ? [Math.round(TW * 1.14), Math.round(TH * 1.14)] : [TW, TH];
  const buf = makePanorama(spec, size[0], size[1]);
  const file = `${spec.name}.png`;
  writeFileSync(join(OUT, file), encodePNG(size[0], size[1], buf));
  manifest[spec.name] = { file, w: size[0], h: size[1], kind: spec.kind };
  process.stdout.write(`· ${spec.name} ${size[0]}×${size[1]}\n`);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
// контрольний аркуш: 8 у рядку, зменшені вдвічі копії
const CELL = 168, COLS = 8, ROWS = Math.ceil(list.length / COLS);
const sheet = Buffer.alloc(CELL * COLS * CELL * ROWS * 4, 0);
list.forEach((spec, i) => {
  const size = spec.name.startsWith('sol') ? [Math.round(TW * 1.14), Math.round(TH * 1.14)] : [TW, TH];
  const src = makePanorama(spec, size[0], size[1]);
  const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const sx = Math.floor((x / CELL) * size[0]) % size[0], sy = Math.floor((y / CELL) * size[1]) % size[1];
    const d = ((cy + y) * CELL * COLS + cx + x) * 4, s = (sy * size[0] + sx) * 4;
    for (let ch = 0; ch < 4; ch++) sheet[d + ch] = src[s + ch];
  }
});
writeFileSync(join(OUT, '..', 'planets-sheet.png'), encodePNG(CELL * COLS, CELL * ROWS, sheet));
console.log(`✅ ${list.length} текстур планет → public/images/planets/ (+ аркуш planets-sheet.png)`);

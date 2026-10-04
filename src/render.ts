import type { Game, Planet, Place, Ship } from './game';
import { irregularity, orbitPosAU, placeAU, potatoRadius, shipPlace, shipProgress, sysDist } from './game';
import { TAG_COLOR, auFmt, clamp, lyFmt, starTint } from './style';

const AU_KM = 149597870.7;
let TIME = 0; // ігровий час кадру (для обертання спрайтів)

/* ---------- спрайти дрібних тіл (згенеровані tools/gen-sprites.mjs) ---------- */
const SPRITE_FAMS = ['rock', 'dark', 'metal', 'ice', 'rusty'] as const;
type SpriteFam = typeof SPRITE_FAMS[number];
const SPRITES: Record<string, HTMLImageElement[]> = {};
let spritesRequested = false;
/* ---------- текстури планет (згенеровані tools/gen-planets.mjs) ---------- */
/** 19 унікальних текстур Сонячної системи + по 3 варіанти на кожен тип планети */
const PLANET_TEX: Record<string, HTMLImageElement> = {};
let texRequested = false;
const TEX_FAMS = ['A', 'AB', 'AC', 'AF', 'B', 'C', 'CD', 'D', 'E', 'F', 'G', 'I', 'R'];
const SOLAR_TEX: Record<string, string> = {
  'Меркурій': 'sol-mercury', 'Венера': 'sol-venus', 'Земля': 'sol-earth', 'Марс': 'sol-mars',
  'Юпітер': 'sol-jupiter', 'Сатурн': 'sol-saturn', 'Уран': 'sol-uranus', 'Нептун': 'sol-neptune',
  'Плутон': 'sol-pluto', 'Церера': 'sol-ceres', 'Гаумеа': 'sol-haumea', 'Макемаке': 'sol-makemake', 'Ерида': 'sol-eris',
  'Місяць': 'sol-moon', 'Іо': 'sol-io', 'Європа': 'sol-europa', 'Ганімед': 'sol-ganymede', 'Титан': 'sol-titan', 'Тритон': 'sol-triton',
};
/** Спектральний клас тіла → родина текстур */
const TEX_FAM_OF: Record<string, string> = {
  A: 'A', AB: 'AB', AC: 'AC', AF: 'AF', B: 'B', C: 'C', CD: 'CD', D: 'D', E: 'E', F: 'F', G: 'G', I: 'I',
  P: 'R', 'S-C': 'C', 'S-G': 'R', 'S-B': 'B', 'S-F': 'F',
};
/** Почати завантаження спрайтів астероїдів (викликається один раз при старті). */
export function loadSprites() {
  if (spritesRequested || typeof Image === 'undefined') return;
  spritesRequested = true;
  for (const fam of SPRITE_FAMS) {
    SPRITES[fam] = [];
    for (let i = 1; i <= 5; i++) {
      const img = new Image();
      img.src = `images/bodies/${fam}-${String(i).padStart(2, '0')}.png`;
      SPRITES[fam].push(img);
    }
  }
}
/** Родина спрайта за складом тіла: крижані, металеві, іржаві, темні, камʼяні */
export function spriteFamily(p: Planet): SpriteFam {
  // порядок важливий: спершу склад (лід/метал), потім спектральний клас,
  // і лише потім «темні» вуглецеві — інакше всі крижані супутники злилися б в одну родину
  if (p.tags.includes('C') || p.tags.includes('I') || p.tags.includes('S-C') || p.res.vol >= 0.72) return 'ice';
  if (p.res.metal >= 0.75 && p.res.rare >= 0.35) return 'metal';
  if (p.tags.includes('F') || p.tags.includes('AB') || p.tags.includes('S-F')) return 'rusty';
  if (p.tags === 'G' || p.tags === 'S-G' || p.radius < 45) return 'dark';
  if (p.res.vol >= 0.45) return 'ice';   // помірно крижані — теж лід
  return 'rock';
}
function spriteFor(p: Planet): HTMLImageElement | null {
  const list = SPRITES[spriteFamily(p)];
  if (!list) return null;
  const img = list[(p.id * 2654435761 >>> 0) % list.length];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export interface Camera { x: number; y: number; z: number; tx: number; ty: number; tz: number; ease: boolean }
export interface Hit { x: number; y: number; r: number; kind: 'star' | 'planet' | 'moon'; id: number; sys: number }
export interface Scene {
  g: Game; time: number;
  level: 'galaxy' | 'system'; sysId: number; objId: number; selShip: number;
  hoverId: number; hoverKind: string;
  gal: Camera; sys: Camera; fade: number;
  bg: HTMLImageElement | null; W: number; H: number;
}

/* ---------- фон: тайловий зоряний пил із паралаксом ---------- */
const TILE = 260, PER_TILE = 26;
const DUST: [number, number, number][] = (() => {
  let s = 987654321;
  const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const a: [number, number, number][] = [];
  for (let i = 0; i < PER_TILE; i++) a.push([rr(), rr(), rr()]);
  return a;
})();

function drawDust(c: CanvasRenderingContext2D, ox: number, oy: number, W: number, H: number, a: number) {
  const cols = Math.ceil(W / TILE) + 2, rows = Math.ceil(H / TILE) + 2;
  const sx = ((-ox) % TILE + TILE) % TILE, sy = ((-oy) % TILE + TILE) % TILE;
  for (let i = -1; i < cols; i++) for (let j = -1; j < rows; j++) {
    for (const [fx, fy, fb] of DUST) {
      const px = i * TILE + sx + fx * TILE, py = j * TILE + sy + fy * TILE;
      if (px < -2 || py < -2 || px > W + 2 || py > H + 2) continue;
      c.fillStyle = `rgba(255,255,255,${(0.05 + fb * 0.45) * a})`;
      c.fillRect(px, py, fb > 0.85 ? 1.6 : 1, fb > 0.85 ? 1.6 : 1);
    }
  }
}

/* ---------- геометрія тіл ---------- */
/** Найменший радіус тіла на екрані. На далеких масштабах це просто КРАПКА
 *  (0.5 px): гравець бачить, наскільки планети менші за відстані між ними.
 *  У міру наближення тіло виростає до «іконки» (2–7 px), а потім — до свого
 *  справжнього розміру R/AU × масштаб. */
function minRpx(p: Planet, S: number) {
  const icon = 2.4 + 4.6 * Math.log10(1 + p.radius / 120);
  const t = clamp(Math.log10(Math.max(1e-9, S) / 1.5) / Math.log10(2500), 0, 1);
  return 0.5 + (icon - 0.5) * t * t;
}
/** Найменший радіус «іконки» за цього масштабу (для проміжків між супутниками) */
export function bodyIconRpx(p: Planet, S: number) { return minRpx(p, S); }
/** Видимий радіус тіла: справжній кутовий розмір (радіус / а.о. × масштаб),
 *  але не менший за крапку/іконку й не більший за пів екрана. */
export function bodyRpx(p: Planet, S: number, W: number, H: number) {
  return clamp((p.radius / AU_KM) * S, minRpx(p, S), 0.42 * Math.min(W, H));
}
/** Справжній (лінійний) радіус орбіти супутника у пікселях */
export const moonOrbitAU = (m: Planet) => m.a / AU_KM;
/** Поки орбіта менша за диск планети — супутник малюється «на обіді» планети
 *  (нерозрізнений), а з наближенням камери природно відходить на свою орбіту. */
function moonDisplay(m: Planet, prPx: number, S: number) {
  const lin = moonOrbitAU(m) * S;
  const rim = prPx + 2.5;
  return { r: Math.max(lin, rim), stacked: lin < rim, lin };
}
/** Абсолютна позиція тіла у а.о. ТАКА САМА, як його малює drawScene (з урахуванням
 *  «на обіді планети», коли справжня орбіта супутника ще нерозрізненна) — щоб
 *  камера стеження тримала тіло точно в центрі кадру аж до глибокого зуму. */
export function drawnPosAU(g: Game, id: number, S: number, W: number, H: number, time: number): [number, number] {
  const p = g.planets[id];
  const angOf = (m: Planet) => m.phase + (2 * Math.PI * time) / Math.max(0.01, m.period);
  if (p.parent < 0) {
    // планета: якщо в неї є подвійні супутники, вона сама гойдається навколо
    // барицентра (Плутон і Харон) — камера мусить стежити саме за цим зсувом
    let wx = 0, wy = 0;
    for (const mid of p.moons) {
      const m = g.planets[mid];
      if (!m.binary) continue;
      const disp = moonDisplay(m, bodyRpx(p, S, W, H), S);
      if (disp.stacked) continue;
      const mu = m.mass / Math.max(1e-9, p.mass + m.mass);
      wx -= (disp.r / Math.max(1e-12, S)) * mu * Math.cos(angOf(m));
      wy -= (disp.r / Math.max(1e-12, S)) * mu * Math.sin(angOf(m));
    }
    const [bx, by] = orbitPosAU(p, time);
    return [bx + wx, by + wy];
  }
  const par = p.parent >= 0 ? g.planets[p.parent] : null;
  if (!par) return orbitPosAU(p, time);
  const [px, py] = orbitPosAU(par, time);
  const ang = angOf(p);
  const muP = p.binary ? par.mass / Math.max(1e-9, par.mass + p.mass) : 1;
  const rr = (moonDisplay(p, bodyRpx(par, S, W, H), S).r / Math.max(1e-12, S)) * muP;
  return [px + rr * Math.cos(ang), py + rr * Math.sin(ang)];
}
/** Еталонний радіус системи супутників для кадрування: найзовніший із «регулярних»
 *  супутників (а ≤ 30·aMin); далека хмара дрібних астероїдних не враховується. */
export function moonRefAU(g: Game, p: Planet) {
  if (!p.moons.length) return 0;
  const as = p.moons.map(id => g.planets[id].a).sort((x, y) => x - y);
  const cut = as[0] * 30;
  const outer = Math.max(...as.filter(a => a <= cut), as[0]);
  return outer / AU_KM;
}
/** Почати завантаження текстур планет (один раз при старті). */
export function loadPlanetTextures() {
  if (texRequested || typeof Image === 'undefined') return;
  texRequested = true;
  const names = [...Object.values(SOLAR_TEX)];
  for (const fam of TEX_FAMS) for (let i = 1; i <= 3; i++) names.push(`${fam}-0${i}`);
  for (const n of names) {
    const img = new Image();
    img.src = `images/planets/${n}.png`;
    PLANET_TEX[n] = img;
  }
}
/** Готова текстура тіла або null (ще не завантажилась) */
function planetTexFor(p: Planet): HTMLImageElement | null {
  const fam = TEX_FAM_OF[p.tags] || 'R';
  const key = SOLAR_TEX[p.name] ?? `${fam}-0${(Math.imul(p.id, 2654435761) >>> 0) % 3 + 1}`;
  const img = PLANET_TEX[key];
  return img && img.width ? img : null;
}
/** Кільця у радіусах планети: [внутрішнє, зовнішнє, колір]. Гаумеа має справжнє
 *  кільце, Сатурн — найпомітніше; частина газових гігантів теж із кільцями. */
function ringOf(p: Planet): [number, number, string] | null {
  const known: Record<string, [number, number, string]> = {
    'Сатурн': [1.19, 2.32, '226,208,176'], 'Юпітер': [1.42, 1.78, '186,168,150'],
    'Уран': [1.55, 2.02, '168,214,226'], 'Гаумеа': [2.3, 2.75, '214,222,238'],
    'Нептун': [1.7, 2.06, '150,170,220'],
  };
  if (known[p.name]) return known[p.name];
  if (p.tags.includes('D') && (Math.imul(p.id, 2246822519) >>> 0) % 100 < 30) return [1.3, 1.9, '206,196,180'];
  return null;
}
/** Видимий радіус зорі у пікселях системи */
function starPx(g: Game, sysId: number, S: number, W: number, H: number) {
  const s = g.systems[sysId];
  const km = 696000 * Math.pow(s.starMass, 0.8) * (s.giant ? 10 : 1);   // R☉ = 696 000 км
  const icon = (9 + 11 * Math.log10(1 + s.starMass * 3)) * (s.giant ? 1.9 : 1);
  return clamp((km / AU_KM) * S, icon, 0.45 * Math.min(W, H));
}

export function drawScene(c: CanvasRenderingContext2D, st: Scene): Hit[] {
  const hits: Hit[] = [];
  const { W, H } = st;
  TIME = st.time;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#05070d'; c.fillRect(0, 0, W, H);

  const galA = 1 - st.fade, sysA = st.fade;
  if (galA > 0.015) { c.save(); c.globalAlpha = galA; drawGalaxy(c, st, hits); c.restore(); }
  if (sysA > 0.015) { c.save(); c.globalAlpha = sysA; drawSystem(c, st, hits); c.restore(); }
  return hits;
}

/* ================== ГАЛАКТИЧНА КАРТА ================== */
function drawGalaxy(c: CanvasRenderingContext2D, st: Scene, hits: Hit[]) {
  const { g, W, H } = st;
  const cam = st.gal, S = cam.z;
  const X = (wx: number) => (wx - cam.x) * S + W / 2;
  const Y = (wy: number) => (wy - cam.y) * S + H / 2;
  const base = c.globalAlpha;

  // туманність (сильний паралакс — фон далеко)
  const bg = st.bg;
  if (bg) {
    const s2 = Math.max(W / bg.width, H / bg.height) * 1.25;
    const ox = -(bg.width * s2 - W) / 2 - cam.x * S * 0.04;
    const oy = -(bg.height * s2 - H) / 2 - cam.y * S * 0.04;
    c.globalAlpha = base * 0.55;
    c.drawImage(bg, ox, oy, bg.width * s2, bg.height * s2);
    c.globalAlpha = base;
  } else {
    const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H));
    gr.addColorStop(0, '#0d1b2e'); gr.addColorStop(1, '#05070d');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
  }
  // далекі зорі (паралакс 0.22)
  drawDust(c, cam.x * S * 0.22, cam.y * S * 0.22, W, H, base);

  // «сузір'я» — тонкі лінії між дуже близькими зорями
  if (S > 1.2) {
    c.strokeStyle = 'rgba(90,130,190,0.10)'; c.lineWidth = 1;
    for (const a of g.systems) for (const b of g.systems) {
      if (a.id >= b.id) continue;
      if (sysDist(g, a.id, b.id) > 9) continue;
      c.beginPath(); c.moveTo(X(a.x), Y(a.y)); c.lineTo(X(b.x), Y(b.y)); c.stroke();
    }
  }

  // колонії/піратство/території
  const stats: Record<number, { cnt: number[]; nat: number }> = {};
  for (const p of g.planets) {
    if (!p.colony) continue;
    const q = (stats[p.sys] ||= { cnt: new Array(g.factions.length).fill(0), nat: 0 });
    if (p.owner >= 0) q.cnt[p.owner]++; else q.nat++;
  }
  for (const s of g.systems) {
    const x = X(s.x), y = Y(s.y);
    const stat = stats[s.id] || { cnt: new Array(g.factions.length).fill(0), nat: 0 };
    const mx = Math.max(0, ...stat.cnt);
    if (mx > 0) {
      const dom = stat.cnt.indexOf(mx);
      const rr = clamp(38 * S / 8, 8, 46);
      c.fillStyle = g.factions[dom].color + '22';
      c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill();
      c.strokeStyle = g.factions[dom].color + '88'; c.lineWidth = 1.2; c.stroke();
    }
    if (s.piracy > 0.5) {
      c.strokeStyle = 'rgba(255,70,70,0.45)'; c.setLineDash([3, 4]);
      c.beginPath(); c.arc(x, y, clamp(30 * S / 8, 7, 34), 0, 7); c.stroke(); c.setLineDash([]);
    }
  }

  // зорі
  const order = [...g.systems].sort((a, b) => Math.hypot(X(a.x) - W / 2, Y(a.y) - H / 2) - Math.hypot(X(b.x) - W / 2, Y(b.y) - H / 2));
  const labels: [number, number, number, number][] = [];
  const showLabels = S > 1.05;
  for (const s of order) {
    const x = X(s.x), y = Y(s.y);
    if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
    const ex = g.factions[0].explored[s.id];
    const r = clamp((3 + 2.6 * Math.log10(1 + s.starMass * 3)) * Math.pow(clamp(S / 6, 0.6, 6), 0.45), 2.2, 26) * (s.giant ? 1.35 : 1);
    const col = starTint(s.starClass, s.giant);
    const glow = c.createRadialGradient(x, y, 0, x, y, r * 3.4);
    glow.addColorStop(0, col); glow.addColorStop(0.28, col + '99'); glow.addColorStop(1, 'transparent');
    c.globalAlpha = base * (ex ? 0.95 : 0.5); c.fillStyle = glow;
    c.beginPath(); c.arc(x, y, r * 3.4, 0, 7); c.fill();
    c.globalAlpha = base;
    c.fillStyle = ex ? col : '#6b7688';
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    if (s.real && S > 3.2) { // позначка «реальна зоря каталогу»
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
      c.beginPath(); c.arc(x, y, r + 2.5, 0, 7); c.stroke();
    }
    hits.push({ x, y, r: Math.max(10, r + 5), kind: 'star', id: s.id, sys: s.id });

    if (showLabels) {
      const big = S > 3.4;
      const name = s.name;
      c.textAlign = 'center';
      c.font = `${big ? 12 : 10}px sans-serif`;
      const tw = c.measureText(name).width;
      const lx = x, ly = y + r + (big ? 15 : 12);
      let ok = true;
      for (const [rx, ry, rw2] of labels) {
        if (Math.abs(ly - ry) < 12 && Math.abs(lx - rx) < (tw + rw2) / 2 + 6) { ok = false; break; }
      }
      const isSel = st.sysId === s.id;
      if (isSel || st.hoverId === s.id || ok) {
        labels.push([lx, ly, tw, 10]);
        c.fillStyle = ex ? (isSel ? '#ffffff' : '#cfe3ff') : '#8c98a8';
        c.fillText(name, lx, ly);
        if (big || isSel) {
          c.font = '9px sans-serif'; c.fillStyle = ex ? '#8fa4b8' : '#5a6475';
          const sub = ex
            ? `${s.spec} · ${s.planets.length} план. · ${lyFmt(s.distLy)}`
            : `${s.spec} · не досліджено`;
          c.fillText(sub, lx, ly + 11);
          if (isSel) {
            c.strokeStyle = 'rgba(255,255,255,0.9)'; c.setLineDash([3, 3]);
            c.beginPath(); c.arc(x, y, r + 8, 0, 7); c.stroke(); c.setLineDash([]);
          }
        }
      }
    }
  }

  // кораблі
  const t = st.time;
  for (const s of g.ships) {
    if (s.t1 > t) {
      const a = g.systems[s.fromSys], b = g.systems[s.toSys];
      const pr = shipProgress(g, s, t);
      const e = pr * pr * (3 - 2 * pr); // плавний старт/гальмування
      const x = X(a.x + (b.x - a.x) * e), y = Y(a.y + (b.y - a.y) * e);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const col = g.factions[s.owner].color;
      c.globalAlpha = base * 0.9; c.fillStyle = col; c.textAlign = 'center';
      c.font = s.type === 'war' ? '12px sans-serif' : '9px sans-serif';
      c.fillText(SHIP_ICON[s.type], x, y + 3);
      if (s.id === st.selShip) { c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 7, 0, 7); c.stroke(); }
      c.globalAlpha = base;
    } else {
      const sy = g.systems[s.atSys];
      const x = X(sy.x), y = Y(sy.y);
      c.globalAlpha = base * 0.5; c.fillStyle = g.factions[s.owner].color;
      const ang = (s.id % 12) / 12 * Math.PI * 2;
      c.beginPath(); c.arc(x + Math.cos(ang) * 13, y + Math.sin(ang) * 13, s.type === 'war' ? 2.4 : 1.6, 0, 7); c.fill();
      c.globalAlpha = base;
    }
  }

  // маршрут обраного корабля
  if (st.selShip >= 0) {
    const s = g.ships.find(q => q.id === st.selShip);
    if (s) {
      const a = shipPlace(s, 'from'), b = shipPlace(s, 'to');
      const sa = g.systems[a.sys], sb = g.systems[b.sys];
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.setLineDash([5, 5]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(X(sa.x), Y(sa.y)); c.lineTo(X(sb.x), Y(sb.y)); c.stroke(); c.setLineDash([]);
    }
  }

  drawScaleBar(c, W, H, S, 'ly', base);
  c.globalAlpha = base;
}

/* ================== КАРТА ЗОРЯНОЇ СИСТЕМИ ================== */
function drawSystem(c: CanvasRenderingContext2D, st: Scene, hits: Hit[]) {
  const { g, W, H, time } = st;
  if (st.sysId < 0) return;
  const s = g.systems[st.sysId];
  const cam = st.sys, S = cam.z;
  const X = (au: number) => (au - cam.x) * S + W / 2;
  const Y = (au: number) => (au - cam.y) * S + H / 2;
  const base = c.globalAlpha;
  const dot = () => Math.max(0.9, Math.min(3.2, 1.1 * Math.pow(S / 30, 0.28)));

  // --- масштабна сітка (кругові орбіти кратних а.о.) ---
  const viewAU = Math.hypot(W, H) / S;
  const ladder = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  let lastPx = 0;
  for (const au of ladder) {
    const px = au * S;
    if (px < 45 || px > viewAU) continue;
    if (px - lastPx < 55) continue;
    lastPx = px;
    c.strokeStyle = 'rgba(120,160,220,0.07)';
    c.beginPath(); c.arc(X(0), Y(0), px, 0, 7); c.stroke();
    c.fillStyle = 'rgba(140,170,200,0.35)'; c.font = '9px sans-serif'; c.textAlign = 'left';
    c.fillText(`${au} а.о.`, X(0) + px * 0.7071 + 3, Y(0) - px * 0.7071);
  }

  // --- придатна зона та снігова лінія ---
  const hzIn = 0.95 * Math.sqrt(s.lum), hzOut = 1.37 * Math.sqrt(s.lum), snow = 2.7 * Math.sqrt(s.lum);
  if (hzOut * S > 8 && hzOut * S < 3e5) {
    c.fillStyle = 'rgba(90,220,140,0.055)';
    c.beginPath(); c.arc(X(0), Y(0), hzOut * S, 0, 7); c.arc(X(0), Y(0), hzIn * S, 0, 7, true); c.fill();
    c.strokeStyle = 'rgba(110,230,160,0.28)'; c.setLineDash([4, 6]);
    c.beginPath(); c.arc(X(0), Y(0), hzIn * S, 0, 7); c.stroke();
    c.beginPath(); c.arc(X(0), Y(0), hzOut * S, 0, 7); c.stroke();
    c.setLineDash([]);
    if (hzIn * S > 40) { c.fillStyle = 'rgba(120,230,170,0.5)'; c.font = '9px sans-serif'; c.textAlign = 'left'; c.fillText('придатна зона', X(0) + hzIn * S * 0.72, Y(0) - hzIn * S * 0.72); }
  }
  if (snow * S > 40 && snow * S < 3e5) {
    c.strokeStyle = 'rgba(150,210,255,0.25)'; c.setLineDash([2, 8]);
    c.beginPath(); c.arc(X(0), Y(0), snow * S, 0, 7); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(160,215,255,0.5)'; c.font = '9px sans-serif'; c.textAlign = 'left';
    c.fillText('снігова лінія', X(0) + snow * S * 0.7071, Y(0) + snow * S * 0.7071);
  }

  // --- пояси дрібних тіл ---
  for (const belt of s.belts) {
    const [b0, b1] = belt.a;
    if (b1 * S < 6) continue;
    const d = dot() * 0.85;
    if (belt.kind === 'trojan') {
      // троянці — два скупчення за 60° попереду й позаду планети-господаря
      const host = belt.of !== undefined ? g.planets[belt.of] : null;
      const [hx, hy] = host ? orbitPosAU(host, time) : [b1, 0];
      const hAng = Math.atan2(hy, hx);
      // кількість частинок масштабується із зумом — інакше скупчення не розгледіти
      const n = belt.n ?? clamp(Math.round((b1 - b0) * S * 1.6), 160, 1400);
      const pt = Math.max(1, d * 0.8);
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        // щільне ядро + розсіяний «хвіст» уздовж орбіти
        const core = i % 3 !== 2;
        const spread = (((i * 2654435761) % 1000) / 1000 - 0.5) * (core ? 0.2 : 0.55);
        const ang = hAng + side * Math.PI / 3 + spread;
        const rr = b0 + (b1 - b0) * (((i * 40503) % 997) / 997);
        c.fillStyle = core ? 'rgba(222,192,152,0.85)' : 'rgba(190,166,132,0.4)';
        c.fillRect(X(Math.cos(ang) * rr), Y(Math.sin(ang) * rr), pt, pt);
      }
      if (b1 * S > 26) {
        c.fillStyle = 'rgba(228,200,158,0.72)'; c.font = '9px sans-serif'; c.textAlign = 'center';
        const la = hAng + Math.PI / 3;
        c.fillText('троянці L4/L5', X(Math.cos(la) * (b1 + 0.6)), Y(Math.sin(la) * (b1 + 0.6)));
      }
      continue;
    }
    const n = belt.n ?? clamp(Math.round((b1 - b0) * S / 3), 24, 620);
    const isKuiper = belt.kind === 'kuiper';
    c.fillStyle = isKuiper ? 'rgba(150,190,225,0.45)' : 'rgba(190,180,150,0.5)';
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + i * 1.7;
      let rr = b0 + (b1 - b0) * (((i * 2654435761) % 1000) / 1000);
      if (belt.kind === 'main') {
        // люки Кірквуда — резонанси з Юпітером вичищають кільця астероїдів
        const gap = [2.5, 2.82, 2.95, 3.27].some(x => Math.abs(rr - x) < 0.03);
        if (gap) rr += (b1 - b0) * 0.07;
      }
      c.fillRect(X(Math.cos(ang) * rr), Y(Math.sin(ang) * rr), d, d);
    }
    if (belt.label && b1 * S > 90) {
      c.fillStyle = isKuiper ? 'rgba(160,200,235,0.5)' : 'rgba(200,190,160,0.5)';
      c.font = '9px sans-serif'; c.textAlign = 'center';
      const la = -Math.PI / 3.2;
      c.fillText(belt.label, X(Math.cos(la) * (b0 + (b1 - b0) * 0.55)), Y(Math.sin(la) * (b0 + (b1 - b0) * 0.55)));
    }
  }

  // --- орбіти планет ---
  c.lineWidth = 1;
  for (const pid of s.planets) {
    const p = g.planets[pid];
    const b = p.a * Math.sqrt(Math.max(0, 1 - p.e * p.e));
    if (p.a * S < 4) continue;      // затісні орбіти зливаються з диском зорі
    if (p.a * S > 3e5) continue;    // камера глибоко всередині орбіти — дуга вже не влазить
    c.strokeStyle = p.id === st.objId ? 'rgba(180,220,255,0.5)' : 'rgba(120,160,220,0.15)';
    c.beginPath();
    c.ellipse(X(-p.a * p.e), Y(0), Math.max(0.5, p.a * S), Math.max(0.5, b * S), 0, 0, 7);
    c.stroke();
  }

  // --- зоря ---
  const sr = starPx(g, st.sysId, S, W, H);
  const col = starTint(s.starClass, s.giant);
  const cx = X(0), cy = Y(0);
  const g1 = c.createRadialGradient(cx, cy, 0, cx, cy, sr * 9);
  g1.addColorStop(0, col); g1.addColorStop(0.08, col + 'cc'); g1.addColorStop(0.3, col + '33'); g1.addColorStop(1, 'transparent');
  c.fillStyle = g1; c.beginPath(); c.arc(cx, cy, sr * 9, 0, 7); c.fill();
  const g2 = c.createRadialGradient(cx - sr * 0.3, cy - sr * 0.3, sr * 0.1, cx, cy, sr);
  g2.addColorStop(0, '#ffffff'); g2.addColorStop(0.55, col); g2.addColorStop(1, '#ffffff22');
  c.fillStyle = g2; c.beginPath(); c.arc(cx, cy, sr, 0, 7); c.fill();
  c.textAlign = 'center';
  c.fillStyle = '#ffffff'; c.font = 'bold 13px sans-serif';
  c.fillText(s.name, cx, cy - sr - 8);
  c.fillStyle = '#9fb3c8'; c.font = '10px sans-serif';
  c.fillText(`${s.spec} · ${s.starMass.toFixed(2)} M☉ · L=${s.lum < 0.01 ? s.lum.toExponential(1) : s.lum.toFixed(2)}`, cx, cy - sr - 20);
  hits.push({ x: cx, y: cy, r: Math.max(14, sr), kind: 'star', id: s.id, sys: s.id });

  // --- планети, карликові планети, астероїди та супутники ---
  for (const pid of s.planets) {
    const p = g.planets[pid];
    const [ax, ay] = orbitPosAU(p, time);
    const x = X(ax), y = Y(ay);
    const rad = bodyRpx(p, S, W, H);
    // найбільший радіус, який може займати система супутників цієї планети
    const far = p.moons.length ? Math.max(...p.moons.map(id => moonOrbitAU(g.planets[id]))) * S : 0;
    if (x < -80 - far || y < -80 - far || x > W + 80 + far || y > H + 80 + far) continue;

    // --- супутники: справжні орбіти в а.о.; нерозрізнені — на обіді планети ---
    // Подвійні системи (Плутон–Харон): обидва тіла обертаються навколо барицентра,
    // тож планета помітно «гойдається» в протилежний бік від великого супутника.
    let wobX = 0, wobY = 0;
    for (const mid of p.moons) {
      const m = g.planets[mid];
      if (!m.binary) continue;
      const disp = moonDisplay(m, rad, S);
      if (disp.stacked) continue;
      const ang = m.phase + (2 * Math.PI * time) / Math.max(0.01, m.period);
      const mu = m.mass / Math.max(1e-9, p.mass + m.mass);
      wobX -= disp.r * mu * Math.cos(ang); wobY -= disp.r * mu * Math.sin(ang);
    }
    const px2 = x + wobX, py2 = y + wobY;      // де насправді малюємо планету
    if (p.moons.length) {
      let stacked = 0;
      for (const mid of p.moons) {
        const m = g.planets[mid];
        const disp = moonDisplay(m, rad, S);
        const ang = m.phase + (2 * Math.PI * time) / Math.max(0.01, m.period);
        // у подвійній парі супутник теж відходить від барицентра (на μ планети)
        const muP = m.binary ? p.mass / Math.max(1e-9, p.mass + m.mass) : 1;
        const mx = x + disp.r * muP * Math.cos(ang), my = y + disp.r * muP * Math.sin(ang);
        if (disp.stacked) {
          // нерозрізненний супутник — маленька точка на обіді планети
          stacked++;
          c.fillStyle = 'rgba(190,210,235,0.55)';
          c.beginPath(); c.arc(mx, my, 1.5, 0, 7); c.fill();
          hits.push({ x: mx, y: my, r: 6, kind: 'moon', id: m.id, sys: p.sys });
          continue;
        }
        // супутник за кадром не малюємо: орбіти й текстури далеких тіл — марна робота
        if (mx < -60 || my < -60 || mx > W + 60 || my > H + 60) continue;
        c.strokeStyle = m.id === st.objId ? 'rgba(190,225,255,0.45)' : 'rgba(140,175,215,0.13)';
        c.beginPath(); c.arc(x, y, disp.r, 0, 7); c.stroke();
        const mrad = bodyRpx(m, S, W, H);
        drawBody(c, mx, my, mrad, m);
        if (m.colony) { c.strokeStyle = m.owner >= 0 ? g.factions[m.owner].color : '#e8f4ff'; c.lineWidth = 1.4; c.beginPath(); c.arc(mx, my, mrad + 2.5, 0, 7); c.stroke(); c.lineWidth = 1; }
        if (m.id === st.objId || st.hoverId === m.id) {
          c.strokeStyle = m.id === st.objId ? '#fff' : 'rgba(255,255,255,0.5)';
          c.setLineDash([2, 2]); c.beginPath(); c.arc(mx, my, mrad + 5, 0, 7); c.stroke(); c.setLineDash([]);
        }
        hits.push({ x: mx, y: my, r: Math.max(mrad + 3, 6), kind: 'moon', id: m.id, sys: p.sys });
        if (disp.r > 26 || m.id === st.objId || st.hoverId === m.id) {
          c.fillStyle = m.id === st.objId ? '#ffffff' : '#9fb3c8'; c.font = '9px sans-serif'; c.textAlign = 'center';
          c.fillText(m.name, mx, my - mrad - 4);
          if ((m.id === st.objId || st.hoverId === m.id) && mrad > 40) {
            c.fillStyle = irregularity(m) > 0.15 ? '#ffc46b' : '#9fd8a0'; c.font = '9px sans-serif';
            c.fillText(`R ${fmtKm(m.radius)} км · ${irregularity(m) > 0.15 ? 'неправильна форма' : 'куляста'} · період ${m.period < 1 ? (m.period * 24).toFixed(1) + ' год' : m.period.toFixed(1) + ' діб'}`, mx, my + mrad + 10);
          }
        }
      }
      if (stacked > 0 && p.a * S > 20) {
        c.fillStyle = 'rgba(150,180,215,0.55)'; c.font = '9px sans-serif'; c.textAlign = 'left';
        c.fillText(`${p.moons.length} супутн. — наблизьте, щоб роздивитись`, x + rad + 8, y + rad + 12);
      }
    }

    drawBody(c, px2, py2, rad, p);
    if (p.colony) {
      c.strokeStyle = p.owner >= 0 ? g.factions[p.owner].color : '#e8f4ff';
      c.lineWidth = 1.6; c.beginPath(); c.arc(px2, py2, rad + 4.5, 0, 7); c.stroke(); c.lineWidth = 1;
    }
    if (p.id === st.objId || st.hoverId === p.id) {
      c.strokeStyle = p.id === st.objId ? '#ffffff' : 'rgba(255,255,255,0.5)';
      c.setLineDash([2, 3]); c.beginPath(); c.arc(px2, py2, rad + 9, 0, 7); c.stroke(); c.setLineDash([]);
    }
    hits.push({ x: px2, y: py2, r: Math.max(rad + 4, 10), kind: 'planet', id: p.id, sys: p.sys });

    // виноска «розгляду» — коли камера наближена до обраного тіла
    if ((p.id === st.objId || st.hoverId === p.id) && rad > 40) {
      // виноска з фізичними характеристиками обраного тіла
      const lines = [
        `${p.name} · R ${fmtKm(p.radius)}`,
        `${isIrrLabel(p)}`,
        `доба ${p.rot.toFixed(1)} год · нахил ${p.tilt.toFixed(1)}°`,
        p.moons.length ? `супутників: ${p.moons.length}` : 'супутників немає',
      ];
      c.textAlign = 'left'; c.font = '10px sans-serif';
      const wBox = Math.max(...lines.map(l => c.measureText(l).width)) + 12;
      const bx = px2 + rad + 12, by = py2 - 6;
      c.fillStyle = 'rgba(5,9,18,0.72)'; c.fillRect(bx, by, wBox, 13 * lines.length + 8);
      c.strokeStyle = 'rgba(120,180,230,0.35)'; c.lineWidth = 1; c.strokeRect(bx, by, wBox, 13 * lines.length + 8);
      const bx2 = px2 + rad + 12;
      lines.forEach((l, i) => { c.fillStyle = i === 0 ? '#ffffff' : i === 1 ? (irregularity(p) > 0.15 ? '#ffc46b' : '#9fd8a0') : '#9fb3c8'; c.fillText(l, bx2 + 6, by + 16 + i * 13); });
    }

    // підписи
    const showAll = p.a * S > 26;
    if (showAll || p.id === st.objId || st.hoverId === p.id) {
      c.textAlign = 'center';
      c.fillStyle = '#cfe3ff'; c.font = '11px sans-serif';
      c.fillText(p.name, px2, py2 - rad - 14);
      c.fillStyle = '#8fa4b8'; c.font = '9px sans-serif';
      const kind = p.kind === 'dwarf' ? 'карликова планета' : p.kind === 'asteroid' ? 'астероїд' : '';
      c.fillText(`${auFmt(p.a)} а.о.${kind ? ' · ' + kind : ''}${p.moons.length ? ` · ${p.moons.length} супутн.` : ''}${p.colony ? ' · ' + Math.round(p.colony.pop) + 'k' : ''}`, px2, py2 - rad - 24);
    }
  }

  // --- кораблі ---
  for (const sh of g.ships) {
    const pos = shipSystemPos(g, sh, time, st.sysId);
    if (!pos) continue;
    const x = X(pos[0]), y = Y(pos[1]);
    if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
    c.globalAlpha = base * (sh.t1 > time ? 0.75 : 0.95);
    c.fillStyle = g.factions[sh.owner].color; c.textAlign = 'center';
    c.font = sh.type === 'war' ? '13px sans-serif' : '10px sans-serif';
    c.fillText(SHIP_ICON[sh.type], x, y + 3);
    if (sh.id === st.selShip) { c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 8, 0, 7); c.stroke(); }
    c.globalAlpha = base;
  }

  // --- сусідні системи: куди летіти далі ---
  const near = [...g.systems].filter(q => q.id !== st.sysId).sort((a, b) => sysDist(g, st.sysId, a.id) - sysDist(g, st.sysId, b.id)).slice(0, 6);
  c.textAlign = 'left';
  for (const q of near) {
    const ang = Math.atan2(q.y - s.y, q.x - s.x);
    const rx = Math.min(W, H) * 0.42;
    const px = W / 2 + Math.cos(ang) * rx, py = H / 2 + Math.sin(ang) * rx;
    if (px < 10 || py < 10 || px > W - 10 || py > H - 10) continue;
    c.fillStyle = 'rgba(160,190,220,0.5)'; c.font = '9px sans-serif';
    const d = sysDist(g, st.sysId, q.id);
    c.fillText(`↗ ${q.name} · ${lyFmt(d)}`, px + 4 * Math.cos(ang), py);
  }

  drawScaleBar(c, W, H, S, 'au', base);
  c.globalAlpha = base;
}

const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : km < 1000 ? km.toFixed(0) : Math.round(km).toLocaleString('uk-UA'));
const isIrrLabel = (p: Planet) => {
  if (p.triax) return `витягнутий еліпсоїд — швидке обертання (доба ${p.rot.toFixed(1)} год)`;
  const irr = irregularity(p);
  if (irr <= 0.02) return 'куляста форма (гідростатична рівновага)';
  if (irr <= 0.15) return `проміжна форма (R ${fmtKm(p.radius)} км, межа ${potatoRadius(p)} км)`;
  return `неправильна форма — «картоплина» (R ${fmtKm(p.radius)} км < ${potatoRadius(p)} км)`;
};

const SHIP_ICON: Record<string, string> = { freighter: '▲', heavy: '■', tanker: '●', scout: '◆', war: '✦' };

/** Позиція корабля у а.о. в межах системи sysId (або null, якщо його там немає) */
export function shipSystemPos(g: Game, sh: Ship, time: number, sysId: number): [number, number] | null {
  const dockAU = (pl: Place, id: number): [number, number] => {
    if (pl.p >= 0) return placeAU(g, pl, time);
    const ang = id * 2.399;
    return [0.35 * Math.cos(ang), 0.35 * Math.sin(ang)];
  };
  if (sh.t1 <= time) {
    return sh.atSys === sysId ? dockAU(shipPlace(sh, 'at'), sh.id) : null;
  }
  const from = shipPlace(sh, 'from'), to = shipPlace(sh, 'to');
  const t = shipProgress(g, sh, time);
  if (from.sys === to.sys) {
    if (from.sys !== sysId) return null;
    const [ax, ay] = dockAU(from, sh.id), [bx, by] = dockAU(to, sh.id + 1);
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  }
  if (from.sys !== sysId && to.sys !== sysId) return null;
  const s0 = g.systems[sysId], other = g.systems[from.sys === sysId ? to.sys : from.sys];
  const ang = Math.atan2(other.y - s0.y, other.x - s0.x);
  const r = 45;
  return [r * Math.cos(ang), r * Math.sin(ang)];
}

/* ---------- допоміжне ---------- */
/** Малює тіло. Три режими:
 *   • спрайт — дрібні тіла (менші за «картопляний радіус»), коли вони вже досить великі
 *     на екрані: астероїд/«картоплина» з кратерами, обертається;
 *   • процедурна «картоплина» — ті самі тіла, поки вони менші за ~8 px (спрайт не потрібен);
 *   • сфера — планети, великі супутники, газові гіганти (з еліпсоїдом для карликів,
 *     які не досягли гідростатичної рівноваги). */
function drawBody(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Planet) {
  const col = TAG_COLOR[p.tags] || '#8aa2b8';
  const gas = p.tags.includes('D');
  const irr = irregularity(p);

  // --- на далекому плані тіло — лише крапка: так видно, які вони крихітні ---
  if (r < 1.3) {
    c.fillStyle = col;
    c.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    return;
  }

  // --- дрібні тіла: спрайт або процедурна картоплина ---
  if (irr > 0.02 && !gas && !p.triax) {
    const img = r >= 8 ? spriteFor(p) : null;
    if (img) {
      const ang = ((p.id * 0.7) % 1 + 1) * 0.6 * Math.PI + (TIME / Math.max(0.05, p.rot / 24)) * 0.06;
      c.save();
      c.translate(x, y); c.rotate(ang);
      c.drawImage(img, -r, -r, r * 2, r * 2);
      c.restore();
      // легкий контур, щоб тіло читалося на темному тлі
      if (r > 10) { c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, r * 0.96, 0, 7); c.stroke(); }
      return;
    }
    const n = 12;
    const seed = (p.id * 2654435761) % 100000;
    c.save(); c.translate(x, y);
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a2 = (i / n) * Math.PI * 2;
      const h = ((seed * (i + 7) * 9301 + 49297) % 233280) / 233280;
      const rr = r * (1 - irr * 0.42 + irr * 0.84 * h);
      const px2 = Math.cos(a2) * rr, py2 = Math.sin(a2) * rr * 0.94;
      if (i === 0) c.moveTo(px2, py2); else c.lineTo(px2, py2);
    }
    c.closePath();
    const grad2 = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.15);
    grad2.addColorStop(0, lighten(col, 0.4)); grad2.addColorStop(0.7, col); grad2.addColorStop(1, '#070b14');
    c.fillStyle = grad2; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 0.8; c.stroke();
    c.restore();
    return;
  }

  // --- кулясті тіла: справжня куля; «проміжні» карлики — еліпсоїд ---
  // p.triax — виміряна тривісність (напр., Гаумеа: 1050×840×537 км), інакше
  // невеликий ступінь витягнутості для тіл поблизу «картопляного радіуса»
  const triax = clamp(p.triax ?? irr, 0, 0.28); // 0 — куля, більше — витягнутий еліпсоїд
  const ax = r * (1 + triax * 1.6), by = r * (1 - triax * 0.6);
  const tilt = ((p.id * 0.37) % 1 - 0.5) * 1.1 + (p.tilt * Math.PI) / 180 * 0.15;
  const tex = r >= 5 ? planetTexFor(p) : null;
  const ring = r >= 3 ? ringOf(p) : null;

  // кільця: дальня половина ховається за планетою, ближня — перед нею
  if (ring) drawRing(c, x, y, ax, by, ring, true);

  c.save();
  c.translate(x, y);
  if (tex) {
    // --- текстурована планета: панорама «прокручується» з добою тіла, а світло
    //     (термінатор + затемнення лімба) накладається множенням на екрані ---
    c.save();
    c.rotate(tilt);
    c.beginPath(); c.ellipse(0, 0, ax, by, 0, 0, 7); c.clip();
    const tw = (tex.width / tex.height) * 2 * by;                   // період прокрутки
    const off = (((TIME / Math.max(0.5, p.rot)) * tw * 0.05) % tw + tw) % tw;
    c.drawImage(tex, -tw / 2 - off, -by, tw, 2 * by);
    c.drawImage(tex, -tw / 2 - off + tw, -by, tw, 2 * by);
    c.rotate(-tilt);                                                // світло — у координатах екрана
    const L = Math.max(ax, by) * 1.5;
    c.globalCompositeOperation = 'multiply';
    const lin = c.createLinearGradient(-L * 0.62, -L * 0.62, L * 0.62, L * 0.62);
    lin.addColorStop(0, '#ffffff'); lin.addColorStop(0.44, '#c9cfdf');
    lin.addColorStop(0.78, '#3a4256'); lin.addColorStop(1, '#0a0e1a');
    c.fillStyle = lin; c.fillRect(-L, -L, L * 2, L * 2);
    const rim = c.createRadialGradient(0, 0, Math.min(ax, by) * 0.55, 0, 0, Math.max(ax, by) * 1.03);
    rim.addColorStop(0, '#ffffff'); rim.addColorStop(1, '#767c8c');
    c.fillStyle = rim; c.fillRect(-L, -L, L * 2, L * 2);
    c.globalCompositeOperation = 'source-over';
    c.restore();
  } else {
    c.rotate(tilt);
    const grad = c.createRadialGradient(-ax * 0.32, -by * 0.4, r * 0.08, 0, 0, Math.max(ax, by));
    grad.addColorStop(0, lighten(col, 0.45));
    grad.addColorStop(0.65, col);
    grad.addColorStop(1, '#070b14');
    c.fillStyle = grad;
    c.beginPath(); c.ellipse(0, 0, ax, by, 0, 0, 7); c.fill();
    if (gas && r > 9) {
      c.save(); c.beginPath(); c.ellipse(0, 0, ax, by, 0, 0, 7); c.clip();
      for (let i = -3; i <= 3; i++) {
        c.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)';
        c.fillRect(-ax, i * by * 0.28 - by * 0.1, ax * 2, by * 0.16);
      }
      c.restore();
    }
    // --- поверхня: деталі з'являються лише коли тіло вже велике на екрані ---
    if (r > 34) drawSurface(c, ax, by, r, p);
    if (r > 6) { c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.ellipse(0, 0, ax, by, 0, 0, 7); c.stroke(); }
    if (p.pressure > 0.5 && p.tags.includes('A') && r > 6) {
      c.fillStyle = 'rgba(120,190,255,0.14)'; c.beginPath(); c.ellipse(0, 0, ax * 1.12, by * 1.12, 0, 0, 7); c.fill();
    }
  }
  c.restore();

  // --- атмосферний ореол навколо диска ---
  if (r > 5 && !gas && p.atmo && p.pressure > 0.05) {
    c.save(); c.translate(x, y); c.rotate(tilt);
    const gl = c.createRadialGradient(0, 0, Math.max(ax, by) * 0.92, 0, 0, Math.max(ax, by) * 1.2);
    gl.addColorStop(0, 'rgba(150,200,255,0)'); gl.addColorStop(0.45, 'rgba(168,208,255,0.3)'); gl.addColorStop(1, 'rgba(150,200,255,0)');
    c.fillStyle = gl; c.beginPath(); c.ellipse(0, 0, ax * 1.22, by * 1.22, 0, 0, 7); c.fill();
    c.restore();
  }
  if (ring) drawRing(c, x, y, ax, by, ring, false);
}

/** Половинка кільця: дальня (far) — до планети, ближня — після. Кільця малюються
 *  дугами-смугами з проміжками (щілина Кассіні в Сатурна тощо). */
function drawRing(c: CanvasRenderingContext2D, x: number, y: number, ax: number, by: number, ring: [number, number, string], far: boolean) {
  const [ri, ro, col] = ring;
  const bands = clamp(Math.round((ro - ri) * 9), 4, 18);
  c.save(); c.translate(x, y);
  for (let i = 0; i < bands; i++) {
    const t = (i + 0.5) / bands;
    const rr = ri + (ro - ri) * t;
    const gap = Math.abs(t - 0.42) < 0.045 ? 0.18 : 1 - 0.42 * Math.abs(Math.sin(i * 1.7));
    c.strokeStyle = `rgba(${col},${(0.55 * gap).toFixed(3)})`;
    c.lineWidth = Math.max(0.8, ((ro - ri) * ax) / bands * 1.05);
    c.beginPath();
    c.ellipse(0, 0, ax * rr, by * rr, 0, far ? Math.PI : 0, far ? 2 * Math.PI : Math.PI);
    c.stroke();
  }
  c.restore();
}

function hashRnd(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Процедурна поверхня для великих тіл: континенти/океани, пояси газових гігантів,
 *  кратери й полярні шапки. Детерміновано від id тіла, тож не «мерехтить». */
function drawSurface(c: CanvasRenderingContext2D, ax: number, by: number, r: number, p: Planet) {
  const gas = p.tags.includes('D');
  const rnd = hashRnd(p.id * 7919 + 13);
  c.save();
  c.beginPath(); c.ellipse(0, 0, ax, by, 0, 0, 7); c.clip();
  const S = Math.max(ax, by);
  if (gas) {
    // пояси хмар + велика пляма
    for (let i = 0; i < 14; i++) {
      const yy = -by + (i / 13) * by * 2;
      const h = (by * 2) / 13 * (0.5 + rnd() * 0.9);
      const light = rnd();
      c.fillStyle = light > 0.5 ? `rgba(255,255,255,${0.05 + rnd() * 0.09})` : `rgba(0,0,0,${0.05 + rnd() * 0.1})`;
      c.beginPath();
      c.ellipse((rnd() - 0.5) * ax * 0.3, yy, ax * (0.85 + rnd() * 0.2), h / 2, (rnd() - 0.5) * 0.06, 0, 7);
      c.fill();
    }
    if (p.name === 'Юпітер' || rnd() < 0.5) {
      c.fillStyle = 'rgba(200,110,80,0.65)';
      c.beginPath(); c.ellipse(ax * 0.25, by * 0.28, ax * 0.2, by * 0.11, 0.2, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,220,200,0.25)'; c.lineWidth = Math.max(1, r * 0.01); c.stroke();
    }
  } else if (p.tags.includes('A')) {
    // океан + континенти + полярні шапки
    const sea = p.hydroCov > 0.05 ? Math.min(0.92, Math.max(0.3, p.hydroCov)) : 0.75;
    c.fillStyle = `rgba(28,74,132,${0.55 + sea * 0.3})`;
    c.fillRect(-ax, -by, ax * 2, by * 2);
    const land = p.habit > 0.55 ? [58, 108, 62] : p.habit > 0.25 ? [124, 112, 74] : [150, 120, 96];
    for (let i = 0; i < 12; i++) {
      const cx2 = (rnd() - 0.5) * ax * 1.5, cy2 = (rnd() - 0.5) * by * 1.5;
      const rr = S * (0.06 + rnd() * 0.22);
      c.fillStyle = `rgba(${land[0]},${land[1]},${land[2]},${0.75 + rnd() * 0.25})`;
      c.beginPath();
      c.moveTo(cx2, cy2);
      const pts = 7;
      for (let k = 1; k <= pts; k++) {
        const a2 = (k / pts) * Math.PI * 2;
        const rad2 = rr * (0.55 + rnd() * 0.8);
        c.lineTo(cx2 + Math.cos(a2) * rad2, cy2 + Math.sin(a2) * rad2 * 0.75);
      }
      c.closePath(); c.fill();
    }
    if (p.temp < 300) {
      c.fillStyle = 'rgba(240,248,255,0.85)';
      c.beginPath(); c.ellipse(0, -by * 1.02, ax * 0.75, by * 0.16, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(0, by * 1.02, ax * 0.8, by * 0.18, 0, 0, 7); c.fill();
    }
  } else {
    // кратерний рельєф для пустельних, крижаних і камʼяних тіл
    for (let i = 0; i < 26; i++) {
      const cx2 = (rnd() - 0.5) * ax * 1.8, cy2 = (rnd() - 0.5) * by * 1.8;
      const rr = S * (0.03 + Math.pow(rnd(), 2) * 0.16);
      c.fillStyle = `rgba(0,0,0,${0.06 + rnd() * 0.12})`;
      c.beginPath(); c.ellipse(cx2, cy2, rr, rr * (0.7 + rnd() * 0.5), 0, 0, 7); c.fill();
      c.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.08})`; c.lineWidth = Math.max(0.6, rr * 0.14);
      c.beginPath(); c.ellipse(cx2 - rr * 0.1, cy2 - rr * 0.15, rr * 1.05, rr * 0.75, 0, 0, 7); c.stroke();
    }
    if (p.res.vol > 0.6) {
      c.fillStyle = 'rgba(235,246,255,0.25)';
      c.beginPath(); c.ellipse(0, -by * 0.98, ax * 0.85, by * 0.2, 0, 0, 7); c.fill();
    }
  }
  c.restore();
}

function lighten(hex: string, f: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(s => s + s).join('') : h, 16);
  const r = Math.min(255, ((n >> 16) & 255) + 255 * f), g2 = Math.min(255, ((n >> 8) & 255) + 255 * f), b = Math.min(255, (n & 255) + 255 * f);
  return `rgb(${r | 0},${g2 | 0},${b | 0})`;
}

/** Лінійка масштабу внизу праворуч: 'ly' — світлові роки, 'au' — астрономічні одиниці */
function drawScaleBar(c: CanvasRenderingContext2D, W: number, H: number, S: number, unit: 'ly' | 'au', alpha: number) {
  // сходинки довжин: світлові роки — для галактики, а.о. й кілометри — для системи
  const ladder: [number, string][] = unit === 'ly'
    ? [[0.1, 'св. р.'], [0.2, 'св. р.'], [0.5, 'св. р.'], [1, 'св. р.'], [2, 'св. р.'], [5, 'св. р.'], [10, 'св. р.'], [20, 'св. р.'], [50, 'св. р.'], [100, 'св. р.'], [200, 'св. р.'], [500, 'св. р.']]
    : [[1000, 'км'], [2000, 'км'], [5000, 'км'], [10000, 'км'], [20000, 'км'], [50000, 'км'], [100000, 'км'], [200000, 'км'], [500000, 'км'],
       [1e6, 'км'], [2e6, 'км'], [5e6, 'км'], [0.05, 'а.о.'], [0.1, 'а.о.'], [0.2, 'а.о.'], [0.5, 'а.о.'], [1, 'а.о.'], [2, 'а.о.'], [5, 'а.о.'],
       [10, 'а.о.'], [20, 'а.о.'], [50, 'а.о.'], [100, 'а.о.'], [200, 'а.о.'], [500, 'а.о.'], [1000, 'а.о.'], [2000, 'а.о.']];
  const pxOf = (v: number, u: string) => (u === 'км' ? (v / AU_KM) * S : v * S);
  let pick: number = ladder[0][0], label: string = ladder[0][1];
  for (const [v, u] of ladder) { if (pxOf(v, u) <= W * 0.22) { pick = v; label = u; } }
  const px = pxOf(pick, label);
  const x1 = W - 22 - px, y1 = H - 26;
  c.globalAlpha = alpha * 0.75;
  c.strokeStyle = '#8fb0d0'; c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x1, y1 - 4); c.lineTo(x1, y1); c.lineTo(x1 + px, y1); c.lineTo(x1 + px, y1 - 4);
  c.stroke();
  c.fillStyle = '#9fb3c8'; c.font = '10px sans-serif'; c.textAlign = 'center';
  const txt = label === 'км' ? `${pick >= 1000 ? (pick / 1000) + ' тис.' : pick} км` : `${pick} ${label}`;
  c.fillText(txt, x1 + px / 2, y1 - 7);
  // ще й «метри на піксель» — орієнтир для глибокого зуму
  if (label === 'км' && px > 0) {
    const mpp = AU_KM * 1000 / S;
    if (mpp < 1e5) {
      c.fillStyle = '#7f93a8'; c.font = '9px sans-serif';
      c.fillText(mpp >= 1000 ? `${(mpp / 1000).toFixed(1)} км/px` : `${mpp.toFixed(0)} м/px`, x1 + px / 2, y1 + 11);
    }
  }
  c.globalAlpha = alpha;
}


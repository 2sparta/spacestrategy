// ================== CORE GAME MODEL ==================
import { CATALOG_PREFIX, RANDOM_NAMES, REAL_STARS, galXY, type KnownPlanet } from './stars';
let seed = 1337;
export function setSeed(s: number) { seed = s; }
export function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const R = (a: number, b: number) => a + rnd() * (b - a);
function pick<T>(a: T[]): T { return a[Math.floor(rnd() * a.length)]; }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const GOODS = ['Їжа', 'Вода', 'Кисень', 'Паливо', 'Метал', 'Рідкоземи', 'Електроніка', 'Машини', 'Зброя', 'Ліки', 'Розкіш', 'Наука'];
export const GOOD_ICON = ['🌾', '💧', '🫧', '⛽', '🔩', '💎', '💾', '⚙️', '🔫', '💊', '🍷', '🔬'];
export const BASE = [10, 6, 8, 15, 12, 40, 60, 80, 70, 50, 90, 100];
// consumption per 1k pop per day
const CONS = [0.1, 0.1, 0.03, 0.02, 0, 0, 0.01, 0.005, 0.002, 0.02, 0.01, 0];

export type ResKey = 'metal' | 'rare' | 'vol' | 'org' | 'fuel' | 'exotic' | 'geo';
export type Res = Record<ResKey, number>;
export const RES_NAME: Record<ResKey, string> = { metal: 'Метали', rare: 'Рідкоземи', vol: 'Леткі (лід/вода)', org: 'Органіка', fuel: 'Паливо (H/He-3)', exotic: 'Екзотика', geo: 'Геотермаль' };

export interface BuildDef { id: string; name: string; cost: number; inp: Record<number, number>; out: Record<number, number>; res?: ResKey; en: number; poll: number; housing?: number }
export const BUILD: BuildDef[] = [
  { id: 'farm', name: 'Агроферма', cost: 800, inp: { 1: 2 }, out: { 0: 12 }, res: 'org', en: -1, poll: 0 },
  { id: 'water', name: 'Льодовий екстрактор', cost: 700, inp: {}, out: { 1: 14, 2: 8 }, res: 'vol', en: -1, poll: 0 },
  { id: 'mine', name: 'Рудник', cost: 900, inp: {}, out: { 4: 14 }, res: 'metal', en: -1, poll: 3 },
  { id: 'rare', name: 'Рідкоземна шахта', cost: 1500, inp: {}, out: { 5: 6 }, res: 'rare', en: -1, poll: 4 },
  { id: 'refinery', name: 'Паливний завод', cost: 1200, inp: { 1: 3 }, out: { 3: 14 }, res: 'fuel', en: -1, poll: 3 },
  { id: 'solar', name: 'Сонячна ферма', cost: 500, inp: {}, out: {}, en: 3, poll: 0 },
  { id: 'reactor', name: 'Термоядерний реактор', cost: 1800, inp: { 3: 1 }, out: {}, en: 8, poll: 1 },
  { id: 'geo', name: 'Геотермальна станція', cost: 1200, inp: {}, out: {}, res: 'geo', en: 9, poll: 1 },
  { id: 'fab', name: 'Фабрика електроніки', cost: 2500, inp: { 4: 4, 5: 3 }, out: { 6: 6 }, en: -2, poll: 3 },
  { id: 'machine', name: 'Машинобудування', cost: 3000, inp: { 4: 8, 6: 2 }, out: { 7: 4 }, en: -2, poll: 4 },
  { id: 'arms', name: 'Збройовий завод', cost: 3000, inp: { 4: 5, 6: 2 }, out: { 8: 4 }, en: -2, poll: 3 },
  { id: 'pharma', name: 'Фармацевтика', cost: 2000, inp: { 0: 3, 1: 2 }, out: { 9: 5 }, res: 'org', en: -1, poll: 1 },
  { id: 'luxury', name: 'Студія розкоші', cost: 2500, inp: { 0: 3, 6: 1 }, out: { 10: 3 }, en: -1, poll: 0 },
  { id: 'lab', name: 'Наукова лабораторія', cost: 3000, inp: { 6: 1 }, out: { 11: 3 }, en: -2, poll: 0 },
  { id: 'exotic', name: 'Екзо-лабораторія', cost: 4000, inp: {}, out: { 11: 5, 5: 2 }, res: 'exotic', en: -2, poll: 2 },
  { id: 'habitat', name: 'Житловий модуль', cost: 1000, inp: {}, out: {}, en: 0, poll: 0, housing: 80 },
];
export const BMAP: Record<string, BuildDef> = Object.fromEntries(BUILD.map(b => [b.id, b]));
const PRODUCER: Record<number, string> = { 0: 'farm', 1: 'water', 2: 'water', 3: 'refinery', 4: 'mine', 5: 'rare', 6: 'fab', 7: 'machine', 8: 'arms', 9: 'pharma', 10: 'luxury', 11: 'lab' };

export interface Colony { pop: number; K: number; stab: number; happy: number; b: Record<string, number>; employ: number; energy: number; pollution: number; native: boolean; foodSat: number; sat: number[]; founded: number }

export interface Planet {
  id: number; name: string; sys: number; parent: number; moons: number[]; tags: string;
  mass: number; radius: number; g: number; density: number; a: number; e: number; inc: number; period: number; phase: number;
  rot: number; tilt: number; teq: number; temp: number; pressure: number; atmo: string; toxic: boolean; weather: string;
  /** виміряна тривісність (0 = куля, 0.28 = сильно витягнутий еліпсоїд) */
  triax?: number;
  hydro: string; hydroCov: number; crust: string; magnet: number; radiation: number; tectonics: string; tidal: number; locked: boolean;
  resonance: string; roche: boolean; res: Res; bio: string; features: string[]; habit: number;
  kind?: 'planet' | 'dwarf' | 'asteroid';   // клас тіла (для Сонячної системи — точний)
  colony: Colony | null; owner: number; stock: number[]; desired: number[];
  infl: number[]; culture: number[]; media: number[]; invest: number[]; imports: number[];
  tariff: number; tariffBy: number; embargo: boolean[]; proxy: number;
}
/** Пояс дрібних тіл: пиловий/астероїдний, пояс Койпера або троянці планети */
export interface Belt {
  a: [number, number];                    // межі великої півосі, а.о.
  kind?: 'ring' | 'main' | 'kuiper' | 'trojan';
  n?: number;                             // скільки точок малювати
  label?: string;
  of?: number;                            // для троянців: id планети-господаря
}
export interface StarSystem {
  id: number; name: string; x: number; y: number;            // галактична площина, св. роки
  starMass: number; lum: number; starClass: string; spec: string;
  real: boolean; distLy: number; giant: boolean; note?: string;
  planets: number[]; piracy: number; belts: Belt[];
}

// ================== ФІЗИКА ФОРМИ ТІЛ ==================
/** «Картопляний радіус» — межа гідростатичної рівноваги (potato radius).
 *  Lineweaver & Norman 2010 (arXiv:1004.1091): камʼяні тіла стають кулястими
 *  приблизно від 300 км радіуса, а слабші крижані — вже від 200 км
 *  (оцінка через висоту Евересту дає ~240 км — arXiv:1511.04297).
 *  Менші тіла тримаються силами міцності матеріалу і мають неправильну,
 *  «картопляну» форму: Фобос (11 км), Амальтея (84 км), Гіперіон (135 км). */
export const POTATO_RADIUS_ROCKY_KM = 300;
export const POTATO_RADIUS_ICY_KM = 200;

/** Крижане тіло? (слабший матеріал → менша межа округлення) */
export function isIcy(p: Planet) {
  return p.tags.includes('C') || p.tags.includes('I') || p.res.vol >= 0.5;
}
export function potatoRadius(p: Planet) { return isIcy(p) ? POTATO_RADIUS_ICY_KM : POTATO_RADIUS_ROCKY_KM; }
/** 0 — ідеальна куля, 1 — максимально «картопляна» форма */
export function irregularity(p: Planet) {
  return clamp(1 - p.radius / potatoRadius(p), 0, 1);
}
export const isIrregular = (p: Planet) => irregularity(p) > 0.15;
/** Місце у космосі: система + планета (p = -1 → сама зоря) */
export type Place = { sys: number; p: number };
export const starPlace = (sys: number): Place => ({ sys, p: -1 });
export const planetPlace = (p: Planet): Place => ({ sys: p.sys, p: p.id });

export interface Faction { id: number; name: string; short: string; color: string; money: number; rp: number; tech: number; explored: boolean[]; persona: string; isPlayer: boolean; alive: boolean }
export type ShipType = 'freighter' | 'heavy' | 'tanker' | 'scout' | 'war';
export interface Ship {
  id: number; owner: number; type: ShipType; name: string;
  at: number; atSys: number; from: number; fromSys: number; to: number; toSys: number;
  t0: number; t1: number; good: number; amt: number; hp: number; cap: number; wait: number;
  route: { a: number; b: number; good: number } | null; profit: number;
}
export function shipPlace(s: Ship, k: 'at' | 'from' | 'to'): Place {
  return { sys: k === 'at' ? s.atSys : k === 'from' ? s.fromSys : s.toSys, p: k === 'at' ? s.at : k === 'from' ? s.from : s.to };
}
/** Двигуни: lyh — годин на світловий рік у надсвітловому стрибку, au — а.о. на добу всередині системи */
export const SHIPDEF: Record<ShipType, { name: string; cost: number; cap: number; speed: number; icon: string; lyh: number; au: number; maint: number }> = {
  freighter: { name: 'Вантажник', cost: 2500, cap: 60, speed: 1, icon: '▲', lyh: 12, au: 0.55, maint: 3 },
  heavy: { name: 'Важкий рудовоз', cost: 6000, cap: 160, speed: 0.7, icon: '■', lyh: 20, au: 0.3, maint: 5 },
  tanker: { name: 'Танкер', cost: 3500, cap: 100, speed: 0.9, icon: '●', lyh: 16, au: 0.45, maint: 4 },
  scout: { name: 'Розвідник', cost: 1500, cap: 0, speed: 2.2, icon: '◆', lyh: 6, au: 1.2, maint: 1.5 },
  war: { name: 'Ескорт-фрегат', cost: 5000, cap: 0, speed: 1.4, icon: '✦', lyh: 8, au: 0.9, maint: 2.5 },
};
/** Швидкість стрибка: годин на світловий рік */
export const hoursPerLy = (t: ShipType) => SHIPDEF[t].lyh;

export interface Game { time: number; day: number; systems: StarSystem[]; planets: Planet[]; factions: Faction[]; ships: Ship[]; log: { d: number; t: string; c: string }[]; nextShip: number; winner: { f: number; how: string } | null }

// ================== GENERATION ==================
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const N = 5; // factions

/** Опис зорі для генерації системи (реальний каталог або вигадана) */
export interface StarSeed {
  name: string; spec: string; mass: number; lum: number; x: number; y: number;
  real: boolean; note?: string; planets?: KnownPlanet[]; belts?: Belt[]; barren?: boolean;
}

/** Клас планети за масою (M⊕) та рівноважною температурою (K) */
function autoTags(mass: number, teq: number): string {
  if (rnd() < 0.002) return 'I';
  if (mass > 40) return 'D';
  if (mass > 10) return 'CD';
  if (mass < 0.09) return 'G';
  if (teq > 520) return pick(['E', 'F', 'B']);
  if (teq > 320) return pick(['B', 'F', 'B', 'E', 'AB']);
  if (teq >= 210) return mass > 0.3 && mass < 3.2 && rnd() < 0.75 ? pick(['A', 'A', 'AB', 'AC', 'AF']) : pick(['B', 'AB']);
  return pick(['C', 'C', 'G', 'B']);
}

function resFor(tags: string): Res {
  const r: Res = { metal: 0.05, rare: 0, vol: 0, org: 0, fuel: 0, exotic: 0, geo: 0 };
  const add = (k: ResKey, v: number) => { r[k] = clamp(r[k] + v * R(0.6, 1.25), 0, 1); };
  for (const ch of tags) {
    if (ch === 'A') { add('org', 0.8); add('metal', 0.4); add('vol', 0.5); }
    if (ch === 'B') { add('metal', 0.7); add('rare', 0.5); }
    if (ch === 'C') { add('vol', 0.9); add('fuel', 0.3); }
    if (ch === 'D') { add('fuel', 0.9); }
    if (ch === 'F') { add('metal', 0.6); add('rare', 0.4); add('geo', 0.9); }
    if (ch === 'E') { add('exotic', 0.8); add('rare', 0.5); }
    if (ch === 'G') { add('metal', 0.5); add('vol', 0.2); }
    if (ch === 'I') { add('exotic', 0.9); add('vol', 0.5); }
  }
  return r;
}

function describe(p: Planet) {
  const t = p.tags.replace('S-', '');
  const has = (c: string) => t.includes(c);
  if (t === 'D') { p.pressure = Infinity; p.atmo = 'H₂ 86%, He 13%, CH₄'; p.crust = 'Металевий водень (ядро)'; p.hydro = 'Немає поверхні'; }
  else if (t === 'CD') { p.pressure = Infinity; p.atmo = 'H₂, He, CH₄, H₂O'; p.crust = 'Водно-аміачна мантія'; p.hydro = 'Надкритичний океан'; }
  else if (has('A')) {
    p.pressure = has('F') ? R(1, 4) : has('C') ? R(1, 3) : has('B') ? R(0.3, 1) : R(0.6, 1.8);
    p.atmo = has('F') ? 'N₂ 70%, CO₂ 18%, O₂ 10%, SO₂' : 'N₂ 76%, O₂ 21%, Ar, CO₂';
    p.crust = 'Силікати'; p.hydro = 'Вода';
    p.hydroCov = has('C') ? 1 : has('B') ? R(0.02, 0.15) : R(0.3, 0.85);
  } else if (has('E')) { p.pressure = R(40, 200); p.atmo = 'H₂SO₄, CO₂, HF, радіоактивні гази'; p.crust = 'Екзотичні сплави'; p.hydro = 'Кислотні моря'; p.hydroCov = R(0, 0.4); }
  else if (has('F')) { p.pressure = p.parent >= 0 ? R(0, 0.001) : R(0.5, 30); p.atmo = 'SO₂, CO₂, S'; p.crust = 'Базальт'; p.hydro = 'Лава'; p.hydroCov = R(0.05, 0.3); }
  else if (has('B')) { p.pressure = p.teq > 330 ? R(1, 90) : R(0.005, 0.5); p.atmo = 'CO₂ 95%, N₂, Ar'; p.crust = 'Базальт'; p.hydro = 'Немає'; }
  else if (has('C')) { p.pressure = R(0, 1.6); p.atmo = p.pressure > 0.1 ? 'N₂, CH₄, NH₃' : 'Слід O₂/H₂O'; p.crust = 'Лід / силікати'; p.hydro = p.tidal > 0.01 ? 'Підльодовий океан H₂O' : p.pressure > 0.5 ? 'Метанові озера' : 'Лід'; p.hydroCov = R(0.6, 1); }
  else if (has('I')) { p.pressure = 0; p.atmo = 'Замерзла'; p.crust = 'Лід / пил'; p.hydro = 'Лід'; }
  else { p.pressure = R(0, 0.01); p.atmo = 'Майже вакуум'; p.crust = has('G') ? 'Силікати / лід' : 'Силікати'; p.hydro = 'Немає'; }
  p.toxic = !has('A');
  const pr = isFinite(p.pressure) ? p.pressure : 100;
  p.temp = Math.round(p.teq * (1 + 0.12 * Math.log10(1 + pr * 3)) + p.tidal * 40);
  p.weather = !isFinite(p.pressure) ? 'Суперштормові пояси' : pr > 30 ? 'Кислотні урагани' : pr > 0.5 ? pick(['Помірна', 'Мусони', 'Пилові бурі', 'Грози']) : 'Відсутня';
  p.magnet = t.includes('D') ? R(5, 20) : R(0, 1.5) * Math.min(1, p.mass);
  p.radiation = clamp((t.includes('D') ? 0.3 : 0) + (p.parent >= 0 ? 0.3 : 0) + 0.6 - p.magnet * 0.4 + (has('E') ? 0.6 : 0), 0, 1);
  p.tectonics = has('F') || p.tidal > 0.3 ? 'Екстремальний вулканізм' : has('A') ? 'Активна тектоніка плит' : p.mass > 0.3 ? 'Слабка' : 'Мертва';
  let h = 0;
  if (has('A')) h = 0.8; if (has('A') && has('B')) h = 0.5; if (has('A') && has('C')) h = 0.6; if (has('A') && has('F')) h = 0.4;
  if (!has('A')) h = has('B') ? 0.15 : has('C') ? 0.18 : has('F') ? 0.08 : has('E') ? 0.03 : has('G') ? 0.1 : has('I') ? 0.01 : has('D') ? 0 : 0.08;
  if (t.includes('D')) h = 0;
  h *= clamp(1 - Math.abs(p.temp - 288) / 400, 0.2, 1);
  p.habit = Math.round(h * 100) / 100;
  if (has('A') && rnd() < 0.7) p.bio = pick(['Мікробна', 'Рослинна', 'Складна фауна', 'Небезпечна мегафауна']);
  else if (has('C') && p.tidal > 0.01 && rnd() < 0.3) p.bio = 'Хемосинтетична (підльодова)'; else p.bio = 'Немає';
  const fs = ['Руїни Предтеч', 'Гравітаційна аномалія', 'Кільця', 'Глибокі каньйони', 'Кристалічні поля', 'Магнітні бурі', 'Старий уламок корабля'];
  if (rnd() < 0.3) p.features.push(pick(fs));
  if (rnd() < 0.08) p.features.push(pick(fs));
}

function mkPlanet(id: number, sys: number, parent: number): Planet {
  return {
    id, name: '', sys, parent, moons: [], tags: '', mass: 1, radius: 6371, g: 1, density: 5.5, a: 1, e: 0, inc: 0, period: 365, phase: rnd() * Math.PI * 2,
    rot: 24, tilt: 0, teq: 288, temp: 288, pressure: 1, atmo: '', toxic: false, weather: '', hydro: '', hydroCov: 0, crust: '', magnet: 1, radiation: 0,
    tectonics: '', tidal: 0, locked: false, resonance: '', roche: false, res: resFor(''), bio: 'Немає', features: [], habit: 0,
    colony: null, owner: -1, stock: new Array(12).fill(0), desired: new Array(12).fill(0),
    infl: new Array(N).fill(0), culture: new Array(N).fill(0), media: new Array(N).fill(0), invest: new Array(N).fill(0), imports: new Array(N).fill(0),
    tariff: 0, tariffBy: -1, embargo: new Array(N).fill(false), proxy: -1,
  };
}

function addPlanet(g: Game, s: StarSystem, a: number, e: number, mass: number, name: string, tags?: string, teq?: number): Planet {
  const p = mkPlanet(g.planets.length, s.id, -1); g.planets.push(p); s.planets.push(p.id);
  p.name = name; p.a = a; p.e = e; p.inc = R(0, 6); p.mass = mass;
  p.teq = teq ?? Math.round(278 * Math.pow(s.lum, 0.25) / Math.sqrt(a));
  p.period = 365.25 * Math.sqrt((a * a * a) / s.starMass);
  p.tags = tags ?? autoTags(mass, p.teq);
  const gas = p.tags.includes('D');
  p.radius = gas ? 69911 * clamp(Math.pow(p.mass / 318, 0.12), 0.35, 1.05) : 6371 * Math.pow(p.mass, 0.27);
  p.rot = gas ? R(9, 17) : R(10, 60); p.tilt = R(0, 35);
  if (p.a < 0.25) { p.locked = true; p.rot = p.period * 24; }
  p.res = resFor(p.tags);
  // супутники: газові гіганти мають великі регулярні + хмару дрібних астероїдних
  const nm = gas ? (rnd() < 0.07 ? 0 : Math.floor(2 + Math.pow(rnd(), 2.2) * 34)) : (p.mass > 0.3 && rnd() < 0.4 ? 1 : 0);
  // дрібні захоплені супутники (як Фобос і Деймос у Марса або Дактиль в Іди):
  // кількакілометрові «картоплини» на випадкових орбітах
  if (!gas && p.mass > 0.02 && p.a > 0.2 && rnd() < 0.42) {
    const cnt = rnd() < 0.3 ? 2 : 1;
    for (let j = 0; j < cnt; j++) {
      makeMoon(g, p, p.radius * R(3.2, 14), Math.pow(10, R(-11, -8)), 0,
        `${p.name}${'abcdefgh'[j]}`, R(0.001, 0.08), R(0, 45));
    }
  }
  if (nm > 0) {
    const regular = Math.min(nm, gas ? 2 + Math.floor(rnd() * 4) : 1);
    let ma = gas ? R(180000, 420000) : R(150000, 380000);
    for (let j = 0; j < regular; j++) {
      makeMoon(g, p, ma, R(0.001, 0.03), 0, `${p.name}${'abcdefgh'[j]}`, R(0.0005, 0.008), R(0, 3));
      ma *= R(1.4, 2.2);
    }
    if (nm > regular) {
      const aMin = ma * 1.4, aMax = aMin * R(1.8, 5);
      for (let j = regular; j < nm; j++) {
        const t = (j - regular) / Math.max(1, nm - regular);
        makeMoon(g, p, aMin + (aMax - aMin) * t, Math.pow(10, R(-8, -3.6)), 0, `${p.name}-${(1000 + j).toString(36).toUpperCase()}`, R(0.02, 0.35), R(0, 175));
      }
    }
    finalizeMoons(g, p);
  }
  describe(p);
  p.g = p.mass / (p.radius / 6371) ** 2; p.density = 5.51 * p.mass / (p.radius / 6371) ** 3;
  return p;
}

/** Зоря без планет: лишається тільки пиловий/астероїдний пояс */
function beltOnly(s: StarSystem) {
  const snow = 2.7 * Math.sqrt(s.lum);
  const r0 = Math.max(0.05, snow * R(0.8, 3));
  s.belts.push({ a: [r0, r0 * R(1.6, 3.2)], kind: 'ring' });
}

/** Генерація планетної системи навколо заданої зорі */
function genSystem(g: Game, id: number, seed: StarSeed): StarSystem {
  const s: StarSystem = {
    id, name: seed.name, x: seed.x, y: seed.y, starMass: seed.mass, lum: seed.lum,
    starClass: seed.spec[0].toUpperCase(), spec: seed.spec, real: seed.real,
    distLy: Math.hypot(seed.x, seed.y), giant: /III|IV|II\b/.test(seed.spec), note: seed.note,
    planets: [], piracy: R(0, 0.6), belts: seed.belts ? seed.belts.map(b => ({ ...b, a: [b.a[0], b.a[1]] as [number, number] })) : [],
  };
  g.systems.push(s);
  const snow = 2.7 * Math.sqrt(s.lum);
  if (seed.planets) {
    for (const kp of seed.planets) addPlanet(g, s, kp.a, kp.e, kp.mass, kp.n, kp.tags);
  } else if (!seed.barren) {
    const n = Math.max(0, Math.round(R(1, 8) - (s.giant ? 2 : 0)));
    let a = snow * R(0.12, 0.34);
    for (let i = 0; i < n; i++) {
      if (i > 0) a *= R(1.4, 1.9);
      const teq = Math.round((278 * Math.pow(s.lum, 0.25)) / Math.sqrt(a));
      const mass = a > snow ? (rnd() < 0.55 ? R(10, 320) : R(0.05, 2.5)) : (rnd() < 0.12 ? R(0.01, 0.08) : R(0.1, 4.5));
      addPlanet(g, s, a, R(0, 0.12), mass, `${s.name} ${ROMAN[i]}`, undefined, teq);
    }
  }
  // --- пояси дрібних тіл: аналоги головного поясу астероїдів і поясу Койпера ---
  if (!seed.belts) {
    const as = s.planets.map(id => g.planets[id].a);
    // пояс у проміжку між двома планетами, якщо він досить широкий
    for (let i = 0; i + 1 < as.length; i++) {
      if (as[i + 1] / as[i] > 1.85 && rnd() < 0.45) {
        s.belts.push({ a: [as[i] * 1.3, as[i + 1] * 0.78], kind: 'main', n: 200, label: 'пояс астероїдів' });
      }
    }
    // далекий крижаний пояс за найзовнішою планетою
    const last = as.length ? Math.max(...as) : 0.4;
    if (last > 0.12 && rnd() < 0.7) {
      s.belts.push({ a: [last * 1.7, last * 3.4], kind: 'kuiper', n: 240, label: 'пояс Койпера' });
    }
  } else if (s.planets.length && rnd() < 0.4) {
    // у реальних систем із каталогу іноді додаємо далекий пояс
    const last = Math.max(...s.planets.map(id => g.planets[id].a));
    if (last > 0.3) s.belts.push({ a: [last * 1.8, last * 3.6], kind: 'kuiper', n: 180, label: 'далекий пояс' });
  }
  // --- карликові планети в поясах (як Церера й Плутон) ---
  for (const belt of s.belts) {
    if (rnd() > 0.5) continue;
    const cnt = 1 + (rnd() < 0.4 ? 1 : 0);
    for (let k = 0; k < cnt; k++) {
      const a = belt.a[0] + (belt.a[1] - belt.a[0]) * R(0.2, 0.8);
      const p = mkPlanet(g.planets.length, s.id, -1); g.planets.push(p); s.planets.push(p.id);
      p.name = `${s.name} ${ROMAN[s.planets.length - 1]}`;
      p.a = a; p.e = R(0.02, 0.22); p.inc = R(0, 25);
      p.mass = R(1e-4, 4e-3);
      p.period = 365.25 * Math.sqrt((a * a * a) / s.starMass);
      p.teq = Math.round(278 * Math.pow(s.lum, 0.25) / Math.sqrt(a));
      p.tags = autoTags(p.mass, p.teq);
      p.radius = 6371 * Math.pow(p.mass, 0.27);
      p.kind = p.radius < 2400 ? 'dwarf' : 'planet';   // маленькі — карликові
      p.rot = R(6, 40); p.tilt = R(0, 30);
      p.res = resFor(p.tags);
      describe(p);
      p.g = p.mass / (p.radius / 6371) ** 2; p.density = 5.51 * p.mass / (p.radius / 6371) ** 3;
    }
  }
  if (!s.planets.length && !s.belts.length) beltOnly(s);
  return s;
}

/** Вигадана зоря з реальним розподілом мас (більшість — червоні карлики) */
function randomStar(x: number, y: number): StarSeed {
  const r = rnd();
  let mass: number, spec: string;
  if (r < 0.6) { mass = R(0.08, 0.45); spec = `${mass < 0.2 ? 'M5' : mass < 0.32 ? 'M3' : 'M1'}V`; }
  else if (r < 0.8) { mass = R(0.45, 0.8); spec = `K${Math.round(R(0, 7))}V`; }
  else if (r < 0.91) { mass = R(0.8, 1.1); spec = `G${Math.round(R(0, 9))}V`; }
  else if (r < 0.97) { mass = R(1.1, 1.6); spec = `F${Math.round(R(0, 9))}V`; }
  else { mass = R(1.6, 2.6); spec = `A${Math.round(R(0, 7))}V`; }
  const name = rnd() < 0.78 ? `${pick(CATALOG_PREFIX)} ${Math.floor(R(120, 1800))}` : pick(RANDOM_NAMES);
  return { name, spec, mass, lum: Math.pow(mass, 3.5), x, y, real: false };
}

function addColony(g: Game, p: Planet, owner: number, pop: number, b: Record<string, number>, native: boolean) {
  p.colony = { pop, K: pop * 1.3, stab: 60, happy: 55, b: { ...b }, employ: 1, energy: 1, pollution: 0, native, foodSat: 1, sat: new Array(12).fill(1), founded: g.day };
  p.owner = owner;
  for (let i = 0; i < 12; i++) p.stock[i] = 20 + CONS[i] * pop * 10;
}

export const FACTION_DEF = [
  { name: 'Федерація', short: 'Федерація', color: '#38d9ff', persona: 'гравець' },
  { name: 'Гільдія Меркатор', short: 'Меркатор', color: '#ffc843', persona: 'торговці' },
  { name: 'Консорціум Ферра', short: 'Ферра', color: '#ff6b4a', persona: 'промисловці' },
  { name: 'Союз Тарк', short: 'Тарк', color: '#c77dff', persona: 'мілітаристи' },
  { name: 'Колектив Зеніт', short: 'Зеніт', color: '#6cf08f', persona: 'дослідники' },
];

export function newGame(s: number): Game {
  setSeed(s);
  const g: Game = { time: 0, day: 0, systems: [], planets: [], factions: [], ships: [], log: [], nextShip: 1, winner: null };
  // --- 1. Зорі: Сонце + реальний каталог + вигадані системи, що заповнюють простір ---
  const seeds: StarSeed[] = [{ name: 'Сонце', spec: 'G2V', mass: 1, lum: 1, x: 0, y: 0, real: true, note: 'жовтий карлик, батьківщина Землі' }];
  for (const d of REAL_STARS) {
    const [x, y] = galXY(d.ra, d.dec, d.d);
    seeds.push({ name: d.name, spec: d.spec, mass: d.mass, lum: d.lum, x, y, real: true, note: d.note, planets: d.planets, belts: d.belts, barren: d.barren });
  }
  for (let i = 0; i < 26; i++) {
    let px = 0, py = 0, ok = false;
    for (let tries = 0; tries < 200 && !ok; tries++) {
      const ang = rnd() * Math.PI * 2, r = 9 + 111 * Math.sqrt(rnd());
      px = r * Math.cos(ang); py = r * Math.sin(ang);
      ok = seeds.every(q => Math.hypot(q.x - px, q.y - py) > 3.4);
    }
    if (ok) seeds.push(randomStar(px, py));
  }
  seeds.forEach((sd, i) => (i === 0 ? genSolar(g, i, sd.x, sd.y) : genSystem(g, i, sd)));
  const NS = g.systems.length;
  FACTION_DEF.forEach((d, i) => g.factions.push({ id: i, ...d, money: 20000, rp: 0, tech: 0, explored: new Array(NS).fill(false), isPlayer: i === 0, alive: true }));
  // Довідники: зорі в радіусі 12 св. років уже каталогізовані всіма фракціями
  for (const sy of g.systems) if (sy.distLy <= 12) for (const f of g.factions) f.explored[sy.id] = true;
  // --- 2. Домашні системи: розкидані якомога далі одна від одної ---
  const homes: number[] = [0];
  const withPlanets = g.systems.filter(sy => sy.planets.length > 0 && sy.id !== 0);
  while (homes.length < N && withPlanets.length >= homes.length) {
    let best = -1, bd = -1;
    for (const s of withPlanets) {
      if (homes.includes(s.id)) continue;
      const d = Math.min(...homes.map(h => Math.hypot(g.systems[h].x - s.x, g.systems[h].y - s.y)));
      if (d > bd) { bd = d; best = s.id; }
    }
    if (best < 0) break;
    homes.push(best);
  }
  homes.forEach((sid, f) => {
    const s = g.systems[sid]; s.piracy = 0.05;
    let p = s.planets.map(id => g.planets[id]).find(q => (f === 0 ? q.name === 'Земля' : q.tags === 'A' && q.radius > 900));
    if (!p) {
      p = s.planets.map(id => g.planets[id]).sort((a, b) => Math.abs(a.teq - 288) - Math.abs(b.teq - 288))[0];
      p.tags = 'A'; p.mass = R(0.7, 1.4); p.radius = 6371 * Math.pow(p.mass, 0.27); p.g = p.mass / (p.radius / 6371) ** 2; p.density = 5.51 * p.mass / (p.radius / 6371) ** 3;
      p.teq = 270; p.res = resFor('A'); p.features = []; describe(p);
    }
    p.res.metal = Math.max(p.res.metal, 0.5); p.res.fuel = Math.max(p.res.fuel, 0.3); p.res.rare = Math.max(p.res.rare, 0.3);
    p.habit = Math.max(p.habit, 0.75);
    addColony(g, p, f, 150, { farm: 4, water: 3, mine: 3, rare: 1, solar: 3, reactor: 1, refinery: 2, fab: 1, habitat: 3, pharma: 1, lab: 1 }, false);
    g.factions[f].explored[sid] = true;
    for (const t of ['freighter', 'freighter', 'freighter', 'scout'] as ShipType[]) spawnShip(g, f, t, p.id);
  });
  // --- 3. Незалежні цивілізації ---
  const cands = g.planets.filter(p => p.tags.startsWith('A') && !p.colony && p.radius > 900);
  const others = g.planets.filter(p => !p.colony && p.radius > 700 && (p.tags === 'B' || p.tags === 'S-C' || p.tags === 'F' || p.tags === 'C'));
  const natives = [...cands.sort(() => rnd() - 0.5).slice(0, 10), ...others.sort(() => rnd() - 0.5).slice(0, 6)];
  for (const p of natives) {
    const pop = p.tags.startsWith('A') ? R(60, 700) : R(15, 80);
    const b: Record<string, number> = { farm: Math.ceil(pop / 130), water: Math.ceil(pop / 160), solar: 2 + Math.ceil(pop / 100), habitat: Math.ceil(pop / 80) };
    const pool = ['mine', 'rare', 'refinery', 'fab', 'pharma', 'luxury', 'machine', 'arms', 'lab'];
    for (let k = 0; k < 2 + Math.floor(pop / 200); k++) { const id = pick(pool); b[id] = (b[id] || 0) + 1 + Math.floor(pop / 300); }
    if (!p.tags.startsWith('A')) { b.farm = 0; }
    addColony(g, p, -1, pop, b, true);
  }
  log(g, 'Ласкаво просимо, CEO. Досліджуйте галактику, колонізуйте світи й підкорюйте ринки.', '#38d9ff');
  log(g, `🗺 Карта околиць Сонця: ${NS} зір у межах ~120 св. років. Масштаб — світлові роки, польоти між зорями тривають добами.`, '#9fb3c8');
  return g;
}

export function log(g: Game, t: string, c = '#9fb3c8') { g.log.unshift({ d: g.day, t, c }); if (g.log.length > 80) g.log.pop(); }

export function spawnShip(g: Game, f: number, type: ShipType, at: number) {
  const d = SHIPDEF[type];
  const sys = at >= 0 ? g.planets[at].sys : 0;
  const s: Ship = {
    id: g.nextShip++, owner: f, type, name: `${d.name} ${g.factions[f].short}-${g.nextShip}`,
    at, atSys: sys, from: at, fromSys: sys, to: at, toSys: sys,
    t0: g.time, t1: g.time, good: -1, amt: 0, hp: 100, cap: d.cap, wait: 0, route: null, profit: 0,
  };
  g.ships.push(s); return s;
}

// ================== ECONOMY ==================
export function price(p: Planet, i: number) {
  const b = BASE[i];
  const v = b * Math.pow((p.desired[i] + 5) / (p.stock[i] + 5), 0.7);
  return clamp(v, b * 0.3, b * 6);
}
export function markets(g: Game) { return g.planets.filter(p => p.colony); }
export function orbitA(g: Game, p: Planet) { return p.parent >= 0 ? g.planets[p.parent].a : p.a; }
/** Відстань між зорями у світлових роках (галактична площина) */
export function sysDist(g: Game, a: number, b: number) { const s = g.systems[a], t = g.systems[b]; return Math.hypot(s.x - t.x, s.y - t.y); }
const AU_KM = 149597870.7;

/** Положення тіла на орбіті у а.о. відносно зорі (розв'язок рівняння Кеплера) */
export function orbitPosAU(p: Planet, time: number): [number, number] {
  const e = p.e;
  const M = p.phase + (2 * Math.PI * time) / Math.max(0.01, p.period);
  let E = M;
  for (let i = 0; i < 4; i++) E = M + e * Math.sin(E);
  const a = p.a, b = a * Math.sqrt(Math.max(0, 1 - e * e));
  return [a * (Math.cos(E) - e), b * Math.sin(E)];
}
/** Абсолютна позиція місця у а.о. (зоря = 0,0); супутники — від батьківської планети */
export function placeAU(g: Game, pl: Place, time: number): [number, number] {
  if (pl.p < 0) return [0, 0];
  const p = g.planets[pl.p];
  if (p.parent < 0) return orbitPosAU(p, time);
  const [px, py] = orbitPosAU(g.planets[p.parent], time);
  const ang = p.phase + (2 * Math.PI * time) / Math.max(0.01, p.period);
  const r = p.a / AU_KM;
  return [px + r * Math.cos(ang), py + r * Math.sin(ang)];
}
export function placeName(g: Game, pl: Place) { return pl.p < 0 ? `зоря ${g.systems[pl.sys].name}` : g.planets[pl.p].name; }
export function placePlanet(g: Game, pl: Place) { return pl.p >= 0 ? g.planets[pl.p] : null; }
/** Скільки діб триває переліт: усередині системи — за а.о./добу, між зорями — за год/св. рік */
export function travelDays(g: Game, from: Place, to: Place, type: ShipType, time = g.time): number {
  const d = SHIPDEF[type];
  if (from.sys === to.sys) {
    const [ax, ay] = placeAU(g, from, time), [bx, by] = placeAU(g, to, time);
    return Math.max(0.2, Math.hypot(ax - bx, ay - by) / d.au + 0.15);
  }
  return Math.max(0.5, (sysDist(g, from.sys, to.sys) * d.lyh) / 24);
}
export function warships(g: Game, f: number, sys: number) { return g.ships.filter(s => s.type === 'war' && s.owner === f && s.t1 <= g.time && s.atSys === sys).length; }
export function tariffFor(p: Planet, f: number) { return p.tariffBy >= 0 && p.tariffBy !== f ? p.tariff : 0; }

export function level(g: Game, p: Planet, f: number) {
  if (p.owner === f) return 6;
  if (!g.factions[f].explored[p.sys] || !p.colony) return 0;
  if (p.owner >= 0) return 1;
  if (p.proxy === f) return 5;
  const v = p.infl[f];
  return v >= 60 ? 5 : v >= 45 ? 4 : v >= 30 ? 3 : v >= 15 ? 2 : 1;
}
export const LEVEL_NAME = ['Немає контакту', 'Торговий контакт', 'Торговий партнер', 'Залежність', 'Сателіт', 'Проксі', 'Анексія'];
export function colonyLevel(c: Colony) { return c.pop < 1 ? 'Аванпост' : c.pop < 20 ? 'Поселення' : c.pop < 150 ? 'Колонія' : c.pop < 600 ? 'Місто' : 'Мегаполіс / Аркологія'; }
export function tradeDep(p: Planet, f: number) { const t = p.imports.reduce((a, b) => a + b, 0); return t > 0 ? p.imports[f] / t : 0; }

function colonyTick(g: Game, p: Planet) {
  const c = p.colony!; const st = p.stock;
  const desired = new Array(12).fill(0);
  const tech = p.owner >= 0 ? 1 + 0.06 * g.factions[p.owner].tech : 1;
  let supply = 2, use = 0, nb = 0, poll = 0, housing = 0;
  for (const [id, n] of Object.entries(c.b)) {
    const d = BMAP[id]; if (!n) continue;
    if (d.en > 0) { const rm = d.res ? clamp(p.res[d.res] * 1.2, 0, 1) : 1; let ok = 1; for (const [k, v] of Object.entries(d.inp)) ok = Math.min(ok, st[+k] / (v * n + 0.001)); supply += d.en * n * rm * clamp(ok, 0, 1) * (id === 'solar' ? clamp(1.4 - orbitA(g, p) * 0.3, 0.3, 1.4) : 1); }
    else use -= d.en * n;
    if (!d.housing) nb += n; poll += d.poll * n; housing += (d.housing || 0) * n;
  }
  const ef = use > 0 ? clamp(supply / use, 0, 1) : 1;
  c.energy = use > 0 ? supply / use : 1;
  const workers = c.pop * 0.6, jobs = nb * 0.5;
  const wf = jobs > 0 ? clamp(workers / jobs, 0, 1) : 1;
  c.employ = workers > 0 ? clamp(jobs / workers, 0, 1) : 1;
  const sm = c.stab > 70 ? 1.2 : c.stab < 30 ? 0.6 : 1;
  for (const [id, n] of Object.entries(c.b)) {
    const d = BMAP[id]; if (!n || d.housing) continue;
    let eff = n * wf * (d.en < 0 ? ef : 1) * sm * tech;
    if (d.res) eff *= id === 'farm' ? clamp(0.25 + p.res.org + p.habit * 0.3, 0, 1.3) : clamp(0.15 + p.res[d.res], 0, 1.2);
    for (const [k, v] of Object.entries(d.inp)) { eff = Math.min(eff, st[+k] / v); desired[+k] += v * n * 12; }
    eff = Math.max(0, eff);
    for (const [k, v] of Object.entries(d.inp)) st[+k] -= v * eff;
    for (const [k, v] of Object.entries(d.out)) st[+k] += v * eff;
  }
  const sat = new Array(12).fill(1);
  for (let i = 0; i < 12; i++) {
    let need = CONS[i] * c.pop; if (i === 2) need *= 1.5 - p.habit;
    if (need <= 0) continue;
    sat[i] = clamp(st[i] / need, 0, 1); st[i] = Math.max(0, st[i] - need); desired[i] += need * 15;
  }
  for (let i = 0; i < 12; i++) { desired[i] += 5; st[i] = Math.min(st[i], desired[i] * 5 + 300); p.desired[i] = desired[i]; }
  c.sat = sat;
  c.foodSat = Math.min(sat[0], sat[1], p.habit < 0.5 ? sat[2] : 1);
  c.pollution = clamp(poll / (1 + c.pop / 150) , 0, 100);
  c.happy = clamp(30 + sat[9] * 20 + sat[10] * 15 + sat[6] * 10 + sat[7] * 5 + c.foodSat * 20 - c.pollution * 0.3 - tariffFor(p, -2) * 30, 0, 100);
  const enemy = p.owner >= 0 ? 0 : Math.max(...p.infl) * 0.1;
  const shortage = sat.slice(0, 3).filter(s => s < 0.6).length;
  const target = clamp(c.happy * 0.45 + c.employ * 20 + c.foodSat * 25 + (1 - g.systems[p.sys].piracy) * 10 - shortage * 8 - c.pollution * 0.15 - enemy - p.tariff * 30, 0, 100);
  c.stab += (target - c.stab) * 0.1;
  if (!c.native) c.K = (12 + housing) * (0.35 + p.habit) * (0.8 + tech * 0.2);
  else c.K = Math.max(c.K, c.pop);
  if (c.foodSat < 0.5) c.pop *= 0.993;
  else c.pop += 0.006 * c.pop * (1 - c.pop / c.K) * c.foodSat + (c.native ? 0 : 0.02 * (c.stab > 50 ? 1 : 0));
  if (c.pop > c.K) c.pop -= (c.pop - c.K) * 0.02; // emigration
  c.pop = Math.max(0.1, c.pop);
  if (p.owner >= 0) {
    const f = g.factions[p.owner];
    f.money += c.pop * 0.25 * (c.stab / 100);
    const sci = Math.min(st[11], 20); st[11] -= sci; f.rp += sci + c.pop * 0.005;
    f.tech = Math.floor(Math.sqrt(f.rp / 150));
  }
  if (c.stab < 30 && rnd() < 0.05) { g.systems[p.sys].piracy = clamp(g.systems[p.sys].piracy + 0.05, 0, 1); if (p.owner === 0) log(g, `⚠ Страйки й бунти на ${p.name}!`, '#ff8a65'); }
}

function influenceTick(g: Game, p: Planet) {
  if (!p.colony || p.owner >= 0) return;
  const tot = p.imports.reduce((a, b) => a + b, 0);
  for (let f = 0; f < N; f++) {
    if (!g.factions[f].explored[p.sys]) { p.infl[f] *= 0.98; continue; }
    const trade = tot > 0 ? p.imports[f] / tot : 0;
    if (trade > 0.2) p.culture[f] = Math.min(100, p.culture[f] + 0.15 * trade);
    const mil = clamp(warships(g, f, p.sys) / 3, 0, 1);
    const rival = Math.max(...p.infl.filter((_, k) => k !== f));
    const disc = p.tariffBy === f ? p.tariff * 40 : 0;
    let target = 100 * (0.4 * trade + 0.2 * p.culture[f] / 100 + 0.2 * mil + 0.1 * p.media[f] / 100 + 0.1 * p.invest[f] / 100) - rival * 0.25 - disc - (100 - p.colony.stab) * 0.05;
    if (p.proxy === f) target = Math.max(target, 65);
    p.infl[f] += (clamp(target, 0, 100) - p.infl[f]) * 0.04;
    p.media[f] *= 0.995; p.invest[f] *= 0.999;
  }
  for (let f = 0; f < N; f++) p.imports[f] *= 0.97;
  if (p.tariffBy >= 0 && level(g, p, p.tariffBy) < 3) { p.tariffBy = -1; p.tariff = 0; p.embargo.fill(false); }
}

// ================== SHIPS ==================
/** Максимальний радіус автопошуку ринків у світлових роках */
const TRADE_LY = 24, REPOSITION_LY = 15;

/** Призначити курс. to.p = -1 означає саму зорю (системи без планет) */
export function setCourse(g: Game, s: Ship, to: Place) {
  const from: Place = shipPlace(s, 'at');
  if (from.sys === to.sys && from.p === to.p) return;
  s.from = from.p; s.fromSys = from.sys; s.to = to.p; s.toSys = to.sys;
  s.t0 = g.time; s.t1 = g.time + travelDays(g, from, to, s.type);
  if (s.type !== 'scout' && s.type !== 'war') g.factions[s.owner].money -= (s.t1 - s.t0) * SHIPDEF[s.type].maint;
}
export function shipProgress(g: Game, s: Ship, time = g.time) {
  return s.t1 > s.t0 ? clamp((time - s.t0) / (s.t1 - s.t0), 0, 1) : 1;
}
/** Скільки діб лишилось до прибуття */
export function eta(g: Game, s: Ship) { return Math.max(0, s.t1 - g.time); }

function buy(g: Game, s: Ship, p: Planet, i: number, amt: number) {
  const f = g.factions[s.owner];
  const pr = price(p, i) * 1.04;
  amt = Math.floor(Math.min(amt, p.stock[i] * 0.6, s.cap));
  if (p.owner !== s.owner) amt = Math.min(amt, Math.floor(f.money / pr));
  if (amt <= 0) return false;
  p.stock[i] -= amt;
  if (p.owner !== s.owner) { f.money -= pr * amt; s.profit -= pr * amt; if (p.owner >= 0) g.factions[p.owner].money += pr * amt; }
  s.good = i; s.amt = amt; return true;
}
function sell(g: Game, s: Ship, p: Planet) {
  if (s.amt <= 0 || !p.colony) return;
  if (p.embargo[s.owner]) return;
  const f = g.factions[s.owner];
  const pr = price(p, s.good) * 0.96; const val = pr * s.amt;
  const tar = tariffFor(p, s.owner);
  p.stock[s.good] += s.amt;
  if (p.owner !== s.owner) {
    f.money += val * (1 - tar); s.profit += val * (1 - tar);
    if (tar > 0) g.factions[p.tariffBy].money += val * tar;
    if (p.owner >= 0) g.factions[p.owner].money -= val * 0.5; // other faction buyer pays partially (state subsidised)
    else p.imports[s.owner] += val;
  }
  s.amt = 0; s.good = -1;
}

function decide(g: Game, s: Ship) {
  const f = g.factions[s.owner];
  const here: Place = shipPlace(s, 'at');
  const p = placePlanet(g, here);
  if (s.type === 'war') return;
  if (s.type === 'scout') {
    let best = -1, bd = 1e9;
    for (const sy of g.systems) { if (f.explored[sy.id]) continue; const d = sysDist(g, here.sys, sy.id); if (d < bd) { bd = d; best = sy.id; } }
    if (best >= 0) {
      const sy = g.systems[best];
      setCourse(g, s, sy.planets.length > 0 ? planetPlace(g.planets[pick(sy.planets)]) : starPlace(sy.id));
    } else {
      // усе досліджено — патрулювати власні володіння
      const own = g.planets.filter(q => q.owner === s.owner);
      if (own.length) setCourse(g, s, planetPlace(pick(own))); else s.wait = g.time + 60;
    }
    return;
  }
  if (s.route) {
    const r = s.route;
    if (here.p === r.a) { if (p && p.colony) buy(g, s, p, r.good, s.cap); setCourse(g, s, planetPlace(g.planets[r.b])); }
    else setCourse(g, s, planetPlace(g.planets[r.a]));
    return;
  }
  if (!p || !p.colony) {
    const home = g.planets.find(q => q.owner === s.owner) || g.planets.find(q => q.colony);
    if (home) setCourse(g, s, planetPlace(home));
    else s.wait = g.time + 10;
    return;
  }
  let best: { q: Planet; i: number; amt: number; sc: number } | null = null;
  const goods = s.type === 'tanker' ? [1, 2, 3] : s.type === 'heavy' ? [4, 5, 0, 1, 3, 7] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  for (const q of g.planets) {
    if (!q.colony || q.id === p.id || !f.explored[q.sys] || q.embargo[s.owner] || p.embargo[s.owner]) continue;
    if (q.sys !== p.sys && sysDist(g, p.sys, q.sys) > TRADE_LY) continue;
    const d = travelDays(g, here, planetPlace(q), s.type);
    const tar = tariffFor(q, s.owner);
    for (const i of goods) {
      const bp = price(p, i) * 1.04, sp = price(q, i) * 0.96 * (1 - tar);
      if (sp <= bp) continue;
      let amt = Math.min(s.cap, p.stock[i] * 0.6, Math.max(0, q.desired[i] * 1.2 - q.stock[i]));
      if (p.owner !== s.owner) amt = Math.min(amt, f.money / bp);
      if (amt < 5) continue;
      const bonus = q.owner < 0 && f.isPlayer === false && f.persona === 'торговці' ? 1.2 : 1;
      const sc = ((sp - bp) * amt * bonus - d * SHIPDEF[s.type].maint * 2) / (d + 1);
      if (sc > 0 && (!best || sc > best.sc)) best = { q, i, amt, sc };
    }
  }
  if (best && buy(g, s, p, best.i, best.amt)) { setCourse(g, s, planetPlace(best.q)); return; }
  // перепозиціювання на сусідній ринок
  const opts = g.planets.filter(q => q.colony && q.id !== p.id && f.explored[q.sys] && (q.sys === p.sys || sysDist(g, p.sys, q.sys) < REPOSITION_LY));
  if (opts.length && rnd() < 0.6) setCourse(g, s, planetPlace(pick(opts))); else s.wait = g.time + 2;
}

export function updateShips(g: Game) {
  for (const s of g.ships) {
    if (s.t1 > g.time) continue;
    if (s.to !== s.at || s.toSys !== s.atSys) {
      s.at = s.to; s.atSys = s.toSys;
      const place: Place = shipPlace(s, 'at');
      const f = g.factions[s.owner];
      if (!f.explored[place.sys]) {
        f.explored[place.sys] = true;
        const sy = g.systems[place.sys];
        if (f.isPlayer) log(g, sy.planets.length
          ? `🔭 Розвідник дослідив ${sy.name}: ${sy.planets.length} планет, зоря класу ${sy.spec}.`
          : `🔭 Розвідник дослідив ${sy.name}: планет немає, лише пиловий пояс.`, '#7fe0ff');
      }
      const pl = placePlanet(g, place);
      if (pl) sell(g, s, pl);
    }
    if (s.wait > g.time) continue;
    decide(g, s);
    // якщо рішення не змінило курс — не крутимо ШІ щокадру
    if (s.t1 <= g.time && s.wait <= g.time) s.wait = g.time + 0.5;
  }
}

function piracyTick(g: Game) {
  for (const s of [...g.ships]) {
    if (s.t1 <= g.time || s.amt <= 0) continue;
    const sys = s.toSys, sys2 = s.fromSys;
    const cross = sys !== sys2;
    const pir = Math.max(g.systems[sys].piracy, g.systems[sys2].piracy) * (cross ? 1.6 : 1);
    const prot = clamp((warships(g, s.owner, sys) + warships(g, s.owner, sys2)) / 2, 0, 1);
    const rate = cross ? 0.004 : 0.025; // далекі стрибки патрулювати важче, але й піратів там менше
    if (rnd() < pir * rate * (1 - prot * 0.85)) {
      s.amt = 0; s.good = -1; s.hp -= R(12, 30);
      if (s.hp <= 0) { g.ships.splice(g.ships.indexOf(s), 1); if (s.owner === 0) log(g, `☠ Пірати знищили ${s.name}!`, '#ff5252'); }
      else if (s.owner === 0) log(g, `☠ Пірати пограбували ${s.name} біля ${g.systems[sys].name}.`, '#ff8a65');
    }
  }
  for (const sy of g.systems) {
    let w = 0; for (let f = 0; f < N; f++) w += warships(g, f, sy.id);
    // піратство годується торгівлею: у безлюдних системах майже немає піратів,
    // а один фрегат на орбіті тримає систему чистою
    const trade = g.planets.some(p => p.sys === sy.id && p.colony) ? 1 : 0.12;
    sy.piracy = clamp(sy.piracy + 0.0016 * trade - w * 0.004, 0.02, 1);
  }
  for (const s of g.ships) if (s.hp < 100 && s.t1 <= g.time) s.hp = Math.min(100, s.hp + 2.5); // ремонт у порту
}

// ================== ACTIONS ==================
export function colonizeCost(g: Game, p: Planet, f: number) {
  const near = g.planets.some(q => q.owner === f && q.sys === p.sys);
  return Math.round((p.tags.includes('D') ? 7000 : 3500) + (near ? 0 : 3000) + (1 - p.habit) * 1500);
}
export function canColonize(g: Game, p: Planet, f: number) { return !p.colony && g.factions[f].explored[p.sys] && !p.roche; }
export function colonize(g: Game, p: Planet, f: number) {
  const fa = g.factions[f]; const cost = colonizeCost(g, p, f);
  if (!canColonize(g, p, f) || fa.money < cost) return false;
  fa.money -= cost;
  const b: Record<string, number> = { habitat: 1, solar: 1 };
  const best = (Object.keys(p.res) as ResKey[]).sort((a, c) => p.res[c] - p.res[a])[0];
  const map: Record<ResKey, string> = { metal: 'mine', rare: 'rare', vol: 'water', org: 'farm', fuel: 'refinery', exotic: 'exotic', geo: 'geo' };
  b[map[best]] = 1;
  if (p.res.vol > 0.3 && best !== 'vol') b.water = 1;
  addColony(g, p, f, 0.5, b, false);
  p.colony!.stab = 65;
  log(g, `🚀 ${fa.short} заснував аванпост на ${p.name}.`, fa.color);
  return true;
}
export function buildCost(_g: Game, p: Planet, id: string) { const n = p.colony?.b[id] || 0; return Math.round(BMAP[id].cost * (1 + n * 0.15) * (p.g > 2 ? 1.4 : 1)); }
export function build(g: Game, p: Planet, f: number, id: string) {
  const fa = g.factions[f]; const cost = buildCost(g, p, id);
  if (p.owner !== f || fa.money < cost) return false;
  fa.money -= cost; p.colony!.b[id] = (p.colony!.b[id] || 0) + 1; return true;
}
export function demolish(p: Planet, id: string) { if (p.colony && p.colony.b[id]) p.colony.b[id]--; }

export type Act = 'subsidy' | 'invest' | 'media' | 'tariff' | 'embargo' | 'debt' | 'coup' | 'annex';
export const ACTS: { id: Act; name: string; lvl: number; desc: string }[] = [
  { id: 'subsidy', name: 'Субсидії', lvl: 1, desc: 'Дешевий експорт: +торгова залежність' },
  { id: 'media', name: 'Медіа-кампанія', lvl: 1, desc: '+20 медіа/пропаганди' },
  { id: 'invest', name: 'Інвестиції', lvl: 2, desc: '+15 інвестицій, будує інфраструктуру' },
  { id: 'tariff', name: 'Тарифи (0→15→30%)', lvl: 3, desc: 'Мито з усіх конкурентів, але –лояльність' },
  { id: 'embargo', name: 'Ембарго суперника', lvl: 3, desc: 'Найсильніший конкурент не може торгувати' },
  { id: 'debt', name: 'Вимагати за борги', lvl: 3, desc: 'Ресурси/кредити за інвестиції' },
  { id: 'coup', name: 'Фінансувати переворот', lvl: 4, desc: 'Прихильний уряд → Проксі' },
  { id: 'annex', name: 'Анексія', lvl: 5, desc: 'Пряме володіння планетою' },
];
export function actCost(p: Planet, a: Act) {
  const pop = p.colony?.pop || 0;
  return { subsidy: 1000 + pop * 3, invest: 3000 + pop * 5, media: 1500 + pop * 2, tariff: 0, embargo: 2000, debt: 0, coup: 8000 + pop * 20, annex: 10000 + pop * 30 }[a];
}
export function doAct(g: Game, p: Planet, f: number, a: Act): string | null {
  const fa = g.factions[f]; const lv = level(g, p, f); const def = ACTS.find(x => x.id === a)!;
  if (lv < def.lvl) return 'Недостатній рівень впливу';
  const cost = actCost(p, a);
  if (fa.money < cost) return 'Недостатньо кредитів';
  fa.money -= cost;
  switch (a) {
    case 'subsidy': p.imports[f] += cost * 1.5; for (let i = 0; i < 12; i++) p.stock[i] += p.desired[i] * 0.1; break;
    case 'media': p.media[f] = Math.min(100, p.media[f] + 20); break;
    case 'invest': p.invest[f] = Math.min(100, p.invest[f] + 15); { const c = p.colony!; const opts = ['habitat', 'solar', 'farm', 'water', 'fab', 'pharma']; const id = pick(opts); c.b[id] = (c.b[id] || 0) + 1; } break;
    case 'tariff': p.tariffBy = f; p.tariff = p.tariff >= 0.3 ? 0 : p.tariff + 0.15; break;
    case 'embargo': { p.tariffBy = f; let r = -1, rv = -1; p.infl.forEach((v, k) => { if (k !== f && v > rv) { rv = v; r = k; } }); if (r >= 0) { p.embargo[r] = !p.embargo[r]; log(g, `${fa.short}: ембарго проти ${g.factions[r].short} на ${p.name} ${p.embargo[r] ? 'введено' : 'скасовано'}.`, fa.color); } break; }
    case 'debt': { if (p.invest[f] < 20) { return 'Замало інвестицій (потрібно 20+)'; } const v = p.invest[f] * 120; fa.money += v; p.invest[f] -= 20; p.colony!.stab -= 10; break; }
    case 'coup': if (rnd() < 0.7) { p.proxy = f; p.infl[f] = Math.max(p.infl[f], 65); log(g, `🎭 ${fa.short} провів переворот на ${p.name}. Новий уряд лояльний.`, fa.color); } else { p.colony!.stab -= 25; p.infl[f] *= 0.5; log(g, `Переворот ${fa.short} на ${p.name} провалився!`, '#ff8a65'); } break;
    case 'annex': p.owner = f; p.colony!.native = false; p.tariffBy = -1; p.tariff = 0; p.embargo.fill(false); p.colony!.stab -= 10; log(g, `🏴 ${fa.short} анексував ${p.name}!`, fa.color); break;
  }
  return null;
}

// ================== BOTS (utility AI) ==================
function botTick(g: Game, f: Faction) {
  const own = g.planets.filter(p => p.owner === f.id);
  const ships = g.ships.filter(s => s.owner === f.id);
  const pers = f.persona;
  // housing & production
  for (const p of own) {
    const c = p.colony!;
    if (c.pop > c.K * 0.8 && f.money > 1500) build(g, p, f.id, 'habitat');
    if (c.energy < 1.05 && f.money > 1500) build(g, p, f.id, p.res.geo > 0.4 ? 'geo' : f.tech > 2 ? 'reactor' : 'solar');
    if (rnd() < 0.5 && f.money > 4000) {
      let bi = -1, bv = 0;
      for (let i = 0; i < 12; i++) { const v = price(p, i) / BASE[i] * (pers === 'дослідники' && i === 11 ? 2 : 1) * (pers === 'промисловці' && i >= 4 && i <= 7 ? 1.5 : 1); const bd = BMAP[PRODUCER[i]]; if (bd.res && p.res[bd.res] < 0.15) continue; if (v > bv) { bv = v; bi = i; } }
      if (bi >= 0 && bv > 1.1) build(g, p, f.id, PRODUCER[bi]);
    }
  }
  const fr = ships.filter(s => s.type !== 'scout' && s.type !== 'war').length;
  const home = own[0]; if (!home) return;
  if (fr < own.length * 2 + 2 && f.money > 5000) { const t: ShipType = pick(['freighter', 'freighter', 'heavy', 'tanker']); f.money -= SHIPDEF[t].cost; spawnShip(g, f.id, t, pick(own).id); }
  if (!ships.some(s => s.type === 'scout') && f.money > 3000 && f.explored.some(e => !e)) { f.money -= 1500; spawnShip(g, f.id, 'scout', home.id); }
  const wars = ships.filter(s => s.type === 'war').length;
  const wantW = pers === 'мілітаристи' ? own.length + 2 : Math.ceil(own.length / 3);
  if (wars < wantW && f.money > 9000) { f.money -= 5000; const w = spawnShip(g, f.id, 'war', pick(own).id); const tgt = g.planets.filter(p => p.colony && f.explored[p.sys]).sort((a, b) => g.systems[b.sys].piracy - g.systems[a.sys].piracy)[0]; if (tgt) setCourse(g, w, planetPlace(tgt)); }
  // colonize
  if (f.money > 8000 && own.length < 14) {
    const cands = g.planets.filter(p => canColonize(g, p, f.id) && !p.colony);
    let best: Planet | null = null, bs = -1;
    for (const p of cands) {
      const r = p.res; const sc = p.habit * 3 + r.metal + r.rare * 1.5 + r.fuel + r.vol + r.exotic * (pers === 'дослідники' ? 3 : 1) + (own.some(o => o.sys === p.sys) ? 1 : 0) - colonizeCost(g, p, f.id) / 5000;
      if (sc > bs) { bs = sc; best = p; }
    }
    if (best && f.money > colonizeCost(g, best, f.id) + 3000) colonize(g, best, f.id);
  }
  // influence
  const targets = g.planets.filter(p => p.colony && p.owner < 0 && f.explored[p.sys]).sort((a, b) => b.infl[f.id] - a.infl[f.id]);
  const t = targets[0];
  if (t) {
    const lv = level(g, t, f.id);
    if (lv >= 5 && f.money > actCost(t, 'annex') + 2000) doAct(g, t, f.id, 'annex');
    else if (lv >= 4 && pers !== 'торговці' && f.money > actCost(t, 'coup') + 5000 && rnd() < 0.3) doAct(g, t, f.id, 'coup');
    else if (lv >= 3 && t.tariffBy !== f.id && pers === 'торговці') doAct(g, t, f.id, 'tariff');
    else if (f.money > 9000) doAct(g, t, f.id, rnd() < 0.4 ? 'media' : lv >= 2 ? 'invest' : 'subsidy');
    else if (f.money > 4000 && rnd() < 0.3) doAct(g, pick(targets.slice(0, 3)), f.id, 'media');
  }
}

// ================== MAIN TICK ==================
export function controlledPop(g: Game, f: number) {
  let own = 0, tot = 0;
  for (const p of g.planets) { if (!p.colony) continue; tot += p.colony.pop; if (p.owner === f || p.proxy === f || level(g, p, f) >= 5) own += p.colony.pop; }
  return tot > 0 ? own / tot : 0;
}
export const SINGULARITY = 60000;
export function dayTick(g: Game) {
  g.day++;
  for (const p of g.planets) if (p.colony) colonyTick(g, p);
  for (const p of g.planets) influenceTick(g, p);
  piracyTick(g);
  if (g.day % 3 === 0) for (const f of g.factions) if (!f.isPlayer) botTick(g, f);
  if (g.day % 30 === 0) {
    const pr = g.factions[0];
    if (pr.money < 0) log(g, '⚠ Від’ємний баланс! Скоротіть витрати.', '#ff5252');
  }
  if (!g.winner) {
    for (const f of g.factions) {
      const cp = controlledPop(g, f.id);
      if (cp >= 0.6) { g.winner = { f: f.id, how: 'Економічна гегемонія (60%+ населення під контролем)' }; }
      else if (f.rp >= SINGULARITY) { g.winner = { f: f.id, how: 'Технологічна сингулярність' }; }
      const owned = g.planets.filter(p => p.owner === f.id).length;
      const total = g.planets.filter(p => p.colony).length;
      if (owned >= total * 0.7 && total > 5) g.winner = { f: f.id, how: 'Федерація під повним контролем' };
      if (g.winner) { log(g, `🏆 ${f.name}: ${g.winner.how}!`, f.color); break; }
    }
  }
}

// ================== MOONS ==================
function makeMoon(g: Game, p: Planet, a: number, mass: number, radius: number, name: string, e: number, inc: number) {
  const m = mkPlanet(g.planets.length, p.sys, p.id); g.planets.push(m); p.moons.push(m.id);
  m.name = name; m.a = a; m.mass = mass; m.e = e; m.inc = inc;
  m.radius = radius > 0 ? radius : 6371 * Math.pow(mass, 0.33);
  const mu = 398600 * (p.mass + m.mass);
  m.period = (2 * Math.PI * Math.sqrt(m.a ** 3 / mu)) / 86400;
  m.locked = true; m.rot = m.period * 24; m.teq = p.teq;
  return m;
}

function finalizeMoons(g: Game, p: Planet, resonance = true) {
  for (let i = 0; i < p.moons.length; i++) {
    const m = g.planets[p.moons[i]];
    const prev = i > 0 ? g.planets[p.moons[i - 1]] : null;
    if (resonance && prev && m.a / prev.a > 1.3 && m.a / prev.a < 1.8 && rnd() < 0.35) {
      const k = pick([2, 1.5, 4]); m.a = prev.a * Math.pow(k, 2 / 3);
      m.e = Math.min(0.22, m.e * 3); prev.e = Math.min(0.22, prev.e * 2.5);
      m.resonance = `${k === 1.5 ? '2:3' : k === 2 ? '1:2' : '1:4'} з ${prev.name}`;
      if (!prev.resonance) prev.resonance = `резонанс з ${m.name}`;
      const mu = 398600 * (p.mass + m.mass);
      m.period = (2 * Math.PI * Math.sqrt(m.a ** 3 / mu)) / 86400;
    }
    const roche = 2.44 * p.radius * Math.cbrt((p.mass / (p.radius / 6371) ** 3) / (m.mass / (m.radius / 6371) ** 3));
    if (m.a < roche) m.roche = true;
    // Tidal heating normalised to Io (M=318, R=1821, e=0.0041, a=421700, Q=100)
    const io = (318 ** 2 * 1821 ** 5 * 0.0041 ** 2) / (421700 ** 6 * 100);
    m.tidal = (p.mass ** 2 * m.radius ** 5 * m.e ** 2) / (m.a ** 6 * 100) / io;
    if (!m.tags) m.tags = m.tidal > 0.3 ? 'S-F' : m.teq < 170 ? 'S-C' : pick(['S-G', 'S-B']);
    m.res = resFor(m.tags.slice(2));
    if (m.roche) m.features.push('На межі Роша — формує кільця');
    describe(m);
    m.g = m.mass / (m.radius / 6371) ** 2; m.density = 5.51 * m.mass / (m.radius / 6371) ** 3;
    if (m.mass < 1e-4) { m.habit = Math.min(m.habit, 0.03); m.bio = 'Немає'; m.features.push('Астероїдний супутник, майже немає ресурсів'); }
    else if (m.radius < 400) m.habit = Math.min(m.habit, 0.12);
  }
}

function irregulars(g: Game, p: Planet, count: number, aMin: number, aMax: number, prefix: string) {
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rnd(), 0.6);
    makeMoon(g, p, aMin + (aMax - aMin) * t, Math.pow(10, R(-8, -3.6)), 0, `${prefix}-${i + 1}`, R(0.02, 0.35), R(0, 175));
  }
}

// ================== SOLAR SYSTEM (детальна копія) ==================
type SolarRow = [string, number, number, number, number, number, number, number, number, string];
const SOLAR_PLANETS: SolarRow[] = [
  ['Меркурій', 0.387, 0.2056, 7.0, 87.97, 0.0553, 2440, 1407.6, 0.03, 'G'],
  ['Венера', 0.723, 0.0068, 3.39, 224.7, 0.815, 6052, 5832.5, 177.4, 'B'],
  ['Земля', 1.0, 0.0167, 0.0, 365.25, 1.0, 6371, 23.93, 23.44, 'A'],
  ['Марс', 1.524, 0.0934, 1.85, 686.98, 0.107, 3390, 24.62, 25.19, 'B'],
  ['Юпітер', 5.203, 0.0489, 1.3, 4332.6, 317.8, 69911, 9.93, 3.13, 'D'],
  ['Сатурн', 9.537, 0.0565, 2.49, 10759, 95.16, 58232, 10.66, 26.73, 'D'],
  ['Уран', 19.19, 0.0457, 0.77, 30687, 14.54, 25362, 17.24, 97.77, 'CD'],
  ['Нептун', 30.07, 0.0113, 1.77, 60190, 17.15, 24622, 16.11, 28.32, 'CD'],
];
type MoonRow = [string, number, number, number, number, string, number?];
/** Маса (M⊕) з радіуса (км) і густини (г/см³) — для дрібних супутників, де точних вимірів немає */
const mr = (rKm: number, dens = 2.5) => Math.round(((rKm / 6371) ** 3) * (dens / 5.51) * 1e12) / 1e12;

/** Малі тіла Сонячної системи: карликові планети та найбільші астероїди */
interface SmallRow {
  name: string; a: number; e: number; inc: number; radius: number; mass: number;
  tags: 'G' | 'P'; note: string; res?: Partial<Res>; dens?: number; moons?: MoonRow[]; color?: string;
  m0?: number;   // середня аномалія на епоху J2000, рад (для найвідоміших тіл)
  triax?: number; rot?: number;   // виміряна тривісність і доба обертання (год)
}
const SOLAR_SMALL: SmallRow[] = [
  // --- Головний пояс астероїдів (2.06–3.27 а.о., між Марсом і Юпітером) ---
  { name: 'Церера', a: 2.7675, e: 0.0785, inc: 10.59, radius: 469.7, mass: 1.57e-4, tags: 'G', dens: 2.16, color: '#9aa7a0', m0: 1.675,
    note: 'карликова планета, найбільший об’єкт поясу; під поверхнею — водяний лід (25% маси)', res: { metal: 0.25, vol: 0.95, org: 0.3, rare: 0.2, geo: 0.15 } },
  { name: 'Веста', a: 2.3617, e: 0.0887, inc: 7.14, radius: 262.7, mass: 4.34e-5, tags: 'P', dens: 3.46, color: '#b9a98a',
    note: 'найяскравіший астероїд; базальтова кора, гігантський кратер Рея-Сільвія', res: { metal: 0.75, rare: 0.5, geo: 0.4 } },
  { name: 'Паллада', a: 2.772, e: 0.231, inc: 34.84, radius: 255.5, mass: 3.4e-5, tags: 'P', dens: 2.9, color: '#a9a49a',
    note: 'нахил орбіти 35° — найбільший серед великих астероїдів', res: { metal: 0.55, rare: 0.45, vol: 0.35 } },
  { name: 'Гігіея', a: 3.1415, e: 0.1125, inc: 3.83, radius: 216.5, mass: 1.46e-5, tags: 'G', dens: 1.94, color: '#8f9c9c',
    note: 'кандидат у карликові планети; майже куляста, вкрита льодом', res: { metal: 0.2, vol: 0.8, rare: 0.15 } },
  { name: 'Юнона', a: 2.669, e: 0.2562, inc: 12.99, radius: 123.2, mass: 4.7e-6, tags: 'P', dens: 3.2, color: '#b0977a',
    note: 'камʼяний астероїд із залізним ядром', res: { metal: 0.8, rare: 0.3 } },
  { name: 'Психея', a: 2.923, e: 0.1342, inc: 3.1, radius: 111, mass: 3.8e-6, tags: 'P', dens: 3.8, color: '#a89a90',
    note: 'металевий астероїд — оголене ядро протопланети', res: { metal: 1, rare: 0.6, exotic: 0.2 } },
  { name: '52 Європа', a: 3.095, e: 0.1086, inc: 7.48, radius: 157.5, mass: 5.5e-6, tags: 'P', dens: 1.9, color: '#93a3a8',
    note: 'крижано-камʼяне тіло з пиловим покривом', res: { metal: 0.4, vol: 0.6 } },
  { name: '704 Інтерамнія', a: 3.062, e: 0.1546, inc: 17.31, radius: 166.5, mass: 7.8e-6, tags: 'P', dens: 2.6, color: '#9b9689',
    note: 'наймасивніший астероїд після Церери, Вести й Паллади', res: { metal: 0.6, rare: 0.3, vol: 0.4 } },
  // --- Карликові планети: пояс Койпера та розсіяний диск ---
  { name: 'Плутон', a: 39.482, e: 0.2488, inc: 17.16, radius: 1188.3, mass: 2.18e-3, tags: 'G', dens: 1.85, color: '#d8b7a0', m0: 0.2536,
    note: 'карликова планета з резонансом 2:3 з Нептуном; азотні льодовики й «серце» Томбо',
    res: { metal: 0.2, vol: 0.9, org: 0.6, rare: 0.25, exotic: 0.1 },
    moons: [['Харон', 19591, 0.0002, 1.55e-3, 606, 'S-C'], ['Стікс', 42656, 0.0001, mr(16, 1.0), 16, 'S-C'],
      ['Нікта', 48694, 0.0002, mr(19.5, 1.0), 19.5, 'S-C'], ['Кербер', 57783, 0.0003, mr(10, 1.0), 10, 'S-C'],
      ['Гідра', 64738, 0.0059, mr(30, 1.0), 30, 'S-C']] },
  { name: 'Ерида', a: 67.864, e: 0.4418, inc: 44.04, radius: 1163, mass: 2.8e-3, tags: 'G', dens: 2.43, color: '#e8e4de',
    note: 'наймасивніша карликова планета; розсіяний диск, альбедо як у снігу',
    res: { metal: 0.2, vol: 0.85, org: 0.5, rare: 0.3, exotic: 0.15 },
    moons: [['Дисномія', 37273, 0.0062, mr(175, 1.2), 175, 'S-C']] },
  { name: 'Гаумеа', a: 43.22, e: 0.191, inc: 28.19, radius: 780, mass: 6.7e-4, tags: 'G', dens: 2.0, color: '#e6e9ee',
    note: 'обертається за 3.9 год — витягнута, як мʼяч; має кільце й два супутники',
    triax: 0.16, rot: 3.9,   // осі 1050×840×537 км: швидке обертання не дає стати кулею
    res: { metal: 0.15, vol: 0.9, rare: 0.2 },
    moons: [['Гіʼяка', 49880, 0.05, mr(160, 1.0), 160, 'S-C'], ['Намака', 25657, 0.25, mr(85, 1.0), 85, 'S-C']] },
  { name: 'Макемаке', a: 45.56, e: 0.158, inc: 28.98, radius: 715, mass: 5.2e-4, tags: 'G', dens: 2.1, color: '#d9a98f',
    note: 'класичний об’єкт поясу Койпера; метанові льоди, один супутник',
    res: { metal: 0.15, vol: 0.9, org: 0.4, rare: 0.2 },
    moons: [['MK 2', 21100, 0.01, mr(87, 1.0), 87, 'S-C']] },
  { name: 'Гонггонг', a: 67.4, e: 0.502, inc: 30.6, radius: 615, mass: 2.9e-4, tags: 'G', dens: 1.75, color: '#c98f7a',
    note: 'червонуватий об’єкт розсіяного диску; супутник Сянлю',
    res: { metal: 0.15, vol: 0.85, org: 0.45, rare: 0.2 },
    moons: [['Сянлю', 24000, 0.29, mr(100, 1.0), 100, 'S-C']] },
  { name: 'Кваоар', a: 43.7, e: 0.0392, inc: 7.99, radius: 545, mass: 2.3e-4, tags: 'G', dens: 2.0, color: '#cbb6a5',
    note: 'перший об’єкт Койпера, більший за Цереру (знайдений 2002 р.)',
    res: { metal: 0.2, vol: 0.85, rare: 0.2 },
    moons: [['Вейвот', 13600, 0.14, mr(100, 1.0), 100, 'S-C']] },
  { name: 'Орк', a: 39.42, e: 0.2266, inc: 20.59, radius: 458, mass: 1.07e-4, tags: 'G', dens: 1.8, color: '#c9b9ae',
    note: 'плутино з резонансом 2:3; яскравий супутник Вант',
    res: { metal: 0.2, vol: 0.85, rare: 0.2 },
    moons: [['Вант', 9000, 0.0009, mr(221, 1.2), 221, 'S-C']] },
];

const SOLAR_MOONS: Record<string, MoonRow[]> = {
  'Меркурій': [],
  'Венера': [],
  'Земля': [['Місяць', 384400, 0.0549, 0.0123, 1737, 'S-G']],
  'Марс': [['Фобос', 9376, 0.0151, 1.8e-9, 11.3, 'S-G'], ['Деймос', 23463, 0.0002, 2.5e-10, 6.2, 'S-G']],
  'Юпітер': [
    ['Метіда', 128000, 0.0002, mr(21.5, 1.5), 21.5, 'S-G'], ['Адрастея', 129000, 0.0015, mr(8.2, 1.5), 8.2, 'S-G'],
    ['Амальтея', 181365, 0.0032, mr(83.5, 0.85), 83.5, 'S-G'], ['Теба', 221889, 0.0175, mr(49.3, 0.85), 49.3, 'S-G'],
    ['Іо', 421700, 0.0041, 0.015, 1821, 'S-F'], ['Європа', 671034, 0.009, 0.008, 1560, 'S-C'],
    ['Ганімед', 1070412, 0.0013, 0.025, 2634, 'S-G'], ['Каллісто', 1882709, 0.0074, 0.018, 2410, 'S-G'],
    ['Гімалія', 11460000, 0.162, mr(85, 1.5), 85, 'S-G', 27.5],
  ],
  'Сатурн': [
    ['Пан', 133584, 0.0001, mr(14.1, 0.5), 14.1, 'S-C'],
    ['Дафніс', 136505, 0.0002, mr(3.8, 0.4), 3.8, 'S-C'],
    ['Прометей', 139380, 0.0022, mr(43.1, 0.48), 43.1, 'S-C'],
    ['Пандора', 141720, 0.0042, mr(40.7, 0.49), 40.7, 'S-C'],
    ['Епіметей', 151410, 0.0098, mr(58.1, 0.64), 58.1, 'S-C'],
    ['Янус', 151460, 0.0068, mr(89.5, 0.63), 89.5, 'S-C'],
    ['Мімас', 185539, 0.0196, 3.75e-5, 198, 'S-C'], ['Енцелад', 237948, 0.0047, 1.08e-5, 252, 'S-C'],
    ['Тетіс', 294619, 0.0001, 6.17e-5, 531, 'S-C'], ['Діона', 377396, 0.0022, 1.09e-4, 561, 'S-C'],
    ['Рея', 527108, 0.001, 2.31e-4, 764, 'S-C'], ['Титан', 1221870, 0.0288, 0.0225, 2575, 'S-C'],
    ['Гіперіон', 1500933, 0.0232, mr(135, 0.55), 135, 'S-C'],
    ['Япет', 3560820, 0.0283, 1.81e-4, 735, 'S-G'],
    ['Феба', 12952000, 0.163, mr(106.5, 1.6), 106.5, 'S-G', 175.3],
  ],
  'Уран': [
    ['Корделія', 49771, 0.0003, mr(20, 1.3), 20, 'S-C'], ['Офелія', 53790, 0.0098, mr(21.4, 1.3), 21.4, 'S-C'],
    ['Бʼянка', 59165, 0.0009, mr(25.7, 1.3), 25.7, 'S-C'], ['Кресида', 61766, 0.0004, mr(39.8, 1.3), 39.8, 'S-C'],
    ['Дездемона', 62658, 0.0001, mr(32, 1.3), 32, 'S-C'], ['Джульєта', 64358, 0.0007, mr(46.8, 1.3), 46.8, 'S-C'],
    ['Порція', 66097, 0.0001, mr(67.6, 1.3), 67.6, 'S-C'], ['Розалінда', 69927, 0.0001, mr(36, 1.3), 36, 'S-C'],
    ['Белінда', 75255, 0.0001, mr(40.3, 1.3), 40.3, 'S-C'], ['Пак', 86004, 0.0001, mr(81, 1.3), 81, 'S-C'],
    ['Міранда', 129390, 0.0013, 6.3e-5, 236, 'S-C'], ['Аріель', 190900, 0.0012, 1.29e-4, 579, 'S-C'],
    ['Умбріель', 266000, 0.0039, 1.22e-4, 585, 'S-C'], ['Титанія', 435910, 0.0011, 3.4e-4, 789, 'S-C'],
    ['Оберон', 583520, 0.0014, 2.88e-4, 761, 'S-C'],
  ],
  'Нептун': [
    ['Наяда', 48227, 0.0003, mr(33, 1.3), 33, 'S-C'], ['Таласа', 50074, 0.0002, mr(41, 1.3), 41, 'S-C'],
    ['Деспіна', 52526, 0.0004, mr(75, 1.3), 75, 'S-C'], ['Галатея', 61953, 0.0001, mr(88, 1.3), 88, 'S-C'],
    ['Лариса', 73548, 0.0014, mr(97, 1.3), 97, 'S-C'], ['Гіпокамп', 105283, 0.0005, mr(17.4, 1.3), 17.4, 'S-C'],
    ['Протей', 117647, 0.0005, mr(210, 1.3), 210, 'S-G'],
    ['Тритон', 354759, 0.000016, 2.14e-3, 1353, 'S-C', 157],
    ['Нереїда', 5513818, 0.7506, mr(170, 1.5), 170, 'S-G', 7.2],
  ],
};
const SOLAR_IRREGULAR: Record<string, number> = { 'Юпітер': 76, 'Сатурн': 54, 'Уран': 25, 'Нептун': 15, 'Нептун-малий': 0 };
const SOLAR_OV: Record<string, Partial<Planet>> = {
  'Меркурій': { temp: 440, pressure: 5e-15, atmo: 'Екзосфера: O₂, Na, H₂, He', hydro: 'Лід у полярних кратерах', hydroCov: 0.01, crust: 'Силікати, металеве ядро', tectonics: 'Мертва, зсув кори від охолодження', habit: 0.05, bio: 'Немає', features: ['Кратер Калоріс', 'Полярний водяний лід', 'Екстремальний перепад температур'], weather: 'Немає' },
  'Венера': { temp: 737, pressure: 92, atmo: 'CO₂ 96.5%, N₂ 3.5%, H₂SO₄', hydro: 'Немає', hydroCov: 0, crust: 'Базальт', tectonics: 'Епізодичний вулканізм', habit: 0.03, bio: 'Можлива мікробна (атмосфера)', features: ['Парниковий ефект', 'Сульфатні хмари', 'Вулкан Маат Монс'], weather: 'Суперобертання хмар, кислотні дощі' },
  'Земля': { temp: 288, pressure: 1, atmo: 'N₂ 78%, O₂ 21%, Ar 0.9%, CO₂ 0.04%', hydro: 'Вода', hydroCov: 0.71, crust: 'Силікати, тектоніка плит', tectonics: 'Активна тектоніка плит', habit: 1, bio: 'Складна фауна — цивілізація', features: ['Батьківщина Федерації', 'Океани рідкої води', 'Магнітосфера'], weather: 'Помірна, циклони' },
  'Марс': { temp: 210, pressure: 0.006, atmo: 'CO₂ 95%, N₂ 2.6%, Ar 1.9%', hydro: 'Лід на полюсах, підповерхневий лід', hydroCov: 0.02, crust: 'Базальт, оксиди заліза', tectonics: 'Мертва, залишки вулканізму', habit: 0.25, bio: 'Немає (пошук слідів)', features: ['Гора Олімп', 'Долина Марінеріс', 'Полярні шапки'], weather: 'Пилові бурі' },
  'Юпітер': { temp: 165, pressure: Infinity, atmo: 'H₂ 89%, He 10%, CH₄, NH₃', hydro: 'Немає поверхні, металевий водень', hydroCov: 0, crust: 'Металевий водень', tectonics: 'Конвекція мантії', habit: 0, bio: 'Немає', features: ['Велика Червона Пляма', 'Потужні радіаційні пояси', '80 супутників'], weather: 'Суперштормові пояси, вітри до 600 км/год' },
  'Сатурн': { temp: 134, pressure: Infinity, atmo: 'H₂ 96%, He 3%, CH₄', hydro: 'Немає поверхні', hydroCov: 0, crust: 'Металевий водень', tectonics: 'Конвекція мантії', habit: 0, bio: 'Немає', features: ['Кільця з льоду й пилу', 'Гексагон на полюсі', '80 супутників'], weather: 'Вітри до 1800 км/год' },
  'Уран': { temp: 76, pressure: Infinity, atmo: 'H₂ 83%, He 15%, CH₄ 2%', hydro: 'Водно-аміачна мантія', hydroCov: 0, crust: 'Крижана мантія', tectonics: 'Слабка', habit: 0, bio: 'Немає', features: ['Нахил осі 98°', 'Крижані кільця'], weather: 'Спокійні пояси' },
  'Нептун': { temp: 72, pressure: Infinity, atmo: 'H₂ 80%, He 19%, CH₄ 1.5%', hydro: 'Водно-аміачна мантія', hydroCov: 0, crust: 'Крижана мантія', tectonics: 'Слабка', habit: 0, bio: 'Немає', features: ['Найшвидші вітри в Сонячній системі', 'Велика Темна Пляма'], weather: 'Вітри до 2100 км/год' },
};

function genSolar(g: Game, id: number, x: number, y: number) {
  const s: StarSystem = {
    id, name: 'Сонячна', x, y, starMass: 1, lum: 1, starClass: 'G', spec: 'G2V', real: true,
    distLy: 0, giant: false,
    note: 'наш дім: 8 планет, 9 карликових планет, головний пояс астероїдів, троянці Юпітера та пояс Койпера',
    planets: [], piracy: 0.12,
    belts: [
      { a: [2.06, 3.27], kind: 'main', n: 620, label: 'Головний пояс астероїдів' },
      { a: [5.05, 5.35], kind: 'trojan', n: 150, label: 'Троянці Юпітера' },
      { a: [30, 50], kind: 'kuiper', n: 520, label: 'Пояс Койпера' },
      { a: [50, 70], kind: 'kuiper', n: 180, label: 'Розсіяний диск' },
    ],
  };
  g.systems.push(s);
  for (const row of SOLAR_PLANETS) {
    const [name, a, e, inc, period, mass, radius, rot, tilt, tags] = row;
    const p = mkPlanet(g.planets.length, id, -1); g.planets.push(p); s.planets.push(p.id);
    p.name = name; p.a = a; p.e = e; p.inc = inc; p.period = period; p.mass = mass; p.radius = radius;
    p.rot = rot; p.tilt = tilt; p.tags = tags; p.kind = 'planet'; p.teq = Math.round(278 / Math.sqrt(a));
    p.res = name === 'Земля'
      ? { metal: 0.55, rare: 0.35, vol: 0.7, org: 0.85, fuel: 0.45, exotic: 0.1, geo: 0.15 }
      : resFor(tags);
    describe(p);
    p.g = mass / (radius / 6371) ** 2; p.density = 5.51 * mass / (radius / 6371) ** 3;
    Object.assign(p, SOLAR_OV[name] || {});
    const list = SOLAR_MOONS[name] || [];
    for (const mr of list) {
      const [mn, ma2, me, mm, mradius, tag, minc] = mr;
      const m = makeMoon(g, p, ma2, mm, mradius, mn, me, minc ?? 0);
      m.tags = tag; m.res = resFor(tag.slice(2));
      if (mn === 'Іо') { m.res.geo = 1; m.features.push('Найактивніший вулканізм Сонячної системи'); }
      if (mn === 'Європа') { m.features.push('Підльодовий океан — головний кандидат на життя'); m.habit = Math.max(m.habit, 0.2); }
      if (mn === 'Ганімед') m.features.push('Власне магнітне поле');
      if (mn === 'Титан') { m.features.push('Щільна азотна атмосфера, метанові озера'); m.habit = Math.max(m.habit, 0.15); }
      if (mn === 'Місяць') m.features.push('Припливне захоплення, резонанс 1:1');
    }
    const n = SOLAR_IRREGULAR[name] || 0;
    if (n > 0 && p.moons.length) {
      const lastA = Math.max(...p.moons.map(m => g.planets[m].a));
      irregulars(g, p, n, lastA * 1.7, lastA * 7, `${name}·S`);
    }
    finalizeMoons(g, p, false);
    for (const mid of p.moons) {
      const m = g.planets[mid];
      if (m.name === 'Іо') m.res.geo = 1;
      if (m.name === 'Європа') { m.res.vol = 0.9; m.habit = Math.max(m.habit, 0.2); }
      if (m.name === 'Титан') { m.res.org = 0.5; m.habit = Math.max(m.habit, 0.15); }
      if (m.name === 'Місяць') { m.res.metal = Math.max(m.res.metal, 0.6); m.res.rare = 0.35; }
    }
    if (p.moons.length) {
      const io = g.planets[p.moons[0]];
      if (name === 'Юпітер') { io.resonance = '1:2:4 (Лаплас) з Європою та Ганімедом'; }
    }
    if (name === 'Юпітер' || name === 'Сатурн') {
      const rings = p.moons.length > 0;
      if (rings && !p.features.includes('Кільця з льоду й пилу')) p.features.push('Кільця — на межі Роша');
    }
  }
  // --- карликові планети та найбільші астероїди ---
  for (const row of SOLAR_SMALL) {
    const p = mkPlanet(g.planets.length, id, -1); g.planets.push(p); s.planets.push(p.id);
    p.name = row.name; p.a = row.a; p.e = row.e; p.inc = row.inc; p.mass = row.mass; p.radius = row.radius;
    p.tags = row.tags;
    p.kind = row.tags === 'G' ? 'dwarf' : 'asteroid';
    p.teq = Math.round(278 / Math.sqrt(p.a));
    p.period = 365.25 * Math.sqrt((p.a * p.a * p.a) / s.starMass);   // третій закон Кеплера
    if (row.m0 !== undefined) p.phase = row.m0;                      // фаза орбіти на епоху J2000
    p.res = { ...resFor(''), ...(row.res || {}) } as Res;
    p.crust = row.dens && row.dens < 2.1 ? 'Крижано-кам’яна, пориста' : 'Кам’яно-металева';
    p.atmo = p.radius > 600 ? 'Розріджена (N₂, CH₄) — сезонна' : 'Майже вакуум';
    p.pressure = p.radius > 600 ? 1e-5 : 0;
    p.hydro = row.dens && row.dens < 2.1 ? 'Водяний лід / підповерхневий океан' : 'Немає';
    p.hydroCov = row.dens && row.dens < 2.1 ? 0.3 : 0;
    p.toxic = true; p.weather = p.radius > 600 ? 'Сезонні зміни альбедо' : 'Відсутня';
    p.tectonics = 'Мертва (залишкове тепло надр)';
    p.bio = 'Немає';
    p.habit = clamp(0.02 + p.res.org * 0.1 + p.res.vol * 0.06, 0.02, 0.15);
    p.g = p.mass / (p.radius / 6371) ** 2; p.density = 5.51 * p.mass / (p.radius / 6371) ** 3;
    p.rot = row.rot ?? (p.radius > 600 ? R(6, 30) : R(6, 40)); p.tilt = R(0, 30);
    if (row.triax) p.triax = row.triax;
    p.features.push(row.note);
    p.features.push(row.tags === 'G' ? 'Карликова планета' : 'Астероїд головного поясу');
    p.infl = new Array(N).fill(0);
    for (const mrow of row.moons || []) {
      const [mn, ma2, me, mm, mradius, tag, minc] = mrow;
      const m = makeMoon(g, p, ma2, mm, mradius, mn, me, minc ?? 0);
      m.tags = tag; m.res = resFor(tag.slice(2));
      if (mn === 'Харон') { m.res.vol = 0.8; m.features.push('Величезний супутник — подвійна система з Плутоном'); }
    }
    if (p.moons.length) finalizeMoons(g, p, false);
  }
  // троянці Юпітера тримаються точок L4/L5 — за 60° попереду й позаду планети
  const jup = g.planets.find(q => q.name === 'Юпітер');
  if (jup) for (const b of s.belts) if (b.kind === 'trojan') b.of = jup.id;
  log(g, '🌍 Земля — столиця Федерації. Ваш шлях починається тут.', '#38d9ff');
  log(g, '🔭 Сонячна система: 8 планет, Церера й Веста в головному поясі, Плутон і карликові планети в поясі Койпера.', '#7fe0ff');
}

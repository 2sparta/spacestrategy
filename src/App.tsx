import { useEffect, useRef, useState } from 'react';
import type { Game, Planet, Place, Ship, ShipType } from './game';
import {
  ACTS, BASE, BMAP, BUILD, GOODS, GOOD_ICON, LEVEL_NAME, RES_NAME, SHIPDEF, SINGULARITY, actCost, build, buildCost,
  canColonize, colonize, colonizeCost, controlledPop, dayTick, demolish, doAct, eta, hoursPerLy, level as inflLevel, newGame, orbitA,
  placeName, planetPlace, price, shipProgress, shipPlace, spawnShip, starPlace, tradeDep, updateShips, setCourse, warships,
  irregularity, isIrregular, potatoRadius, POTATO_RADIUS_ICY_KM, POTATO_RADIUS_ROCKY_KM, isIcy,
  type ResKey,
} from './game';
import { drawScene, drawnPosAU, loadSprites, moonRefAU, shipSystemPos, type Camera, type Hit, type Scene } from './render';
import { KM_PER_AU, SPEEDS, TAG_COLOR, TAG_DESC, auFmt, clamp, fmt, lyFmt, popFmt, starTint } from './style';

const emptyCam = (): Camera => ({ x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1, ease: false });

/** Межі галактичної карти (св. роки) */
function galaxyBounds(g: Game) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const s of g.systems) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
  const m = 8;
  return { x0: x0 - m, x1: x1 + m, y0: y0 - m, y1: y1 + m };
}
/** Зум «під розмір» для заданого радіуса у а.о. */
const fitZoom = (W: number, H: number, radiusAU: number) => clamp((Math.min(W, H) * 0.44) / Math.max(1e-7, radiusAU), SYS_ZMIN, SYS_ZMAX);
/** Межі зуму карти системи: від «уся система разом із поясом Койпера» до поверхні тіл.
 *  2×10⁹ пікселів на а.о. — це ~75 м на піксель: Фобос і Деймос видно як справжні глиби,
 *  а планети сягають пів екрана. */
const SYS_ZMIN = 0.035, SYS_ZMAX = 2e9;
const GAL_ZMIN = 0.35, GAL_ZMAX = 260;
/** Зони Сонячної системи для швидкої навігації: [назва, радіус підгонки в а.о.] */
const ZONES: [string, number][] = [
  ['Внутрішні планети', 1.7], ['Пояс астероїдів', 3.6], ['Зовнішні планети', 31], ['Пояс Койпера', 72],
];
const zoneOf = (a: number) => (a < 2.0 ? 0 : a < 3.5 ? 1 : a < 30 ? 2 : 3);
/** Підписи зон: для Сонця — «людські», для інших систем — узагальнені */
/** Скільки в системі планет / карликових планет / астероїдів */
function bodyCounts(g: Game, sysId: number) {
  const list = g.systems[sysId].planets.map(id => g.planets[id]);
  const planets = list.filter(p => bodyKind(p) === 'планета' || bodyKind(p) === 'газовий гігант').length;
  const dwarfs = list.filter(p => bodyKind(p) === 'карликова планета').length;
  const asteroids = list.filter(p => bodyKind(p) === 'астероїд' || bodyKind(p) === 'мале тіло').length;
  const moons = g.planets.filter(p => p.sys === sysId && p.parent >= 0).length;
  const parts = [`${planets} планет`];
  if (dwarfs) parts.push(`${dwarfs} карликових`);
  if (asteroids) parts.push(`${asteroids} астероїдів`);
  if (moons) parts.push(`${moons} супутників`);
  return parts.join(' · ');
}
const zoneLabel = (sysId: number, zone: number) => (sysId === 0
  ? ['Внутрішні планети', 'Пояс астероїдів', 'Зовнішні планети', 'Пояс Койпера'][zone]
  : ['Внутрішня зона', 'Зона дрібних тіл', 'Основні планети', 'Далека зона'][zone]);

export default function App() {
  const gRef = useRef<Game>(newGame(Math.floor(Math.random() * 1e9)));
  const [, setTick] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [level, setLevel] = useState<'galaxy' | 'system'>('galaxy');
  const [sysId, setSysId] = useState(0);
  const [objId, setObjId] = useState(-1);
  const [selShip, setSelShip] = useState(-1);
  const [tab, setTab] = useState<'info' | 'market' | 'infl' | 'dev'>('dev');
  const [bottom, setBottom] = useState<'log' | 'ships' | 'factions' | 'help'>('help');
  const [toast, setToast] = useState('');
  const [hover, setHover] = useState<{ id: number; kind: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const hitsRef = useRef<Hit[]>([]);
  const galRef = useRef<Camera>(emptyCam());
  const sysRef = useRef<Camera>(emptyCam());
  const fadeRef = useRef(0);
  const followRef = useRef(-1);
  const speedRef = useRef(speed); speedRef.current = speed;
  const uiRef = useRef({ level, sysId, objId, selShip, hoverId: -1, hoverKind: '' });
  uiRef.current = { level, sysId, objId, selShip, hoverId: hover?.id ?? -1, hoverKind: hover?.kind ?? '' };
  const g = gRef.current;
  const me = g.factions[0];
  const msg = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600); };

  /* ---------- ініціалізація камери ---------- */
  useEffect(() => {
    // стартуємо біля Сонця: видно найближчі зорі, далі — колесом або кнопкою ⤢
    const W = window.innerWidth - 430, H = window.innerHeight - 40;
    const z = clamp(Math.min(W, H) / 70, 2.5, 26);
    galRef.current = { x: 0, y: 0, z, tx: 0, ty: 0, tz: z, ease: false };
    const img = new Image();
    img.onload = () => { bgRef.current = img; };
    img.src = 'images/nebula.jpg';
    loadSprites();   // спрайти астероїдів для глибокого зуму
  }, []);

  /* ---------- головний цикл ---------- */
  useEffect(() => {
    let last = performance.now(); let raf = 0; let acc = 0;
    const stepZoom = (cam: Camera) => {
      if (!cam.ease) return;
      cam.z *= Math.pow(cam.tz / cam.z, 0.12);
      if (Math.abs(Math.log(cam.tz / cam.z)) < 0.02) { cam.z = cam.tz; cam.ease = false; }
    };
    const step = (cam: Camera) => {
      if (!cam.ease) return;
      cam.x += (cam.tx - cam.x) * 0.12;
      cam.y += (cam.ty - cam.y) * 0.12;
      cam.z *= Math.pow(cam.tz / cam.z, 0.12);
      const dpx = Math.hypot(cam.tx - cam.x, cam.ty - cam.y) * cam.z;
      if (dpx < 0.4 && Math.abs(Math.log(cam.tz / cam.z)) < 0.02) { cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; cam.ease = false; }
    };
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const gm = gRef.current;
      if (!gm.winner || speedRef.current) {
        gm.time += dt * 0.5 * speedRef.current;
        while (gm.time >= gm.day + 1) dayTick(gm);
        updateShips(gm);
      }
      const target = uiRef.current.level === 'system' ? 1 : 0;
      const f = fadeRef.current;
      fadeRef.current = Math.abs(target - f) < 0.002 ? target : f + (target - f) * Math.min(1, dt * 7);
      if (followRef.current >= 0) {
        // берімо ту саму позицію, яку малює рендерер (кеплерова орбіта + зсув
        // нерозрізненого супутника на обід планети) — інакше на глибокому зумі
        // камера «відстає» від тіла й воно тікає з кадру
        const cv0 = canvasRef.current;
        const W0 = cv0?.parentElement?.clientWidth || 1200, H0 = cv0?.parentElement?.clientHeight || 760;
        const cam = sysRef.current;
        const [bx, by] = drawnPosAU(gm, followRef.current, cam.tz, W0, H0, gm.time);
        cam.x = bx; cam.y = by;
      }
      // коли камера стежить за тілом, позицію задаємо напряму, але масштаб
      // усе одно має плавно доїжджати до цільового (інакше 🔍 не наближає)
      if (followRef.current >= 0) { const fc = sysRef.current; fc.tx = fc.x; fc.ty = fc.y; stepZoom(fc); }
      else step(sysRef.current);
      step(galRef.current);
      draw();
      acc += dt; if (acc > 0.2) { acc = 0; setTick(t => t + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- рендер ---------- */
  function draw() {
    const cv = canvasRef.current; if (!cv) return;
    const par = cv.parentElement!; const W = par.clientWidth, H = par.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (size.w !== W || size.h !== H) setSize({ w: W, h: H });
    const c = cv.getContext('2d')!;
    const u = uiRef.current;
    const st: Scene = {
      g, time: g.time, level: u.level, sysId: u.sysId, objId: u.objId, selShip: u.selShip,
      hoverId: u.hoverId, hoverKind: u.hoverKind,
      gal: galRef.current, sys: sysRef.current, fade: fadeRef.current, bg: bgRef.current, W, H,
    };
    hitsRef.current = drawScene(c, st);
  }

  /* ---------- переходи між рівнями ---------- */
  function openSystem(id: number, radiusAU?: number) {
    const gm = gRef.current, s = gm.systems[id];
    setSysId(id); setLevel('system'); setObjId(-1);
    const maxA = Math.max(0.05, ...s.planets.map(p => gm.planets[p].a), ...s.belts.map(b => b.a[1]));
    // компактні системи червоних карликів видно повністю; Сонячну відкриваємо «до Нептуна»,
    // решта (пояс Койпера, Ерида) — колесом, кнопкою ⤢ або зонами
    const rad = radiusAU ?? clamp(Math.min(maxA * 1.15, 32), 0.025, 400);
    const z = fitZoom(size.w, size.h, rad);
    sysRef.current = { x: 0, y: 0, z, tx: 0, ty: 0, tz: z, ease: false };
    followRef.current = -1;
  }
  function backToGalaxy() { setLevel('galaxy'); followRef.current = -1; }
  function flyGalaxyTo(x: number, y: number, z?: number) {
    const cam = galRef.current;
    cam.tx = x; cam.ty = y; cam.tz = z ?? cam.z; cam.ease = true;
  }
  function focusPlanet(id: number) {
    const gm = gRef.current, p = gm.planets[id];
    if (p.sys !== sysId) openSystem(p.sys);
    setObjId(id); followRef.current = id;
    const cam = sysRef.current;
    // наближаємось так, щоб було видно всю систему супутників планети
    const host = p.parent >= 0 ? gm.planets[p.parent] : p;      // для супутника кадруємо систему батька
    const aMax = host.moons.length ? moonRefAU(gm, host) : 0;
    const radius = Math.max(aMax * 1.5, (host.radius / KM_PER_AU) * 60, 2e-6);
    cam.tz = fitZoom(size.w, size.h, radius); cam.ease = true;
  }
  /** Наблизити камеру так, щоб тіло займало більшу частину екрана */
  function inspectBody(id: number) {
    const p = g.planets[id];
    if (p.sys !== sysId) openSystem(p.sys);
    setObjId(id); followRef.current = id;
    const cam = sysRef.current;
    cam.tz = fitZoom(size.w, size.h, (p.radius / KM_PER_AU) * 2.4);
    cam.ease = true;
  }
  function fitZone(radius: number) {
    const cam = sysRef.current;
    cam.tx = 0; cam.ty = 0; cam.tz = fitZoom(size.w, size.h, radius); cam.ease = true;
    followRef.current = -1;
  }
  /** Радіус підгонки для зони: найдальший обʼєкт зони з невеликим запасом */
  function zoneRadius(zone: number) {
    const items = sys.planets.map(id => g.planets[id]).filter(q => zoneOf(q.a) === zone);
    const belts = sys.belts.filter(b => zoneOf((b.a[0] + b.a[1]) / 2) === zone);
    const maxA = Math.max(0, ...items.map(q => q.a * 1.15), ...belts.map(b => b.a[1] * 1.05));
    return maxA || 0.4;
  }
  function fitSystem() {
    const maxA = Math.max(0.05, ...sys.planets.map(p => g.planets[p].a), ...sys.belts.map(b => b.a[1]));
    fitZone(maxA * 1.05);
  }
  function focusShip(s: Ship) {
    setSelShip(s.id);
    followRef.current = -1;
    // корабель у поточній системі — показуємо його на карті системи
    const posAU = shipSystemPos(g, s, g.time, sysId);
    if (level === 'system' && posAU) {
      const cam = sysRef.current;
      cam.ease = true; cam.tx = posAU[0]; cam.ty = posAU[1]; cam.tz = Math.max(cam.z, 30);
      return;
    }
    setLevel('galaxy');
    if (s.t1 > g.time) {
      const a = g.systems[s.fromSys], b = g.systems[s.toSys];
      const t = shipProgress(g, s, g.time);
      flyGalaxyTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, Math.max(galRef.current.z, 12));
    } else {
      const sy = g.systems[s.atSys];
      flyGalaxyTo(sy.x, sy.y, Math.max(galRef.current.z, 12));
    }
  }

  /* ---------- взаємодія з канвою ---------- */
  const drag = useRef<{ id: number; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ d: number; z: number; x: number; y: number; mx: number; my: number } | null>(null);

  const activeCam = () => (uiRef.current.level === 'system' ? sysRef.current : galRef.current);

  function zoomAt(px: number, py: number, factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return; // захист від сміттєвих подій
    if (!Number.isFinite(px) || !Number.isFinite(py)) { px = size.w / 2; py = size.h / 2; }
    const sysMode = uiRef.current.level === 'system';
    const cam = sysMode ? sysRef.current : galRef.current;
    const W = size.w, H = size.h;
    const zMin = sysMode ? SYS_ZMIN : GAL_ZMIN, zMax = sysMode ? SYS_ZMAX : GAL_ZMAX;
    const wx = cam.x + (px - W / 2) / cam.z, wy = cam.y + (py - H / 2) / cam.z;
    cam.z = clamp(cam.z * factor, zMin, zMax);
    cam.x = wx - (px - W / 2) / cam.z; cam.y = wy - (py - H / 2) / cam.z;
    cam.tx = cam.x; cam.ty = cam.y; cam.tz = cam.z; cam.ease = false;
    setSize(s => (s.w === W && s.h === H ? s : { w: W, h: H }));
  }

  function hitAt(x: number, y: number): Hit | null {
    let best: Hit | null = null, bd = 1e9;
    for (const h of hitsRef.current) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < h.r + 6 && d < bd) { bd = d; best = h; }
    }
    return best;
  }

  function handleClick(x: number, y: number) {
    const h = hitAt(x, y);
    if (!h) { if (uiRef.current.level === 'galaxy') setObjId(-1); return; }
    if (h.kind === 'star') {
      setSysId(h.id); setObjId(-1);
      if (uiRef.current.level === 'galaxy') flyGalaxyTo(g.systems[h.id].x, g.systems[h.id].y);
    } else {
      const p = g.planets[h.id];
      setSysId(p.sys); setObjId(h.id);
      if (uiRef.current.level === 'galaxy') openSystem(p.sys);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect();
    cv.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (pointers.current.size === 1) {
      const cam = activeCam();
      drag.current = { id: e.pointerId, sx: e.clientX - r.left, sy: e.clientY - r.top, cx: cam.x, cy: cam.y, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const cam = activeCam();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z, x: cam.x, y: cam.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag.current = null;
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x, y });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const pin = pinch.current;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const cam = activeCam();
      const sysMode = uiRef.current.level === 'system';
      const W = size.w, H = size.h;
      // тримаємо точку під центром жесту нерухомою
      const wx = pin.x + (pin.mx - W / 2) / pin.z, wy = pin.y + (pin.my - H / 2) / pin.z;
      cam.z = clamp(pin.z * (d / Math.max(1, pin.d)), sysMode ? SYS_ZMIN : GAL_ZMIN, sysMode ? SYS_ZMAX : GAL_ZMAX);
      cam.x = wx - (mx - W / 2) / cam.z; cam.y = wy - (my - H / 2) / cam.z;
      cam.tx = cam.x; cam.ty = cam.y; cam.tz = cam.z; cam.ease = false;
      followRef.current = -1;
      return;
    }
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      const dx = x - d.sx, dy = y - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) {
        const cam = activeCam();
        cam.x = d.cx - dx / cam.z; cam.y = d.cy - dy / cam.z;
        cam.tx = cam.x; cam.ty = cam.y; cam.tz = cam.z; cam.ease = false;
        followRef.current = -1;
        setHover(null);
      }
      return;
    }
    const h = hitAt(x, y);
    setHover(prev => {
      const id = h ? h.id : -1;
      const kind = h ? h.kind : '';
      if (prev && prev.id === id && prev.kind === kind) return prev;
      return h ? { id, kind, x, y } : null;
    });
  }
  function onPointerUp(e: React.PointerEvent) {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      drag.current = null;
      if (!d.moved) handleClick(x, y);
    }
    if (pointers.current.size === 0) drag.current = null;
  }
  function onDoubleClick(e: React.MouseEvent) {
    const cv = canvasRef.current!; const r = cv.getBoundingClientRect();
    const h = hitAt(e.clientX - r.left, e.clientY - r.top);
    if (!h) return;
    if (h.kind === 'star') {
      if (uiRef.current.level === 'galaxy') openSystem(h.id);
      else setSysId(h.id);
    } else {
      inspectBody(h.id);   // подвійний клік — наблизити до самого тіла
    }
  }

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      // звичайне колесо — плавне наближення; Shift або Ctrl — швидкий перехід між масштабами
      const step = e.shiftKey || e.ctrlKey || e.metaKey ? 0.0075 : 0.0022;
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.max(-400, Math.min(400, e.deltaY)) * step));
    };
    cv.addEventListener('wheel', wheel, { passive: false });
    return () => cv.removeEventListener('wheel', wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  /* ---------- клавіатура ---------- */
  useEffect(() => {
    const keys = new Set<string>();
    let raf = 0;
    const tickKeys = () => {
      const cam = keys.size ? (uiRef.current.level === 'system' ? sysRef.current : galRef.current) : null;
      if (cam) {
        const sp = (keys.has('shift') ? 900 : 300) / cam.z;
        if (keys.has('arrowleft') || keys.has('a')) { cam.x -= sp; cam.tx = cam.x; }
        if (keys.has('arrowright') || keys.has('d')) { cam.x += sp; cam.tx = cam.x; }
        if (keys.has('arrowup') || keys.has('w')) { cam.y -= sp; cam.ty = cam.y; }
        if (keys.has('arrowdown') || keys.has('s')) { cam.y += sp; cam.ty = cam.y; }
        cam.tz = cam.z; cam.ease = false;
        followRef.current = -1;
      }
      raf = requestAnimationFrame(tickKeys);
    };
    raf = requestAnimationFrame(tickKeys);
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k)) { keys.add(k); }
      if (e.key === 'Shift') keys.add('shift');
      if (e.key === 'Escape') {
        if (followRef.current >= 0) followRef.current = -1;
        else if (uiRef.current.level === 'system' && uiRef.current.objId >= 0) setObjId(-1);
        else if (uiRef.current.level === 'system') backToGalaxy();
        else setObjId(-1);
      }
      if (k === '+' || k === '=') zoomAt(size.w / 2, size.h / 2, 1.6);
      if (k === '-') zoomAt(size.w / 2, size.h / 2, 1 / 1.6);
      if (e.key === 'PageUp') zoomAt(size.w / 2, size.h / 2, 12);
      if (e.key === 'PageDown') zoomAt(size.w / 2, size.h / 2, 1 / 12);
      if (k === 'f') { const c = activeCam(); c.tz = uiRef.current.level === 'system' ? fitZoom(size.w, size.h, 6) : c.tz * 2; c.tx = c.x; c.ty = c.y; c.ease = true; }
    };
    const up = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); if (e.key === 'Shift') keys.delete('shift'); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  /* ---------- UI ---------- */
  const obj = objId >= 0 ? g.planets[objId] : null;
  const explored = obj ? me.explored[obj.sys] : me.explored[sysId];
  const myCols = g.planets.filter(q => q.owner === 0);
  const myShips = g.ships.filter(s => s.owner === 0);
  const cp = controlledPop(g, 0);
  const sys = g.systems[sysId];

  function buyShip(t: ShipType) {
    const at = obj && obj.owner === 0 ? obj : myCols[0];
    if (!at) return msg('Немає колонії для верфі');
    if (me.money < SHIPDEF[t].cost) return msg('Недостатньо кредитів');
    me.money -= SHIPDEF[t].cost; spawnShip(g, 0, t, at.id); msg(`${SHIPDEF[t].name} збудовано на ${at.name}`);
  }
  function reset() {
    const ng = newGame(Math.floor(Math.random() * 1e9));
    gRef.current = ng;
    const b = galaxyBounds(ng);
    const W = size.w, H = size.h;
    const z = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0)) * 0.92;
    galRef.current = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z, tx: (b.x0 + b.x1) / 2, ty: (b.y0 + b.y1) / 2, tz: z, ease: false };
    setLevel('galaxy'); setObjId(-1); setSysId(0); setSelShip(-1); setSpeed(1); followRef.current = -1;
  }

  const hoverInfo = () => {
    if (!hover) return null;
    if (hover.kind === 'star') {
      const s = g.systems[hover.id];
      return { title: s.name, sub: `${s.spec} · ${lyFmt(s.distLy)} від Сонця · ${me.explored[s.id] ? `${s.planets.length} план.` : 'не досліджено'}` };
    }
    const p = g.planets[hover.id];
    return { title: p.name, sub: `${TAG_DESC[p.tags] || p.tags} · ${auFmt(orbitA(g, p))} а.о.${p.colony ? ` · ${popFmt(p.colony.pop)}` : ''}` };
  };
  const hi = hoverInfo();

  return (
    <div className="h-screen w-screen flex flex-col bg-[#05070d] text-slate-200 text-sm overflow-hidden select-none">
      <div className="flex items-center gap-4 px-3 py-2 bg-[#0b1220]/95 border-b border-cyan-900/40 flex-wrap">
        <div className="font-bold text-cyan-300 tracking-wider">✦ ГАЛАКТИЧНИЙ РИНОК</div>
        <div className="text-yellow-300">💰 {fmt(me.money)} кр</div>
        <div>📅 День {g.day}</div>
        <div title="Технологічний рівень та очки досліджень">🔬 Тех {me.tech} · {fmt(me.rp)}/{fmt(SINGULARITY)}</div>
        <div title="Частка населення галактики під контролем (60% = перемога)">👑 Контроль {(cp * 100).toFixed(1)}% / 60%</div>
        <div className="flex gap-1">
          {SPEEDS.map(s => <button key={s} onClick={() => setSpeed(s)} className={`px-2 py-0.5 rounded ${speed === s ? 'bg-cyan-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}>{s === 0 ? '⏸' : `${s}×`}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs">
          <button onClick={() => { backToGalaxy(); setObjId(-1); }} className={`px-2 py-0.5 rounded ${level === 'galaxy' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}>🌌 Галактика</button>
          <span className="text-slate-600">›</span>
          <button onClick={() => openSystem(sysId)} className={`px-2 py-0.5 rounded ${level === 'system' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}>☀ {sys.name}</button>
          {obj && <><span className="text-slate-600">›</span>
            <button className="px-2 py-0.5 rounded bg-indigo-600">● {obj.name}</button></>}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative min-h-0">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}
              className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
            />

            {/* інфо про систему */}
            {level === 'system' && (
              <div className="absolute top-2 left-2 bg-black/60 rounded p-2 text-xs space-y-0.5 pointer-events-none max-w-[280px]">
                <div className="font-semibold text-cyan-200">{sys.name} <span className="text-slate-400 font-normal">{sys.spec}</span></div>
                <div>Маса {sys.starMass.toFixed(2)} M☉ · світність {sys.lum < 0.01 ? sys.lum.toExponential(1) : sys.lum.toFixed(2)} L☉{sys.giant ? ' · гігант' : ''}</div>
                <div>Відстань від Сонця: {lyFmt(sys.distLy)}</div>
                <div>{sys.planets.length ? bodyCounts(g, sysId) : 'планет і карликових планет немає'}</div>
                <div>Придатна зона: {(0.95 * Math.sqrt(sys.lum)).toFixed(2)}–{(1.37 * Math.sqrt(sys.lum)).toFixed(2)} а.о. · снігова лінія {(2.7 * Math.sqrt(sys.lum)).toFixed(2)} а.о.</div>
                {sys.belts.length > 0 && <div className="text-amber-200/80">{sys.belts.map(b => `${b.label ?? 'пиловий пояс'}: ${auFmt(b.a[0])}–${auFmt(b.a[1])} а.о.`).join(' · ')}</div>}
                <div className={sys.piracy > 0.5 ? 'text-red-400' : ''}>☠ Піратство: {(sys.piracy * 100).toFixed(0)}% · ваші фрегати: {warships(g, 0, sysId)}</div>
                {!me.explored[sysId] && <div className="text-amber-400">Не досліджено — відправте розвідника</div>}
              </div>
            )}

            {/* керування камерою */}
            <div className="absolute top-2 right-2 flex flex-col gap-1">
              <div className="flex gap-1 bg-black/50 rounded p-1">
                <button title="Наблизити (＋ або колесо)" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.6)} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700">＋</button>
                <button title="Віддалити (− або колесо)" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.6)} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700">−</button>
                <button title="Наблизити у 12 разів (Shift+колесо)" onClick={() => zoomAt(size.w / 2, size.h / 2, 12)} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-xs">⇈</button>
                <button title="Показати всю систему / карту (F)" onClick={() => {
                  if (level === 'system') fitSystem();
                  else { const b = galaxyBounds(g); galRef.current.tz = Math.min(size.w / (b.x1 - b.x0), size.h / (b.y1 - b.y0)) * 0.92; galRef.current.tx = (b.x0 + b.x1) / 2; galRef.current.ty = (b.y0 + b.y1) / 2; galRef.current.ease = true; }
                }} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700">⤢</button>
                <button title="До Сонця" onClick={() => { backToGalaxy(); flyGalaxyTo(0, 0, 14); }} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700">⌂</button>
              </div>
              <div className="flex gap-1 bg-black/50 rounded p-1">
                <button title="Карта галактики" onClick={() => backToGalaxy()} className={`w-7 h-7 rounded ${level === 'galaxy' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}>🌌</button>
                <button title="Карта системи" onClick={() => openSystem(sysId)} className={`w-7 h-7 rounded ${level === 'system' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}>🪐</button>
              </div>
            </div>

            {hi && hover && (
              <div className="absolute bg-black/80 border border-cyan-900 rounded px-2 py-1 text-xs pointer-events-none" style={{ left: hover.x + 14, top: hover.y + 10 }}>
                <div className="text-cyan-200 font-semibold">{hi.title}</div>
                <div className="text-slate-400">{hi.sub}</div>
              </div>
            )}

            {toast && <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-cyan-900/90 px-4 py-2 rounded shadow">{toast}</div>}

            <div className="absolute bottom-2 left-2 text-[11px] text-slate-400/80 bg-black/40 rounded px-2 py-1 pointer-events-none">
              тягніть мишею — панорама · колесо — зум · клік — вибір · подвійний клік — наблизити · Esc — назад · WASD — рух
            </div>

            {g.winner && <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="bg-[#0b1220] border border-cyan-700 rounded-xl p-8 text-center max-w-md">
                <div className="text-3xl mb-2">{g.winner.f === 0 ? '🏆 ПЕРЕМОГА' : '💀 ПОРАЗКА'}</div>
                <div className="text-lg" style={{ color: g.factions[g.winner.f].color }}>{g.factions[g.winner.f].name}</div>
                <div className="text-slate-400 mb-4">{g.winner.how}</div>
                <button className="bg-cyan-600 px-4 py-2 rounded" onClick={reset}>Нова гра</button>
              </div></div>}
          </div>

          <div className="h-52 bg-[#0b1220] border-t border-cyan-900/40 flex flex-col">
            <div className="flex gap-1 px-2 pt-1">
              {([['help', '❓ Як грати'], ['log', '📜 Журнал'], ['ships', `🚀 Флот (${myShips.length})`], ['factions', '🏛 Фракції']] as const).map(([k, n]) =>
                <button key={k} onClick={() => setBottom(k)} className={`px-3 py-0.5 rounded-t ${bottom === k ? 'bg-slate-700' : 'bg-slate-900 text-slate-400'}`}>{n}</button>)}
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-1 bg-slate-900/50 text-xs">
              {bottom === 'log' && g.log.map((l, i) => <div key={i} style={{ color: l.c }}>[д.{l.d}] {l.t}</div>)}
              {bottom === 'help' && <div className="space-y-1 text-slate-300">
                <p><b className="text-cyan-300">Навігація:</b> карта вільна — тягніть мишею, зум колесом, подвійний клік наближає до зорі або планети. Режими: 🌌 галактика (масштаб — світлові роки) та 🪐 система (масштаб — астрономічні одиниці). ⌂ повертає до Сонця, ⤢ показує об’єкт повністю.</p>
                <p><b className="text-cyan-300">Масштаб:</b> відстані реальні. Сонце → Проксима Центавра — 4.2 св. роки, до Веґи 25, до Регула 79. Стрибок між зорями коштує <b>12 год/св. рік</b> для вантажника (розвідник 6, рудовоз 20). Усередині системи корабель іде 0.3–1.2 а.о. за добу, тому Земля → Юпітер ≈ 7 діб, Земля → Нептун ≈ 50 діб.</p>
                <p><b className="text-cyan-300">Цикл гри:</b> розвідник досліджує системи → обери планету → «Розвиток» → аванпост → видобуток і виробництво → вантажники торгують → імпорт від тебе створює <b>торгову залежність</b> → тарифи, ембарго, перевороти, анексія.</p>
                <p><b className="text-cyan-300">Зорі без планет:</b> трапляються часто — там лише пилові пояси. Розвідник може долетіти до самої зорі (клік по зорі на карті системи) і підтвердити, що планет немає.</p>
                <p><b className="text-cyan-300">Масштаб тіл:</b> розміри справжні. Поки тіло на екрані менше кількох пікселів, воно малюється читабельною іконкою, але щойно ви наближаєтесь — планета, супутник чи астероїд <b>ростуть до розмірів екрана</b>. Глибина зуму — до <b>~75 метрів на піксель</b> (2×10⁹ px/а.о.): на такому масштабі Фобос і Деймос видно як справжні брили з кратерами. Керування: колесо — плавно, <b>Shift+колесо</b> або <b>PageUp/PageDown</b> — стрибками ×12, кнопка 🔍 «Роздивитися» в панелі тіла або <b>подвійний клік</b> — одразу до тіла, 🛰 «Супутники» — уся система супутників.</p>
                <p><b className="text-cyan-300">Спрайти тіл:</b> астероїди й дрібні супутники малюються згенерованими спрайтами (5 родин: камʼяні, темні, металеві, крижані, іржаві) — вони обертаються, мають кратери й неправильний силует. Карликові планети, що не досягли гідростатичної рівноваги, малюються витягнутими еліпсоїдами (як Гаумеа). Планети, газові гіганти й великі супутники у наближенні показують процедурну поверхню: континенти й полярні шапки, пояси хмар із Великою Червоною Плямою, кратерні поля.</p>
                <p><b className="text-cyan-300">Форма тіл:</b> радіус, за якого гравітація перемагає міцність матеріалу («картопляний радіус», potato radius) — близько <b>200 км для крижаних</b> і <b>300 км для камʼяних</b> тіл (Lineweaver &amp; Norman, 2010). Дрібніші тіла лишаються безформними «картоплинами»: Фобос, Деймос, Амальтея, Гіперіон, Пак. На карті вони малюються як неправильні астероїди, і чим менше тіло — тим горбистіше.</p>
                <p><b className="text-cyan-300">Сонячна система:</b> 8 планет, 9 карликових планет (Церера, Плутон, Гаумеа, Макемаке, Ерида, Гонггонг, Кваоар, Орк, Гігіея), найбільші астероїди (Веста, Паллада, Юнона, Психея, Європа, Інтерамнія), головний пояс астероїдів із люками Кірквуда, троянці Юпітера L4/L5, пояс Койпера та розсіяний диск. Зони: Внутрішня · Пояс астероїдів · Зовнішня · Койпер.</p>
                <p><b className="text-cyan-300">Перемога:</b> 60% населення галактики під контролем, або {fmt(SINGULARITY)} очок науки (сингулярність), або 70% колоній у власності.</p>
              </div>}
              {bottom === 'ships' && <div>
                <div className="flex gap-1 flex-wrap mb-1">
                  {(Object.keys(SHIPDEF) as ShipType[]).map(t => <button key={t} onClick={() => buyShip(t)} className="bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded">{SHIPDEF[t].icon} {SHIPDEF[t].name} — {fmt(SHIPDEF[t].cost)} · {SHIPDEF[t].lyh} год/св.р</button>)}
                </div>
                <table className="w-full"><tbody>
                  {myShips.map(s => <tr key={s.id} onClick={() => focusShip(s)} className={`cursor-pointer hover:bg-slate-800 ${selShip === s.id ? 'bg-slate-800' : ''}`}>
                    <td>{SHIPDEF[s.type].icon} {s.name}</td>
                    <td>{s.t1 > g.time ? `→ ${placeName(g, shipPlace(s, 'to'))} (${eta(g, s).toFixed(1)} д)` : `біля ${placeName(g, shipPlace(s, 'at'))}`}</td>
                    <td>{s.amt > 0 ? `${GOOD_ICON[s.good]} ${s.amt}` : ''}</td>
                    <td className={s.hp < 60 ? 'text-red-400' : ''}>❤ {s.hp.toFixed(0)}</td>
                    <td className={s.profit >= 0 ? 'text-green-400' : 'text-red-400'}>{s.type !== 'scout' && s.type !== 'war' ? fmt(s.profit) : ''}</td>
                    <td>{s.route ? '🔁 маршрут' : s.type === 'war' ? 'охорона' : s.type === 'scout' ? 'авторозвідка' : '🤖 автоторгівля'}</td>
                  </tr>)}
                </tbody></table>
              </div>}
              {bottom === 'factions' && <table className="w-full"><thead><tr className="text-slate-500"><td>Фракція</td><td>Характер</td><td>Кредити</td><td>Колонії</td><td>Флот</td><td>Тех</td><td>Контроль</td></tr></thead><tbody>
                {g.factions.map(f => <tr key={f.id} style={{ color: f.color }}><td>{f.name}</td><td>{f.persona}</td><td>{fmt(f.money)}</td><td>{g.planets.filter(q => q.owner === f.id).length}</td><td>{g.ships.filter(s => s.owner === f.id).length}</td><td>{f.tech}</td><td>{(controlledPop(g, f.id) * 100).toFixed(1)}%</td></tr>)}
              </tbody></table>}
            </div>
          </div>
        </div>

        {/* ПРАВА ПАНЕЛЬ */}
        <div className="w-[430px] bg-[#0b1220] border-l border-cyan-900/40 overflow-y-auto p-3 space-y-3">
          {selShip >= 0 && (() => {
            const s = g.ships.find(x => x.id === selShip); if (!s) return null;
            const mk = g.planets.filter(q => q.colony && me.explored[q.sys]);
            const target: Place = obj ? planetPlace(obj) : starPlace(sysId);
            return <ShipPanel s={s} g={g} mk={mk} onClose={() => setSelShip(-1)} msg={msg} target={target} targetLabel={placeName(g, target)} />;
          })()}

          {level === 'galaxy' && <GalaxyPanel g={g} selId={sysId} onPick={id => { setSysId(id); setObjId(-1); flyGalaxyTo(g.systems[id].x, g.systems[id].y); }} onOpen={id => openSystem(id)} />}

          {level === 'system' && <StarCard g={g} id={sysId} />}

          {level === 'system' && <div className="space-y-1">
            <div className="text-xs text-slate-400">Об’єкти системи (клік — обрати й наблизити до системи супутників):</div>
            <div className="flex gap-1 flex-wrap">
              {ZONES.map(([name, _rad], i) => {
                const cnt = sys.planets.filter(id => zoneOf(g.planets[id].a) === i).length;
                const has = cnt > 0 || sys.belts.some(b => zoneOf((b.a[0] + b.a[1]) / 2) === i);
                return has ? <button key={name} onClick={() => fitZone(zoneRadius(i))} title={`Показати зону: ${name}`}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]">{zoneLabel(sysId, i)} <span className="text-slate-500">{cnt || ''}</span></button> : null;
              })}
              <button onClick={() => fitSystem()} title="Показати всю систему, разом із поясами" className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px]">уся система</button>
            </div>
            {sys.planets.length === 0 && <div className="text-xs text-amber-300/80">Обʼєктів немає — тільки пилові пояси. Таких зір у галактиці чимало, і розвідник може долетіти до самої зорі.</div>}
            {[0, 1, 2, 3].map(zone => {
              const items = sys.planets.map(id => g.planets[id]).filter(q => zoneOf(q.a) === zone).sort((x, y) => x.a - y.a);
              if (!items.length) return null;
              const hasBelts = sys.belts.some(b => zoneOf((b.a[0] + b.a[1]) / 2) === zone);
              return <div key={zone}>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-1">{zoneLabel(sysId, zone)}{hasBelts ? ' · пояс дрібних тіл' : ''}</div>
                {items.map(q => {
                  const irr = isIrregular(q);
                  const kind = bodyKind(q);
                  return <div key={q.id} className={`cursor-pointer hover:bg-slate-800 rounded px-1 py-1 flex items-center gap-2 ${objId === q.id ? 'bg-slate-800' : ''}`} onClick={() => focusPlanet(q.id)}>
                    <span style={{ color: TAG_COLOR[q.tags] }}>{irr ? '⬟' : '●'}</span>
                    <span className="flex-1 truncate">{me.explored[sysId] ? q.name : 'Невідомий об’єкт'}
                      <span className="text-[10px] text-slate-500 ml-1">{kind}{irr ? ' · неправильна форма' : ''}</span></span>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">
                      {auFmt(q.a)} а.о. · {q.colony ? `${popFmt(q.colony.pop)}${q.owner >= 0 ? ` · ${g.factions[q.owner].short}` : ' · незалежна'}` : q.moons.length ? `${q.moons.length} супутн.` : `${(q.habit * 100).toFixed(0)}% придатн.`}
                    </span>
                  </div>;
                })}
              </div>;
            })}
          </div>}

          {level === 'system' && obj && <PlanetPanel g={g} p={obj} explored={explored} tab={tab} setTab={setTab} msg={msg} setObj={id => focusPlanet(id)} inspect={inspectBody} />}
        </div>
      </div>
    </div>
  );
}

/* ================== ПАНЕЛІ ================== */

function StarCard({ g, id }: { g: Game; id: number }) {
  const s = g.systems[id];
  const me = g.factions[0];
  const ex = me.explored[id];
  return <div className="border border-cyan-900/60 rounded p-2 bg-slate-900/40 text-xs space-y-0.5">
    <div className="text-base font-semibold" style={{ color: starTint(s.starClass, s.giant) }}>
      ★ {s.name} <span className="text-slate-400 text-xs font-normal">{s.spec}</span>
      {s.real && <span className="ml-2 text-[10px] bg-slate-700 rounded px-1" title="Реальна зоря з каталогу">реальна зоря</span>}
    </div>
    {s.note && <div className="text-slate-400 italic">{s.note}</div>}
    <div>Маса {s.starMass.toFixed(2)} M☉ · світність {s.lum < 0.01 ? s.lum.toExponential(1) : s.lum.toFixed(2)} L☉</div>
    <div>Відстань від Сонця: <b>{lyFmt(s.distLy)}</b> · клас {s.starClass}</div>
    <div>Придатна зона: {(0.95 * Math.sqrt(s.lum)).toFixed(3)}–{(1.37 * Math.sqrt(s.lum)).toFixed(3)} а.о. · снігова лінія {(2.7 * Math.sqrt(s.lum)).toFixed(3)} а.о.</div>
    <div>{ex ? bodyCounts(g, id) : 'Об’єктів: ?'}</div>
    {s.belts.length > 0 && <div className="text-amber-200/80">{s.belts.map(b => `${b.label ?? 'пиловий пояс'} (${auFmt(b.a[0])}–${auFmt(b.a[1])} а.о.)`).join(' · ')}</div>}
    <div className={s.piracy > 0.5 ? 'text-red-400' : ''}>☠ Піратство {(s.piracy * 100).toFixed(0)}% · фрегати {warships(g, 0, id)}</div>
    {!ex && <div className="text-amber-400">Система не досліджена — деталі невідомі.</div>}
  </div>;
}

function GalaxyPanel({ g, selId, onPick, onOpen }: { g: Game; selId: number; onPick: (id: number) => void; onOpen: (id: number) => void }) {
  const me = g.factions[0];
  const list = [...g.systems].sort((a, b) => a.distLy - b.distLy);
  const known = list.filter(s => me.explored[s.id]).length;
  return <div>
    <div className="text-lg font-semibold text-cyan-200 mb-1">Околиця Сонця — {g.systems.length} зір</div>
    <div className="text-xs text-slate-400 mb-1">Реальні зорі каталогу + вигадані системи. Досліджено {known}/{list.length}. Клік — обрати, кнопка ▶ — відкрити карту системи.</div>
    <div className="text-[10px] text-slate-500 mb-2">Карта: галактична площина, вид з півночі. Масштаб 1 клітинка сітки — 10 св. років.</div>
    <div className="space-y-0.5">
      {list.map(s => {
        const ex = me.explored[s.id];
        const cols = g.planets.filter(p => p.sys === s.id && p.colony);
        return <div key={s.id} onClick={() => onPick(s.id)}
          className={`cursor-pointer rounded px-1 py-0.5 flex items-center gap-2 ${selId === s.id ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
          <span style={{ color: starTint(s.starClass, s.giant) }}>{s.giant ? '✹' : '★'}</span>
          <span className="flex-1 truncate">{s.name} <span className="text-[10px] text-slate-500">{s.spec}</span></span>
          <span className="text-[10px] text-slate-500 w-[68px] text-right">{lyFmt(s.distLy)}</span>
          <span className="text-[10px] text-slate-500 w-[62px] text-right">{ex ? `${s.planets.length} план.` : 'невідомо'}</span>
          <span className="flex -space-x-1 w-[42px]">{cols.slice(0, 4).map(p => <span key={p.id} className="w-2 h-2 rounded-full" style={{ background: p.owner >= 0 ? g.factions[p.owner].color : '#ddd' }} />)}</span>
          <button onClick={e => { e.stopPropagation(); onOpen(s.id); }} className="text-cyan-300 hover:text-white px-1" title="Відкрити карту системи">▶</button>
        </div>;
      })}
    </div>
  </div>;
}

function ShipPanel({ s, g, mk, onClose, msg, target, targetLabel }: { s: Ship; g: Game; mk: Planet[]; onClose: () => void; msg: (t: string) => void; target: Place; targetLabel: string }) {
  const [a, setA] = useState(s.route?.a ?? mk[0]?.id ?? 0);
  const [b, setB] = useState(s.route?.b ?? mk[1]?.id ?? 0);
  const [gd, setGd] = useState(s.route?.good ?? 4);
  const mine = s.owner === 0;
  const place = shipPlace(s, 'at');
  return <div className="border border-cyan-800 rounded p-2 bg-slate-900/60">
    <div className="flex justify-between"><b style={{ color: g.factions[s.owner].color }}>{SHIPDEF[s.type].icon} {s.name}</b><button onClick={onClose}>✕</button></div>
    <div className="text-xs text-slate-400">Вантаж {s.cap} · швидкість стрибка {hoursPerLy(s.type)} год/св. р · {SHIPDEF[s.type].au} а.о./добу · корпус {s.hp.toFixed(0)}%</div>
    <div className="text-xs text-slate-400">{s.t1 > g.time ? `→ ${placeName(g, shipPlace(s, 'to'))}, лишилось ${eta(g, s).toFixed(1)} діб` : `біля ${placeName(g, place)}`}</div>
    {mine && <button className="mt-2 bg-cyan-800 hover:bg-cyan-700 px-2 py-1 rounded w-full text-xs" onClick={() => {
      if (s.t1 > g.time && !confirm('Корабель у польоті — змінити курс?')) return;
      setCourse(g, s, target); msg(`${s.name} прямує до ${targetLabel}`);
    }}>Курс → {targetLabel}</button>}
    {mine && s.type === 'war' && <div className="mt-1 text-[10px] text-slate-500">Фрегат у системі знижує піратство на 0.4%/добу — тримайте його біля важливих ринків.</div>}
    {mine && s.type !== 'war' && s.type !== 'scout' && <div className="mt-2 space-y-1 text-xs">
      <div className="font-semibold">Торговий маршрут (А → Б)</div>
      <select className="w-full bg-slate-800 p-1" value={a} onChange={e => setA(+e.target.value)}>{mk.map(q => <option key={q.id} value={q.id}>А: {q.name}</option>)}</select>
      <select className="w-full bg-slate-800 p-1" value={b} onChange={e => setB(+e.target.value)}>{mk.map(q => <option key={q.id} value={q.id}>Б: {q.name}</option>)}</select>
      <select className="w-full bg-slate-800 p-1" value={gd} onChange={e => setGd(+e.target.value)}>{GOODS.map((n, i) => <option key={i} value={i}>{GOOD_ICON[i]} {n} (А: {price(g.planets[a], i).toFixed(0)} → Б: {price(g.planets[b], i).toFixed(0)})</option>)}</select>
      <div className="text-slate-500">Час рейсу А→Б: {(() => { const pa = g.planets[a], pb = g.planets[b]; const d = Math.hypot(pa.sys === pb.sys ? 0 : g.systems[pa.sys].x - g.systems[pb.sys].x, pa.sys === pb.sys ? 0 : g.systems[pa.sys].y - g.systems[pb.sys].y); return pa.sys === pb.sys ? 'у межах системи' : `${((d * SHIPDEF[s.type].lyh) / 24).toFixed(1)} діб (${d.toFixed(1)} св. р.)`; })()}</div>
      <div className="flex gap-1">
        <button className="flex-1 bg-cyan-700 py-1 rounded" onClick={() => { if (a === b) return msg('А і Б однакові'); s.route = { a, b, good: gd }; s.wait = 0; msg('Маршрут встановлено'); }}>Встановити</button>
        <button className="flex-1 bg-slate-700 py-1 rounded" onClick={() => { s.route = null; msg('Автоторгівля'); }}>🤖 Авто</button>
      </div>
    </div>}
  </div>;
}
function Bar({ v, color = '#38d9ff' }: { v: number; color?: string }) {
  return <div className="h-1.5 bg-slate-800 rounded"><div className="h-full rounded" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} /></div>;
}

function PlanetPanel({ g, p, explored, tab, setTab, msg, setObj, inspect }: { g: Game; p: Planet; explored: boolean; tab: string; setTab: (t: 'info' | 'market' | 'infl' | 'dev') => void; msg: (t: string) => void; setObj: (id: number) => void; inspect: (id: number) => void }) {
  const me = g.factions[0];
  if (!explored) return <div>
    <div className="text-lg">{p.name}</div>
    <div className="text-amber-400 text-xs">Система не досліджена. Відправте розвідника (він працює автоматично).</div>
    <button className="mt-2 bg-slate-800 px-2 py-1 rounded" onClick={() => setObj(p.id)}>Оновити</button>
  </div>;
  const [showSmall, setShowSmall] = useState(false);
  const c = p.colony;
  const lv = inflLevel(g, p, 0);
  const ownerName = p.owner >= 0 ? g.factions[p.owner].name : c ? 'Незалежна цивілізація' : 'Ніхто';
  const bigMoons = p.moons.map(m => g.planets[m]).filter(m => m.radius > 220);
  const smallMoons = p.moons.length - bigMoons.length;
  return <div className="space-y-2">
    <div>
      <div className="text-lg font-semibold flex items-center gap-2">
        <span style={{ color: TAG_COLOR[p.tags] }}>●</span>{p.name}
        <span className="text-xs bg-slate-700 px-1.5 rounded">{p.tags}</span>
        {p.colony && <span className="text-xs px-1.5 rounded" style={{ background: p.owner >= 0 ? g.factions[p.owner].color + '44' : '#ffffff22' }}>{colonyLevelLabel(p.colony!.pop)}</span>}
      </div>
      <div className="text-slate-400 text-xs">{TAG_DESC[p.tags] || p.tags} · Придатність {(p.habit * 100).toFixed(0)}% · <span style={{ color: p.owner >= 0 ? g.factions[p.owner].color : '#ddd' }}>{ownerName}</span></div>
      <div className="text-slate-400 text-xs">Орбіта {auFmt(orbitA(g, p))} а.о. від зорі {g.systems[p.sys].name} · період {p.period < 10 ? p.period.toFixed(2) : p.period.toFixed(0)} діб{p.parent >= 0 && <> · навколо {g.planets[p.parent].name} ({fmt(p.a)} км)</>}</div>
      {p.parent >= 0 && <div className="text-xs cursor-pointer text-cyan-400" onClick={() => setObj(p.parent)}>↑ Супутник планети {g.planets[p.parent].name} — показати планету</div>}
      {p.moons.length > 0 && <div className="text-xs flex gap-1 flex-wrap mt-1">
        Супутники ({p.moons.length}):
        {bigMoons.map(m => <span key={m.id} className="cursor-pointer text-cyan-400 hover:underline" onClick={() => setObj(m.id)}>{m.name}[{m.tags}]</span>)}
        {smallMoons > 0 && <span className="cursor-pointer text-slate-400 hover:text-cyan-300" title="Показати дрібні супутники" onClick={() => setShowSmall(v => !v)}>
          {showSmall ? '— згорнути дрібні' : `+${smallMoons} дрібних астероїдних (показати)`}</span>}
        {showSmall && p.moons.map(m => g.planets[m]).filter(m => m.radius <= 220).map(m => (
          <span key={m.id} className="cursor-pointer text-slate-400 hover:text-cyan-300" onClick={() => setObj(m.id)}>
            {m.name} <span className="text-[9px]">({fmt(m.radius)} км{isIrregular(m) ? ', ⬟' : ''})</span>
          </span>
        ))}
      </div>}
    </div>
    <div className="flex gap-1">
      <button className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs" title="Наблизити камеру до самого тіла (видно диск, рельєф, форму)" onClick={() => inspect(p.id)}>🔍 Роздивитися</button>
      {(p.parent >= 0 ? g.planets[p.parent] : p).moons.length > 0 && <button className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs" title="Показати всю систему супутників" onClick={() => setObj((p.parent >= 0 ? g.planets[p.parent] : p).id)}>🛰 Супутники</button>}
    </div>
    <div className="flex gap-1">
      {([['dev', 'Розвиток'], ['market', 'Ринок'], ['infl', 'Вплив'], ['info', 'Фізика']] as const).map(([k, n]) =>
        <button key={k} onClick={() => setTab(k)} className={`flex-1 py-1 rounded ${tab === k ? 'bg-cyan-700' : 'bg-slate-800 hover:bg-slate-700'}`}>{n}</button>)}
    </div>

    {tab === 'info' && <div className="text-xs grid grid-cols-2 gap-x-3 gap-y-0.5">
      {([
        ['Маса', `${p.mass.toFixed(4)} M⊕`], ['Радіус', `${fmt(p.radius)} км`], ['Гравітація', `${p.g.toFixed(2)} g`], ['Густина', `${p.density.toFixed(2)} г/см³`],
        ['Піввісь', p.parent >= 0 ? `${fmt(p.a)} км` : `${p.a.toFixed(3)} а.о.`], ['Ексцентриситет', p.e.toFixed(4)], ['Нахил орбіти', `${p.inc.toFixed(1)}°`], ['Період', `${p.period.toFixed(p.period < 10 ? 3 : 0)} діб`],
        ['Доба', `${p.rot.toFixed(1)} год${p.locked ? ' (захоплення)' : ''}`], ['Нахил осі', `${p.tilt.toFixed(1)}°`], ['T рівноважна', `${p.teq} K`], ['T поверхні', `${p.temp} K (${(p.temp - 273).toFixed(0)}°C)`],
        ['Тиск', isFinite(p.pressure) ? `${p.pressure < 0.01 ? p.pressure.toExponential(1) : p.pressure.toFixed(3)} атм` : 'Немає поверхні'], ['Атмосфера', p.atmo], ['Токсичність', p.toxic ? 'Так' : 'Придатна для дихання'], ['Погода', p.weather],
        ['Гідросфера', `${p.hydro}${p.hydroCov ? ` (${(p.hydroCov * 100).toFixed(0)}%)` : ''}`], ['Кора', p.crust], ['Магнітосфера', p.magnet.toFixed(2)], ['Радіація', `${(p.radiation * 100).toFixed(0)}%`],
        ['Тектоніка', p.tectonics], ['Припливний нагрів', p.parent >= 0 ? `${p.tidal.toFixed(3)} × Іо` : '—'], ['Резонанс', p.resonance || '—'], ['Біосфера', p.bio],
      ] as [string, string][]).map(([k, v]) => <div key={k} className="contents"><div className="text-slate-500">{k}</div><div>{v}</div></div>)}
      <div className="col-span-2 mt-2 font-semibold">Форма та гравітаційна рівновага</div>
      <div className="col-span-2">
        {(() => {
          const irr = irregularity(p);
          const lim = potatoRadius(p);
          const material = isIcy(p) ? `крижане (межа ~${POTATO_RADIUS_ICY_KM} км)` : `камʼяне (межа ~${POTATO_RADIUS_ROCKY_KM} км)`;
          if (p.triax) return <span className="text-cyan-300">
            Витягнутий еліпсоїд (тривісність ~{(p.triax * 100).toFixed(0)}%) — R = {fmt(p.radius)} км, доба {p.rot.toFixed(1)} год.
            Швидке обертання розтягує тіло: Гаумеа має осі 1050 × 840 × 537 км, тож попри розмір воно не стає кулею.
          </span>;
          return irr <= 0.02
            ? <span className="text-emerald-300">Куляста: R = {fmt(p.radius)} км перевищує «картопляний радіус» — гравітація перемагає міцність матеріалу. Тіло {material}.</span>
            : <span className={irr > 0.15 ? 'text-amber-300' : 'text-slate-300'}>
              {irr > 0.15 ? 'Неправильна форма («картоплина»)' : 'Проміжна форма'} — R = {fmt(p.radius)} км менше за «картопляний радіус» {lim} км (potato radius, Lineweaver & Norman 2010).
              Тіло {material}, сили міцності ще тримають його від округлення (як Фобос, Амальтея чи Гіперіон).
            </span>;
        })()}
      </div>
      <div className="col-span-2 mt-2 font-semibold">Ресурси</div>
      {(Object.keys(p.res) as ResKey[]).map(k => <div key={k} className="col-span-2 flex items-center gap-2"><span className="w-32">{RES_NAME[k]}</span><div className="flex-1"><Bar v={p.res[k] * 100} color="#e8b04a" /></div><span className="w-8 text-right">{(p.res[k] * 100).toFixed(0)}</span></div>)}
      {p.features.length > 0 && <div className="col-span-2 mt-1 text-amber-300">✧ {p.features.join(', ')}</div>}
    </div>}

    {tab === 'market' && (c ? <div className="text-xs">
      {p.tariffBy >= 0 && <div className="mb-1 text-amber-300">Тариф {(p.tariff * 100).toFixed(0)}% встановлено {g.factions[p.tariffBy].short}{p.embargo.some(Boolean) ? ` · ембарго: ${p.embargo.map((e, i) => e ? g.factions[i].short : '').filter(Boolean).join(', ')}` : ''}</div>}
      <table className="w-full"><thead><tr className="text-slate-500"><td>Товар</td><td>Склад</td><td>Попит</td><td>Ціна</td><td></td></tr></thead><tbody>
        {GOODS.map((n, i) => {
          const pr = price(p, i); const r = pr / BASE[i];
          return <tr key={i}><td>{GOOD_ICON[i]} {n}</td><td>{fmt(p.stock[i])}</td><td>{fmt(p.desired[i])}</td>
            <td className={r > 1.5 ? 'text-red-400' : r < 0.7 ? 'text-green-400' : ''}>{pr.toFixed(1)}</td>
            <td>{r > 2 ? '🔥 дефіцит' : r < 0.5 ? '📦 надлишок' : ''}</td></tr>;
        })}
      </tbody></table>
    </div> : <div className="text-slate-400 text-xs">Немає ринку — планета не заселена.</div>)}

    {tab === 'infl' && (c && p.owner < 0 ? <div className="text-xs space-y-2">
      <div>Ваш рівень: <b className="text-cyan-300">{lv} — {LEVEL_NAME[lv]}</b> · торгова залежність {(tradeDep(p, 0) * 100).toFixed(0)}%</div>
      {g.factions.map(f => <div key={f.id}>
        <div className="flex justify-between" style={{ color: f.color }}><span>{f.short} {p.proxy === f.id ? '(проксі)' : ''}</span><span>{p.infl[f.id].toFixed(1)} · L{inflLevel(g, p, f.id)} · торг {(tradeDep(p, f.id) * 100).toFixed(0)}%</span></div>
        <Bar v={p.infl[f.id]} color={f.color} />
      </div>)}
      <div className="grid grid-cols-3 gap-1 text-slate-400"><span>Культура {p.culture[0].toFixed(0)}</span><span>Медіа {p.media[0].toFixed(0)}</span><span>Інвест. {p.invest[0].toFixed(0)}</span><span>Флот {warships(g, 0, p.sys)}</span><span>Стабільн. {c.stab.toFixed(0)}</span></div>
      <div className="space-y-1">
        {ACTS.map(a => {
          const ok = lv >= a.lvl; const cost = actCost(p, a.id);
          return <button key={a.id} disabled={!ok} onClick={() => { const e = doAct(g, p, 0, a.id); msg(e || `${a.name}: виконано`); }}
            className={`w-full text-left px-2 py-1 rounded ${ok ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-900 text-slate-600'}`}>
            <div className="flex justify-between"><b>{a.name}</b><span>{cost ? `${fmt(cost)} кр` : ''} · L{a.lvl}+</span></div>
            <div className="text-[10px] text-slate-400">{a.desc}</div></button>;
        })}
      </div>
      <div className="text-[10px] text-slate-500">Рівні: 1 контакт · 2 партнер (15) · 3 залежність (30) · 4 сателіт (45) · 5 проксі (60) · 6 анексія</div>
    </div> : <div className="text-slate-400 text-xs">{p.owner === 0 ? 'Це ваша планета (рівень 6 — анексія).' : p.owner > 0 ? `Належить ${g.factions[p.owner].name}. Витісняйте їх із ринків довкола.` : 'Немає населення — вплив неможливий. Колонізуйте!'}</div>)}

    {tab === 'dev' && <div className="text-xs space-y-2">
      {!c && (canColonize(g, p, 0) ? <button className="w-full bg-emerald-700 hover:bg-emerald-600 py-2 rounded" onClick={() => msg(colonize(g, p, 0) ? 'Аванпост засновано!' : 'Недостатньо кредитів')}>
        🚀 Заснувати {p.tags.includes('D') ? 'орбітальну станцію' : p.parent >= 0 ? 'аванпост на супутнику' : 'аванпост'} — {fmt(colonizeCost(g, p, 0))} кр</button>
        : <div className="text-red-400 text-xs">Колонізація неможлива{p.roche ? ' — супутник на межі Роша, орбіта нестабільна' : ''}.</div>)}
      {c && <>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <div>Рівень: <b>{colonyLevelLabel(p.colony!.pop)}</b></div><div>Населення: <b>{popFmt(c.pop)}</b></div>
          <div>Ємність K: {popFmt(c.K)}</div><div>Зайнятість: {(c.employ * 100).toFixed(0)}%</div>
          <div>Енергія: <span className={c.energy < 1 ? 'text-red-400' : ''}>{(c.energy * 100).toFixed(0)}%</span></div><div>Забруднення: {c.pollution.toFixed(0)}</div>
          <div>Їжа/вода/O₂: {(c.foodSat * 100).toFixed(0)}%</div><div>Щастя: {c.happy.toFixed(0)}</div>
        </div>
        <div>Стабільність {c.stab.toFixed(0)}% {c.stab < 30 ? '⚠ бунти' : c.stab > 70 ? '✓ бонус +20%' : ''}<Bar v={c.stab} color={c.stab < 30 ? '#ff5252' : c.stab > 70 ? '#4ade80' : '#facc15'} /></div>
        <div className="font-semibold mt-2">Будівлі</div>
        {p.owner === 0 ? BUILD.map(b => {
          const n = c.b[b.id] || 0; const cost = buildCost(g, p, b.id); const weak = b.res && p.res[b.res] < 0.15;
          return <div key={b.id} className="flex items-center gap-1 bg-slate-800/60 rounded px-1 py-0.5">
            <div className="flex-1"><span className={weak ? 'text-slate-500' : ''}>{b.name}</span> <b>×{n}</b>
              <div className="text-[10px] text-slate-400">{Object.entries(b.inp).map(([k, v]) => `${GOOD_ICON[+k]}${v}`).join(' ')}{Object.keys(b.inp).length ? ' → ' : ''}{Object.entries(b.out).map(([k, v]) => `${GOOD_ICON[+k]}${v}`).join(' ')}{b.en > 0 ? ` ⚡+${b.en}` : b.en < 0 ? ` ⚡${b.en}` : ''}{b.housing ? ` 🏠+${b.housing}k` : ''}{b.res ? ` · ${RES_NAME[b.res]} ${(p.res[b.res] * 100).toFixed(0)}%` : ''}</div></div>
            {n > 0 && <button className="px-1.5 bg-slate-700 rounded hover:bg-slate-600" onClick={() => demolish(p, b.id)}>−</button>}
            <button className={`px-2 rounded ${me.money >= cost ? 'bg-cyan-700 hover:bg-cyan-600' : 'bg-slate-700 text-slate-500'}`} onClick={() => msg(build(g, p, 0, b.id) ? `${b.name} збудовано` : 'Недостатньо кредитів')}>+ {fmt(cost)}</button>
          </div>;
        }) : <div className="text-slate-400">{Object.entries(c.b).filter(([, n]) => n).map(([id, n]) => `${BMAP[id].name} ×${n}`).join(', ')}</div>}
      </>}
      <div className="text-[10px] text-slate-500">Орбіта: {orbitA(g, p).toFixed(3)} а.о. від зорі{p.parent >= 0 ? ` · відстань до планети ${fmt(p.a)} км` : ''} · сонячна стала {p.sys === 0 ? 1361 : Math.round(1361 * g.systems[p.sys].lum)} Вт/м²</div>
    </div>}
  </div>;
}

/** Клас тіла: для Сонячної системи — точний, для решти — за тегом */
function bodyKind(q: Planet) {
  if (q.kind === 'dwarf') return 'карликова планета';
  if (q.kind === 'asteroid') return 'астероїд';
  if (q.parent >= 0) return q.radius < 300 ? 'дрібний супутник' : 'супутник';
  if (q.tags.includes('D')) return 'газовий гігант';
  if (q.radius < 300) return 'мале тіло';
  return 'планета';
}

const colonyLevelLabel = (pop: number) => (pop < 1 ? 'Аванпост' : pop < 20 ? 'Поселення' : pop < 150 ? 'Колонія' : pop < 600 ? 'Місто' : 'Мегаполіс / Аркологія');

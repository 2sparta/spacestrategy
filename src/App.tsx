import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Game, Planet, newGame, dayTick, updateShips, GOODS, GOOD_ICON, BASE, price, level, LEVEL_NAME, colonyLevel, tradeDep,
  canColonize, colonize, colonizeCost, BUILD, BMAP, build, buildCost, demolish, ACTS, actCost, doAct, SHIPDEF, ShipType, spawnShip,
  RES_NAME, ResKey, controlledPop, SINGULARITY, warships, travelDays, orbitA,
} from './game';

const TAG_COLOR: Record<string, string> = { A: '#3fb6f5', AB: '#c9b36a', AC: '#2f6bff', AF: '#d97b3a', B: '#d9a05b', C: '#cfeeff', D: '#e8b77a', CD: '#7fb8ff', F: '#ff5a2a', E: '#b6ff3b', G: '#9a9a9a', I: '#55667a', 'S-F': '#ffd23a', 'S-C': '#dff4ff', 'S-G': '#9a9a9a', 'S-B': '#b8916a' };
const TAG_DESC: Record<string, string> = { A: 'Земний', AB: 'Сухий земний світ', AC: 'Океанічний світ', AF: 'Вулканічний земний', B: 'Пустельний', C: 'Кріогенний / водний', D: 'Газовий гігант', CD: 'Крижаний гігант', F: 'Вулканічний', E: 'Екстремальний', G: 'Карликова', I: 'Мандрівна', 'S-F': 'Вулканічний супутник (тип Іо)', 'S-C': 'Крижаний супутник (тип Європи)', 'S-G': 'Кам’янистий супутник', 'S-B': 'Пустельний супутник' };
const STAR_COLOR: Record<string, string> = { F: '#f4f1ff', G: '#ffe9a8', K: '#ffbf6b', M: '#ff7a59' };
const SPEEDS = [0, 1, 2, 4, 8];
const ZOOM_SYS = 2.2, ZOOM_PLANET = 8.5;
const fmt = (n: number) => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : n.toFixed(0);
const popFmt = (k: number) => k >= 1000 ? (k / 1000).toFixed(2) + ' млн' : k >= 1 ? k.toFixed(1) + ' тис' : Math.round(k * 1000) + ' осіб';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Hit = { x: number; y: number; r: number; kind: 'sys' | 'planet' | 'moon'; id: number };
type Level = 'galaxy' | 'system' | 'planet';

function moonOrbitR(g: Game, m: Planet) {
  const par = g.planets[m.parent];
  const aMax = Math.max(...par.moons.map(x => g.planets[x].a), 5000);
  return 3 + 30 * Math.log(1 + m.a / 3000) / Math.log(1 + aMax / 3000);
}

function worldPos(g: Game, p: Planet, time: number): [number, number] {
  const ang = p.phase + (2 * Math.PI * time) / p.period;
  if (p.parent < 0) {
    const s = g.systems[p.sys];
    const r = 12 + Math.sqrt(p.a) * 26;
    return [s.x + r * Math.cos(ang), s.y + r * Math.sin(ang) * (1 - p.e * 1.2)];
  }
  const [px, py] = worldPos(g, g.planets[p.parent], time);
  const r = moonOrbitR(g, p);
  return [px + r * Math.cos(ang), py + r * Math.sin(ang)];
}

function bodyR(p: Planet, S: number, zoom: number) {
  const trueR = (1.0 + 2.2 * Math.log10(1 + p.radius / 1500)) * S;
  const smallR = 2.2 + Math.log10(1 + p.radius / 900) * 3.0;
  const t = clamp((zoom - 2.6) / 3, 0, 1);
  return smallR * (1 - t) + Math.max(smallR, trueR) * t;
}

export default function App() {
  const gRef = useRef<Game>(newGame(Math.floor(Math.random() * 1e9)));
  const [, setTick] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [level0, setLevel0] = useState<Level>('planet');
  const [sysId, setSysId] = useState(() => gRef.current.planets.find(p => p.owner === 0)!.sys);
  const [objId, setObjId] = useState(() => gRef.current.planets.find(p => p.owner === 0)!.id);
  const [tab, setTab] = useState<'info' | 'market' | 'infl' | 'dev'>('dev');
  const [bottom, setBottom] = useState<'log' | 'ships' | 'factions' | 'help'>('help');
  const [toast, setToast] = useState('');
  const [selShip, setSelShip] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const hits = useRef<Hit[]>([]);
  const camRef = useRef({ x: 500, y: 350, z: 1 });
  const speedRef = useRef(speed); speedRef.current = speed;
  const stRef = useRef({ level: level0, sysId, objId, selShip }); stRef.current = { level: level0, sysId, objId, selShip };
  const g = gRef.current;
  const me = g.factions[0];
  const msg = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    const img = new Image();
    img.onload = () => { bgRef.current = img; };
    img.src = 'images/nebula.jpg';
  }, []);

  useEffect(() => {
    let last = performance.now(); let raf = 0; let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const gm = gRef.current;
      if (!gm.winner || speedRef.current) {
        gm.time += dt * 0.5 * speedRef.current;
        while (gm.time >= gm.day + 1) dayTick(gm);
        updateShips(gm);
      }
      draw();
      acc += dt; if (acc > 0.25) { acc = 0; setTick(t => t + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC — крок назад: планета → система → галактика
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stRef.current.level === 'planet') { setLevel0('system'); setObjId(-1); }
      else if (stRef.current.level === 'system') setLevel0('galaxy');
      else { setLevel0('system'); setSysId(stRef.current.sysId); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  function draw() {
    const cv = canvasRef.current; if (!cv) return;
    const par = cv.parentElement!; const W = par.clientWidth, H = par.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d')!; const gm = gRef.current; const st = stRef.current;
    const base = Math.min(W / 1000, H / 700);
    const cam = camRef.current;

    let tx = 500, ty = 350, tz = 1;
    if (st.level !== 'galaxy') { const s = gm.systems[st.sysId]; tx = s.x; ty = s.y; tz = ZOOM_SYS; }
    if (st.level === 'planet' && st.objId >= 0) {
      const [px, py] = worldPos(gm, gm.planets[st.objId], gm.time); tx = px; ty = py; tz = ZOOM_PLANET;
    }
    cam.x += (tx - cam.x) * 0.11; cam.y += (ty - cam.y) * 0.11; cam.z += (tz - cam.z) * 0.075;
    const S = base * cam.z;
    const X = (wx: number) => (wx - cam.x) * S + W / 2;
    const Y = (wy: number) => (wy - cam.y) * S + H / 2;

    // ---- фон ----
    c.fillStyle = '#05070d'; c.fillRect(0, 0, W, H);
    const bg = bgRef.current;
    if (bg) {
      const s2 = Math.max(W / bg.width, H / bg.height) * 1.12;
      const ox = -(bg.width * s2 - W) / 2 - (cam.x - 500) * 0.035;
      const oy = -(bg.height * s2 - H) / 2 - (cam.y - 350) * 0.035;
      c.globalAlpha = 0.6; c.drawImage(bg, ox, oy, bg.width * s2, bg.height * s2); c.globalAlpha = 1;
    } else {
      const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H));
      gr.addColorStop(0, '#0d1b2e'); gr.addColorStop(1, '#05070d'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    }
    for (let i = 0; i < 120; i++) {
      const x = ((i * 9301 + 49297) % 1000) / 1000 * W, y = ((i * 233280 + 7919) % 1000) / 1000 * H;
      c.fillStyle = `rgba(255,255,255,${0.1 + (i % 5) * 0.07})`; c.fillRect(x, y, 1, 1);
    }

    const H2: Hit[] = [];
    const f0 = gm.factions[0];

    // ---- шар галактики ----
    c.lineWidth = 1;
    if (cam.z < 1.8) {
      c.strokeStyle = 'rgba(90,130,190,0.07)';
      for (const a of gm.systems) for (const b of gm.systems) if (a.id < b.id && Math.hypot(a.x - b.x, a.y - b.y) < 430) {
        c.beginPath(); c.moveTo(X(a.x), Y(a.y)); c.lineTo(X(b.x), Y(b.y)); c.stroke();
      }
    }
    const sysStats: Record<number, { cnt: number[]; nat: number }> = {};
    for (const pl of gm.planets) {
      if (!pl.colony) continue;
      const q = (sysStats[pl.sys] ||= { cnt: new Array(gm.factions.length).fill(0), nat: 0 });
      if (pl.owner >= 0) q.cnt[pl.owner]++; else q.nat++;
    }
    for (const s of gm.systems) {
      const ex = f0.explored[s.id];
      const x = X(s.x), y = Y(s.y);
      const stat = sysStats[s.id] || { cnt: new Array(gm.factions.length).fill(0), nat: 0 };
      const pops = stat.cnt;
      const mx = Math.max(0, ...pops);
      if (mx > 0) {
        const dom = pops.indexOf(mx);
        c.fillStyle = gm.factions[dom].color + '22'; c.beginPath(); c.arc(x, y, 34 * Math.min(1, cam.z), 0, 7); c.fill();
        c.strokeStyle = gm.factions[dom].color + '77'; c.stroke();
      }
      if (s.piracy > 0.5 && ex) {
        c.strokeStyle = 'rgba(255,70,70,0.45)'; c.setLineDash([3, 4]);
        c.beginPath(); c.arc(x, y, 26 * Math.min(1, cam.z), 0, 7); c.stroke(); c.setLineDash([]);
      }
      c.fillStyle = ex ? STAR_COLOR[s.starClass] : '#3a4250';
      c.shadowColor = c.fillStyle; c.shadowBlur = ex ? 16 : 0;
      c.beginPath(); c.arc(x, y, Math.max(2.5, (4 + s.starMass * 3) * Math.min(1, cam.z * 0.8)), 0, 7); c.fill();
      c.shadowBlur = 0;
      if (cam.z < 2.6) {
        c.fillStyle = ex ? '#cfe3ff' : '#5a6475'; c.font = '12px sans-serif'; c.textAlign = 'center';
        c.fillText(ex ? s.name : '???', x, y + 22);
        if (ex) {
          const nat = stat.nat;
          c.fillStyle = '#8899aa'; c.font = '10px sans-serif';
          c.fillText(`${s.planets.length} планет${nat ? ` · ${nat} незалежних` : ''}`, x, y + 34);
        }
      }
      if (cam.z < 2.0) H2.push({ x, y, r: 22, kind: 'sys', id: s.id });
    }

    // ---- шар системи ----
    const a1 = clamp((cam.z - 1.12) / 0.45, 0, 1);
    const focusObj = st.level === 'planet' && st.objId >= 0 ? gm.planets[st.objId] : null;
    const camPlanet = focusObj ? (focusObj.parent >= 0 ? gm.planets[focusObj.parent] : focusObj) : null;
    if (a1 > 0 && st.level !== 'galaxy') {
      const sys = gm.systems[st.sysId];
      c.globalAlpha = a1;
      for (const pid of sys.planets) {
        const p = gm.planets[pid];
        const r = 12 + Math.sqrt(p.a) * 26;
        c.strokeStyle = 'rgba(120,160,220,0.16)';
        c.beginPath(); c.ellipse(X(sys.x), Y(sys.y), r * S, r * S * (1 - p.e * 1.2), 0, 0, 7); c.stroke();
      }
      c.textAlign = 'center';
      for (const pid of sys.planets) {
        const p = gm.planets[pid];
        const [wx, wy] = worldPos(gm, p, gm.time);
        const x = X(wx), y = Y(wy);
        const rad = bodyR(p, S, cam.z);
        drawBody(c, x, y, rad, p);
        if (p.colony) {
          c.strokeStyle = p.owner >= 0 ? gm.factions[p.owner].color : '#e8f4ff';
          c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, rad + 5, 0, 7); c.stroke(); c.lineWidth = 1;
        }
        if (p.id === st.objId) {
          c.strokeStyle = '#ffffff'; c.setLineDash([2, 3]);
          c.beginPath(); c.arc(x, y, rad + 10, 0, 7); c.stroke(); c.setLineDash([]);
        }
        if (p.moons.length > 0 && cam.z < 4) {
          c.strokeStyle = 'rgba(180,200,230,0.18)'; c.beginPath(); c.arc(x, y, rad + 9, 0, 7); c.stroke();
        }
        if (cam.z < 4.4) {
          c.fillStyle = '#9fb3c8'; c.font = '11px sans-serif';
          const label = f0.explored[sys.id] ? `${p.name} [${p.tags}]` : '?';
          c.fillText(label, x, y + rad + 14);
          if (p.moons.length > 1) { c.fillStyle = '#6c7f93'; c.font = '9px sans-serif'; c.fillText(`${p.moons.length} супутників`, x, y + rad + 25); }
        }
        H2.push({ x, y, r: Math.max(rad + 4, 9), kind: 'planet', id: p.id });
      }
      c.globalAlpha = 1;
    }

    // ---- шар планети (супутники) ----
    const a2 = clamp((cam.z - 3.4) / 1.8, 0, 1);
    if (a2 > 0 && camPlanet) {
      c.globalAlpha = a2;
      // кільця
      const hasRings = camPlanet.features.some(f => f.toLowerCase().includes('кільця')) || camPlanet.moons.some(m => gm.planets[m].roche);
      const [cxw, cyw] = worldPos(gm, camPlanet, gm.time);
      const cx = X(cxw), cy = Y(cyw);
      const pr = bodyR(camPlanet, S, cam.z);
      if (hasRings) {
        for (let i = 3; i >= 1; i--) {
          c.strokeStyle = `rgba(226,203,168,${0.1 + i * 0.06})`;
          c.lineWidth = 4 + i * 4;
          c.beginPath(); c.ellipse(cx, cy, pr * (1.4 + i * 0.22), pr * (1.4 + i * 0.22) * 0.32, -0.28, 0, 7); c.stroke();
        }
        c.lineWidth = 1;
      }
      drawBody(c, cx, cy, pr, camPlanet);
      // орбіти супутників
      for (const mid of camPlanet.moons) {
        const m = gm.planets[mid];
        const rr = moonOrbitR(gm, m) * S;
        c.strokeStyle = 'rgba(120,160,220,0.14)';
        c.beginPath(); c.arc(cx, cy, rr, 0, 7); c.stroke();
      }
      c.textAlign = 'center';
      for (const mid of camPlanet.moons) {
        const m = gm.planets[mid];
        const [wx, wy] = worldPos(gm, m, gm.time);
        const x = X(wx), y = Y(wy);
        const rad = bodyR(m, S, cam.z);
        drawBody(c, x, y, rad, m);
        if (m.colony) {
          c.strokeStyle = m.owner >= 0 ? gm.factions[m.owner].color : '#e8f4ff';
          c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, rad + 4, 0, 7); c.stroke(); c.lineWidth = 1;
        }
        if (m.id === st.objId) {
          c.strokeStyle = '#fff'; c.setLineDash([2, 3]); c.beginPath(); c.arc(x, y, rad + 8, 0, 7); c.stroke(); c.setLineDash([]);
        }
        if (m.radius > 320 || m.id === st.objId) {
          c.fillStyle = '#8fa4b8'; c.font = '9px sans-serif';
          c.fillText(m.name, x, y + rad + 11);
        }
        H2.push({ x, y, r: Math.max(rad + 3, 7), kind: 'moon', id: m.id });
      }
      c.globalAlpha = 1;
    }

    // ---- кораблі ----
    for (const sh of gm.ships) {
      const a = gm.planets[sh.from], b = gm.planets[sh.to];
      if (a.sys !== st.sysId && b.sys !== st.sysId) continue;
      let t = sh.t1 > sh.t0 ? (gm.time - sh.t0) / (sh.t1 - sh.t0) : 1;
      t = clamp(t, 0, 1);
      let x: number, y: number;
      if (a.sys === b.sys) {
        const [ax, ay] = worldPos(gm, a, gm.time), [bx, by] = worldPos(gm, b, gm.time);
        const mx = (ax + bx) / 2 - (by - ay) * 0.18;
        const my = (ay + by) / 2 + (bx - ax) * 0.18;
        const u = 1 - t;
        const wx = u * u * ax + 2 * u * t * mx + t * t * bx;
        const wy = u * u * ay + 2 * u * t * my + t * t * by;
        x = X(wx); y = Y(wy);
      } else {
        const here = a.sys === st.sysId ? a : b;
        const other = gm.systems[a.sys === st.sysId ? b.sys : a.sys];
        const s0 = gm.systems[st.sysId];
        const [hx, hy] = worldPos(gm, here, gm.time);
        const ang = Math.atan2(other.y - s0.y, other.x - s0.x);
        const ex2 = X(s0.x + Math.cos(ang) * 320), ey = Y(s0.y + Math.sin(ang) * 320);
        const hx2 = X(hx), hy2 = Y(hy);
        const tt = a.sys === st.sysId ? Math.min(1, t * 4) : Math.max(0, (t - 0.75) * 4);
        if ((a.sys === st.sysId && tt >= 1) || (b.sys === st.sysId && tt <= 0)) continue;
        x = hx2 + (ex2 - hx2) * tt; y = hy2 + (ey - hy2) * tt;
      }
      c.fillStyle = gm.factions[sh.owner].color;
      c.font = sh.type === 'war' ? '13px sans-serif' : '10px sans-serif';
      c.textAlign = 'center';
      c.fillText(SHIPDEF[sh.type].icon, x, y + 3);
      if (sh.id === st.selShip) { c.strokeStyle = '#fff'; c.beginPath(); c.arc(x, y, 8, 0, 7); c.stroke(); }
    }

    hits.current = H2;
    // підказка керування
    c.fillStyle = 'rgba(160,190,220,0.5)'; c.font = '11px sans-serif'; c.textAlign = 'left';
    c.fillText(st.level === 'galaxy' ? 'Оберіть зоряну систему · Esc — назад' : st.level === 'system' ? `Система ${gm.systems[st.sysId].name} · оберіть планету · Esc — до галактики` : 'Esc — назад до системи', 12, H - 12);
  }

  function drawBody(c: CanvasRenderingContext2D, x: number, y: number, r: number, p: Planet) {
    const col = TAG_COLOR[p.tags] || '#8aa2b8';
    const gas = p.tags.includes('D');
    const grad = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    grad.addColorStop(0, lighten(col, 0.45));
    grad.addColorStop(0.65, col);
    grad.addColorStop(1, '#070b14');
    c.fillStyle = grad;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    if (gas && r > 14) {
      c.save(); c.beginPath(); c.arc(x, y, r, 0, 7); c.clip();
      for (let i = -3; i <= 3; i++) {
        c.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)';
        c.fillRect(x - r, y + i * r * 0.28 - r * 0.1, r * 2, r * 0.16);
      }
      c.restore();
    }
    if (r > 8) {
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
    }
    if (p.pressure > 0.5 && p.tags.includes('A') && r > 8) {
      c.fillStyle = 'rgba(120,190,255,0.14)'; c.beginPath(); c.arc(x, y, r * 1.12, 0, 7); c.fill();
    }
  }

  function lighten(hex: string, f: number) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(s => s + s).join('') : h, 16);
    const r = Math.min(255, ((n >> 16) & 255) + 255 * f), g2 = Math.min(255, ((n >> 8) & 255) + 255 * f), b = Math.min(255, (n & 255) + 255 * f);
    return `rgb(${r | 0},${g2 | 0},${b | 0})`;
  }

  function onClick(e: ReactMouseEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best: Hit | null = null, bd = 1e9;
    for (const h of hits.current) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < h.r + 5 && d < bd) { bd = d; best = h; }
    }
    if (!best) return;
    const st = stRef.current;
    if (best.kind === 'sys') {
      if (st.level === 'galaxy' || st.level === 'system') {
        setSysId(best.id); setObjId(-1); setLevel0('system');
      }
    } else {
      setSysId(g.planets[best.id].sys); setObjId(best.id); setLevel0('planet');
    }
  }

  const obj = objId >= 0 ? g.planets[objId] : null;
  const explored = obj ? me.explored[obj.sys] : me.explored[sysId];
  const myCols = g.planets.filter(q => q.owner === 0);
  const myShips = g.ships.filter(s => s.owner === 0);
  const cp = controlledPop(g, 0);

  function buyShip(t: ShipType) {
    const at = obj && obj.owner === 0 ? obj : myCols[0];
    if (!at) return msg('Немає колонії для верфі');
    if (me.money < SHIPDEF[t].cost) return msg('Недостатньо кредитів');
    me.money -= SHIPDEF[t].cost; spawnShip(g, 0, t, at.id); msg(`${SHIPDEF[t].name} збудовано на ${at.name}`);
  }

  const crumb = (
    <div className="flex items-center gap-1 text-xs">
      <button onClick={() => { setLevel0('galaxy'); setObjId(-1); }} className={`px-2 py-0.5 rounded ${level0 === 'galaxy' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}>🌌 Галактика</button>
      <span className="text-slate-600">›</span>
      <button onClick={() => { setLevel0('system'); setObjId(-1); }} className={`px-2 py-0.5 rounded ${level0 === 'system' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}>☀ {g.systems[sysId].name}</button>
      {obj && <><span className="text-slate-600">›</span>
        <button className="px-2 py-0.5 rounded bg-indigo-600">{TAG_COLOR[obj.tags] ? '●' : '●'} {obj.name}</button></>}
    </div>
  );

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
        <div className="ml-auto">{crumb}</div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative min-h-0">
            <canvas ref={canvasRef} onClick={onClick} className="absolute inset-0 cursor-crosshair" />
            {level0 !== 'galaxy' && <div className="absolute top-2 left-2 bg-black/55 rounded p-2 text-xs space-y-0.5 pointer-events-none">
              <div className="font-semibold text-cyan-200">Система {g.systems[sysId].name}</div>
              <div>Зоря класу {g.systems[sysId].starClass} · {g.systems[sysId].starMass.toFixed(2)} M☉ · L={g.systems[sysId].lum.toFixed(2)}</div>
              <div className={g.systems[sysId].piracy > 0.5 ? 'text-red-400' : ''}>☠ Піратство: {(g.systems[sysId].piracy * 100).toFixed(0)}%</div>
              <div>Ваші фрегати: {warships(g, 0, sysId)}</div>
              {!me.explored[sysId] && <div className="text-amber-400">Не досліджено — відправте розвідника</div>}
            </div>}
            {toast && <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-cyan-900/90 px-4 py-2 rounded shadow">{toast}</div>}
            {g.winner && <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="bg-[#0b1220] border border-cyan-700 rounded-xl p-8 text-center max-w-md">
                <div className="text-3xl mb-2">{g.winner.f === 0 ? '🏆 ПЕРЕМОГА' : '💀 ПОРАЗКА'}</div>
                <div className="text-lg" style={{ color: g.factions[g.winner.f].color }}>{g.factions[g.winner.f].name}</div>
                <div className="text-slate-400 mb-4">{g.winner.how}</div>
                <button className="bg-cyan-600 px-4 py-2 rounded" onClick={() => {
                  gRef.current = newGame(Math.floor(Math.random() * 1e9));
                  const h = gRef.current.planets.find(q => q.owner === 0)!;
                  setSysId(h.sys); setObjId(h.id); setLevel0('system'); setSpeed(1);
                }}>Нова гра</button>
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
                <p><b className="text-cyan-300">Навігація:</b> у режимі галактики клік на зорю <b>наближає</b> вас до системи, клік на планету — до планети (видно супутники, кільця, орбіти). <b>Esc</b> — крок назад: планета → система → галактика.</p>
                <p><b className="text-cyan-300">Цикл гри:</b> розвідник досліджує системи → обери планету → «Розвиток» → аванпост → видобуток і виробництво → вантажники торгують → імпорт від тебе створює <b>торгову залежність</b> → тарифи, ембарго, перевороти, анексія.</p>
                <p><b className="text-cyan-300">Супутники:</b> газові гіганти мають до 80 супутників. Великі (Іо, Європа, Титан) придатні для аванпостів, дрібні астероїдні майже марні — зате припливний нагрів і резонанси роблять вулканічні супутники джерелом геотермальної енергії й рідкісних металів.</p>
                <p><b className="text-cyan-300">Перемога:</b> 60% населення галактики під контролем, або {fmt(SINGULARITY)} очок науки (сингулярність), або 70% колоній у власності. Боти прагнуть того ж!</p>
                <p><b className="text-cyan-300">Ціна</b> = База·(Попит/Пропозиція)^0.7·(1+тариф). <b>Вплив</b> = 0.4·ТоргЗалежність + 0.2·Культура + 0.2·Флот + 0.1·Медіа + 0.1·Інвестиції − Суперник − Невдоволення.</p>
              </div>}
              {bottom === 'ships' && <div>
                <div className="flex gap-1 flex-wrap mb-1">
                  {(Object.keys(SHIPDEF) as ShipType[]).map(t => <button key={t} onClick={() => buyShip(t)} className="bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded">{SHIPDEF[t].icon} {SHIPDEF[t].name} — {fmt(SHIPDEF[t].cost)}</button>)}
                </div>
                <table className="w-full"><tbody>
                  {myShips.map(s => <tr key={s.id} onClick={() => setSelShip(s.id)} className={`cursor-pointer hover:bg-slate-800 ${selShip === s.id ? 'bg-slate-800' : ''}`}>
                    <td>{SHIPDEF[s.type].icon} {s.name}</td>
                    <td>{s.t1 > g.time ? `→ ${g.planets[s.to].name} (${(s.t1 - g.time).toFixed(1)} д)` : `біля ${g.planets[s.at].name}`}</td>
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

        {/* RIGHT PANEL */}
        <div className="w-[430px] bg-[#0b1220] border-l border-cyan-900/40 overflow-y-auto p-3 space-y-3">
          {selShip !== null && (() => {
            const s = g.ships.find(x => x.id === selShip); if (!s) return null;
            const mk = g.planets.filter(q => q.colony && me.explored[q.sys]);
            return <ShipPanel s={s} g={g} mk={mk} onClose={() => setSelShip(null)} sysId={sysId} msg={msg} />;
          })()}

          {level0 === 'galaxy' && <div>
            <div className="text-lg font-semibold text-cyan-200 mb-1">Галактика — {g.systems.length} систем</div>
            <div className="text-xs text-slate-400 mb-2">Оберіть систему — камера наблизиться до неї.</div>
            <div className="space-y-0.5">
              {g.systems.map(s => {
                const ex = me.explored[s.id];
                const cols = g.planets.filter(p => p.sys === s.id && p.colony);
                return <div key={s.id} onClick={() => { setSysId(s.id); setObjId(-1); setLevel0('system'); }}
                  className="cursor-pointer hover:bg-slate-800 rounded px-1 py-0.5 flex items-center gap-2">
                  <span style={{ color: STAR_COLOR[s.starClass] }}>★</span>
                  <span className="flex-1">{ex ? s.name : 'Невідома система'}</span>
                  <span className="text-[10px] text-slate-500">{ex ? `${s.planets.length} планет · ☠${(s.piracy * 100).toFixed(0)}%` : 'не досліджено'}</span>
                  <span className="flex -space-x-1">{cols.slice(0, 5).map(p => <span key={p.id} className="w-2 h-2 rounded-full" style={{ background: p.owner >= 0 ? g.factions[p.owner].color : '#ddd' }} />)}</span>
                </div>;
              })}
            </div>
          </div>}

          {level0 === 'system' && <div>
            <div className="text-lg font-semibold text-cyan-200 mb-1">Система {g.systems[sysId].name}</div>
            <div className="text-xs text-slate-400 mb-2">Оберіть планету — камера наблизиться до неї.</div>
            {g.systems[sysId].planets.map(id => {
              const q = g.planets[id];
              return <div key={id} className="cursor-pointer hover:bg-slate-800 rounded px-1 py-1 flex items-center gap-2" onClick={() => { setObjId(id); setLevel0('planet'); }}>
                <span style={{ color: TAG_COLOR[q.tags] }}>●</span>
                <span className="flex-1">{me.explored[sysId] ? q.name : 'Невідома планета'} {me.explored[sysId] && <span className="text-slate-400 text-xs">[{q.tags}]</span>}</span>
                <span className="text-[10px] text-slate-500">
                  {q.colony ? `${popFmt(q.colony.pop)}${q.owner >= 0 ? ` · ${g.factions[q.owner].short}` : ' · незалежна'}` : q.moons.length ? `${q.moons.length} супутн.` : `${(q.habit * 100).toFixed(0)}% придатн.`}
                </span>
              </div>;
            })}
          </div>}

          {level0 === 'planet' && obj && <PlanetPanel g={g} p={obj} explored={explored} tab={tab} setTab={setTab} msg={msg} setObj={id => setObjId(id)} />}
        </div>
      </div>
    </div>
  );
}

function ShipPanel({ s, g, mk, onClose, sysId, msg }: { s: Game['ships'][0]; g: Game; mk: Planet[]; onClose: () => void; sysId: number; msg: (t: string) => void }) {
  const [a, setA] = useState(s.route?.a ?? mk[0]?.id ?? 0);
  const [b, setB] = useState(s.route?.b ?? mk[1]?.id ?? 0);
  const [gd, setGd] = useState(s.route?.good ?? 4);
  const mine = s.owner === 0;
  return <div className="border border-cyan-800 rounded p-2 bg-slate-900/60">
    <div className="flex justify-between"><b style={{ color: g.factions[s.owner].color }}>{SHIPDEF[s.type].icon} {s.name}</b><button onClick={onClose}>✕</button></div>
    <div className="text-xs text-slate-400">Вантажопідйомність {s.cap} · швидкість {SHIPDEF[s.type].speed}× · корпус {s.hp.toFixed(0)}%</div>
    {mine && s.type === 'war' && <button className="mt-2 bg-indigo-700 px-2 py-1 rounded w-full" onClick={() => {
      const tgt = g.planets.find(q => q.sys === sysId && q.colony) || g.planets[g.systems[sysId].planets[0]];
      if (s.t1 > g.time) return msg('Фрегат у польоті');
      s.from = s.at; s.to = tgt.id; s.t0 = g.time; s.t1 = g.time + travelDays(g, g.planets[s.at], tgt, 'war'); msg(`Фрегат прямує до ${g.systems[sysId].name}`);
    }}>Відправити охороняти {g.systems[sysId].name}</button>}
    {mine && s.type !== 'war' && s.type !== 'scout' && <div className="mt-2 space-y-1 text-xs">
      <div className="font-semibold">Торговий маршрут (А → Б)</div>
      <select className="w-full bg-slate-800 p-1" value={a} onChange={e => setA(+e.target.value)}>{mk.map(q => <option key={q.id} value={q.id}>А: {q.name}</option>)}</select>
      <select className="w-full bg-slate-800 p-1" value={b} onChange={e => setB(+e.target.value)}>{mk.map(q => <option key={q.id} value={q.id}>Б: {q.name}</option>)}</select>
      <select className="w-full bg-slate-800 p-1" value={gd} onChange={e => setGd(+e.target.value)}>{GOODS.map((n, i) => <option key={i} value={i}>{GOOD_ICON[i]} {n} (А: {price(g.planets[a], i).toFixed(0)} → Б: {price(g.planets[b], i).toFixed(0)})</option>)}</select>
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

function PlanetPanel({ g, p, explored, tab, setTab, msg, setObj }: { g: Game; p: Planet; explored: boolean; tab: string; setTab: (t: 'info' | 'market' | 'infl' | 'dev') => void; msg: (t: string) => void; setObj: (id: number) => void }) {
  const me = g.factions[0];
  if (!explored) return <div>
    <div className="text-lg">{p.name}</div>
    <div className="text-amber-400 text-xs">Система не досліджена. Відправте розвідника (він працює автоматично).</div>
    <button className="mt-2 bg-slate-800 px-2 py-1 rounded" onClick={() => setObj(p.id)}>Оновити</button>
  </div>;
  const c = p.colony;
  const lv = level(g, p, 0);
  const ownerName = p.owner >= 0 ? g.factions[p.owner].name : c ? 'Незалежна цивілізація' : 'Ніхто';
  const bigMoons = p.moons.map(m => g.planets[m]).filter(m => m.radius > 220);
  const smallMoons = p.moons.length - bigMoons.length;
  return <div className="space-y-2">
    <div>
      <div className="text-lg font-semibold flex items-center gap-2">
        <span style={{ color: TAG_COLOR[p.tags] }}>●</span>{p.name}
        <span className="text-xs bg-slate-700 px-1.5 rounded">{p.tags}</span>
        {p.colony && <span className="text-xs px-1.5 rounded" style={{ background: p.owner >= 0 ? g.factions[p.owner].color + '44' : '#ffffff22' }}>{colonyLevel(p.colony)}</span>}
      </div>
      <div className="text-slate-400 text-xs">{TAG_DESC[p.tags] || p.tags} · Придатність {(p.habit * 100).toFixed(0)}% · <span style={{ color: p.owner >= 0 ? g.factions[p.owner].color : '#ddd' }}>{ownerName}</span></div>
      {p.parent >= 0 && <div className="text-xs cursor-pointer text-cyan-400" onClick={() => setObj(p.parent)}>↑ Супутник планети {g.planets[p.parent].name} — показати планету</div>}
      {p.moons.length > 0 && <div className="text-xs flex gap-1 flex-wrap mt-1">
        Супутники ({p.moons.length}):
        {bigMoons.map(m => <span key={m.id} className="cursor-pointer text-cyan-400 hover:underline" onClick={() => setObj(m.id)}>{m.name}[{m.tags}]</span>)}
        {smallMoons > 0 && <span className="text-slate-500">+{smallMoons} дрібних астероїдних</span>}
      </div>}
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
        <div className="flex justify-between" style={{ color: f.color }}><span>{f.short} {p.proxy === f.id ? '(проксі)' : ''}</span><span>{p.infl[f.id].toFixed(1)} · L{level(g, p, f.id)} · торг {(tradeDep(p, f.id) * 100).toFixed(0)}%</span></div>
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
          <div>Рівень: <b>{colonyLevel(c)}</b></div><div>Населення: <b>{popFmt(c.pop)}</b></div>
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
      <div className="text-[10px] text-slate-500">Орбіта: {orbitA(g, p).toFixed(3)} а.о. від зорі{p.parent >= 0 ? ` · відстань до планети ${fmt(p.a)} км` : ''}</div>
    </div>}
  </div>;
}

// Експортуються кольори для UI та канви
export const TAG_COLOR: Record<string, string> = { A: '#3fb6f5', AB: '#c9b36a', AC: '#2f6bff', AF: '#d97b3a', B: '#d9a05b', C: '#cfeeff', D: '#e8b77a', CD: '#7fb8ff', F: '#ff5a2a', E: '#b6ff3b', G: '#9a9a9a', I: '#55667a', P: '#8d8577', 'S-F': '#ffd23a', 'S-C': '#dff4ff', 'S-G': '#9a9a9a', 'S-B': '#b8916a' };
export const TAG_DESC: Record<string, string> = { A: 'Земний', AB: 'Сухий земний світ', AC: 'Океанічний світ', AF: 'Вулканічний земний', B: 'Пустельний', C: 'Кріогенний / водний', D: 'Газовий гігант', CD: 'Крижаний гігант', F: 'Вулканічний', E: 'Екстремальний', G: 'Карликова', I: 'Мандрівна', P: 'Астероїд / планетоїд', 'S-F': 'Вулканічний супутник (тип Іо)', 'S-C': 'Крижаний супутник (тип Європи)', 'S-G': 'Кам’янистий супутник', 'S-B': 'Пустельний супутник' };
/** Колір зорі за спектральним класом */
export const STAR_COLOR: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad8ff', F: '#f6f4ff', G: '#ffe9a8', K: '#ffc472', M: '#ff8a5c', D: '#eaf4ff', S: '#ff9a6a',
};
export const starColor = (cls: string) => STAR_COLOR[cls] || '#ffe9a8';
/** Колір зорі з урахуванням того, що гіганти виглядають теплішими */
export const starTint = (cls: string, giant: boolean) => (giant ? STAR_COLOR[cls === 'B' ? 'K' : cls === 'A' ? 'K' : cls] : starColor(cls));

export const SPEEDS = [0, 1, 2, 4, 8];
export const AU_PER_LY = 63241.1;          // а.о. у світловому році
  export const KM_PER_AU = 149597870.7;        // км в астрономічній одиниці
export const fmt = (n: number) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : n.toFixed(0));
export const popFmt = (k: number) => (k >= 1000 ? (k / 1000).toFixed(2) + ' млн' : k >= 1 ? k.toFixed(1) + ' тис' : Math.round(k * 1000) + ' осіб');
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lyFmt = (d: number) => (d < 0.01 ? '0 св. р.' : d < 10 ? d.toFixed(2) + ' св. р.' : d < 100 ? d.toFixed(1) + ' св. р.' : Math.round(d) + ' св. р.');
export const auFmt = (a: number) => (a < 0.01 ? a.toExponential(2) : a < 1 ? a.toFixed(3) : a < 10 ? a.toFixed(2) : a.toFixed(1));

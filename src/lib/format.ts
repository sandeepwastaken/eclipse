import { DAY_MS, HOUR_MS, MINUTE_MS } from './science/constants';

const MINUS = '−';
export const signed = (s: string) => s.replace(/^-/, MINUS);

export const fmtDeg = (v: number, digits = 2) => `${signed(v.toFixed(digits))}°`;
export const fmtAz = (v: number) => `${(((v % 360) + 360) % 360).toFixed(1)}°`;
export const fmtPct = (f: number, digits = 0) => `${(f * 100).toFixed(digits)}%`;
export const fmtLat = (v: number, d = 3) => `${Math.abs(v).toFixed(d)}° ${v < 0 ? 'S' : 'N'}`;
export const fmtLon = (v: number, d = 3) => `${Math.abs(v).toFixed(d)}° ${v < 0 ? 'W' : 'E'}`;
export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');

export function fmtDuration(ms: number, parts = 2): string {
  if (!Number.isFinite(ms)) return '—';
  const neg = ms < 0;
  let x = Math.abs(ms);
  const d = Math.floor(x / DAY_MS);
  x -= d * DAY_MS;
  const h = Math.floor(x / HOUR_MS);
  x -= h * HOUR_MS;
  const m = Math.floor(x / MINUTE_MS);
  const all: string[] = [];
  if (d) all.push(`${d}d`);
  if (h || (d && parts > 1)) all.push(`${h}h`);
  if (!d) all.push(`${m}m`);
  return (neg ? MINUS : '') + all.slice(0, parts).join(' ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
export const fmtUtc = (t: number) => `${fmtDate(t)} · ${fmtTime(t)} UTC`;
export const fmtShortDate = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
export const fmtElapsed = (ms: number) => {
  const d = Math.floor(ms / DAY_MS);
  const h = Math.floor((ms - d * DAY_MS) / HOUR_MS);
  return `T+${d}d ${pad(h)}h`;
};
/** Value for <input type="datetime-local"> interpreted as UTC. */
export const toInputUtc = (t: number) => new Date(t).toISOString().slice(0, 16);
export const fromInputUtc = (s: string) => Date.parse(`${s}:00Z`);

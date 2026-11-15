import { getSite } from '../data/sites';
import { normalizeLon } from './science/topocentric';
import { clampLanding, DURATIONS, type AppState, type Scenario, type SiteRef } from '../state/store';

/**
 * Share URL format (stable, validated on load):
 *   ?a=<site>~<ISO UTC minute>~<days>&b=…&cmp=1&view=surface&at=<elapsed hours>
 * where <site> is a curated id or "lat,lon".
 */
function encodeSite(s: SiteRef) {
  return s.kind === 'curated' ? s.id : `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
}

function decodeSite(raw: string): SiteRef | null {
  if (getSite(raw)) return { kind: 'curated', id: raw };
  const m = raw.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90) || !Number.isFinite(lon)) return null;
  return { kind: 'custom', lat, lon: normalizeLon(lon) };
}

function encodeScenario(s: Scenario) {
  return `${encodeSite(s.site)}~${new Date(s.landing).toISOString().slice(0, 16)}Z~${s.durationDays}`;
}

function decodeScenario(raw: string | null): Scenario | null {
  if (!raw) return null;
  const [site, time, days] = raw.split('~');
  const ref = site ? decodeSite(site) : null;
  const t = time ? Date.parse(time.endsWith('Z') ? time : `${time}Z`) : NaN;
  const d = Number(days);
  if (!ref || !Number.isFinite(t)) return null;
  const durationDays = (DURATIONS as readonly number[]).includes(d) ? d : 30;
  return { site: ref, landing: clampLanding(t, durationDays), durationDays };
}

export function shareUrl(st: AppState): string {
  const p = new URLSearchParams();
  p.set('a', encodeScenario(st.scenarios.A));
  if (st.compare) {
    p.set('b', encodeScenario(st.scenarios.B));
    p.set('cmp', '1');
  }
  if (st.view !== 'orbit') p.set('view', st.view);
  if (st.elapsed > 0) p.set('at', (st.elapsed / 3_600_000).toFixed(2));
  return `${window.location.origin}${window.location.pathname}?${p.toString()}`;
}

export function parseUrl(search: string): Partial<Pick<AppState, 'scenarios' | 'compare' | 'view' | 'elapsed'>> | null {
  const p = new URLSearchParams(search);
  const a = decodeScenario(p.get('a'));
  if (!a) return null;
  const b = decodeScenario(p.get('b'));
  const at = Number(p.get('at'));
  return {
    scenarios: { A: a, B: b ?? { ...a } },
    compare: p.get('cmp') === '1' && !!b,
    view: p.get('view') === 'surface' ? 'surface' : 'orbit',
    elapsed: Number.isFinite(at) && at > 0 ? Math.min(at, a.durationDays * 24) * 3_600_000 : 0,
  };
}

import { DEG, MOON_RADIUS_KM, OBSERVER_HEIGHT_M, RAD } from './constants';
import { cross, dot, len, sub, type V3 } from './vec';

/**
 * Local horizontal frame of a lunar surface observer.
 *
 * Latitude is planetocentric (north +), longitude east-positive. `up` is the
 * radial unit vector, `east` points toward increasing longitude, and
 * `north = up × east`. At the exact poles `east` is still defined by the
 * chosen longitude, so azimuths there are measured from that meridian, a
 * documented convention, not a physical direction.
 */
export interface SiteFrame {
  lat: number;
  lon: number;
  /** Terrain height above the 1737.4 km sphere, m (0 for the smooth reference sphere). */
  heightM: number;
  up: V3;
  east: V3;
  north: V3;
  /** Observer position in the Moon-fixed frame, km. */
  position: V3;
}

export function normalizeLon(lon: number): number {
  const x = (((lon + 180) % 360) + 360) % 360 - 180;
  return x === 180 ? -180 : x;
}

export function isValidLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90;
}

export function siteFrame(lat: number, lon: number, heightM = 0, observerHeightM = OBSERVER_HEIGHT_M): SiteFrame {
  const p = lat * DEG;
  const l = normalizeLon(lon) * DEG;
  const up: V3 = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const east: V3 = [-Math.sin(l), Math.cos(l), 0];
  const north = cross(up, east);
  const r = MOON_RADIUS_KM + (heightM + observerHeightM) / 1000;
  return { lat, lon: normalizeLon(lon), heightM, up, east, north, position: [up[0] * r, up[1] * r, up[2] * r] };
}

export interface Horizontal {
  /** Degrees clockwise from local north, [0, 360). */
  az: number;
  /** Degrees above the local tangent plane (geometric horizon of the sphere). */
  el: number;
  rangeKm: number;
}

const scratch: V3 = [0, 0, 0];

/** Topocentric azimuth/elevation of a body given its Moon-centred position (km). */
export function toHorizontal(frame: SiteFrame, bodyKm: V3): Horizontal {
  const rel = sub(bodyKm, frame.position, scratch);
  const range = len(rel);
  const e = dot(rel, frame.east);
  const n = dot(rel, frame.north);
  const u = dot(rel, frame.up);
  let az = Math.atan2(e, n) * RAD;
  if (az < 0) az += 360;
  return { az, el: Math.asin(Math.max(-1, Math.min(1, u / range))) * RAD, rangeKm: range };
}

/** Apparent angular radius (deg) of a sphere of radius r at distance d. */
export const angularRadiusDeg = (radiusKm: number, rangeKm: number): number => Math.asin(Math.min(1, radiusKm / rangeKm)) * RAD;

/**
 * Fraction of a uniform circular disk lying above a locally straight horizon.
 * @param centerAboveDeg  disk centre elevation minus horizon elevation
 * @param radiusDeg       apparent angular radius
 */
export function diskVisibleFraction(centerAboveDeg: number, radiusDeg: number): number {
  if (centerAboveDeg >= radiusDeg) return 1;
  if (centerAboveDeg <= -radiusDeg) return 0;
  const x = centerAboveDeg / radiusDeg;
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

/** Unit direction (Moon-fixed) for a local azimuth/elevation at a site. */
export function directionFromHorizontal(frame: SiteFrame, azDeg: number, elDeg: number): V3 {
  const a = azDeg * DEG;
  const e = elDeg * DEG;
  const ce = Math.cos(e);
  const se = Math.sin(e);
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  return [
    frame.east[0] * ce * sa + frame.north[0] * ce * ca + frame.up[0] * se,
    frame.east[1] * ce * sa + frame.north[1] * ce * ca + frame.up[1] * se,
    frame.east[2] * ce * sa + frame.north[2] * ce * ca + frame.up[2] * se,
  ];
}

/** Express a Moon-fixed vector in local ENU components. */
export function toEnu(frame: SiteFrame, v: V3): V3 {
  return [dot(v, frame.east), dot(v, frame.north), dot(v, frame.up)];
}

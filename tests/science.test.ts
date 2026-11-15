import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeMission, computeLongSeries, DEFAULT_CRITERIA, instantAt, intersectIntervals, intervalsFromMargins, nextTransition, scanLandingDates,
  type SiteModel,
} from '../src/lib/science/analysis';
import { DAY_MS, HOUR_MS, MOON_RADIUS_KM } from '../src/lib/science/constants';
import { earthAt, parseEphemeris, sunAt, type Ephemeris, type EphemerisMeta } from '../src/lib/science/ephemeris';
import { computeHorizon, horizonAt, SPHERE_HORIZON, type HorizonProfile } from '../src/lib/science/horizon';
import { diskVisibleFraction, normalizeLon, siteFrame, toHorizontal } from '../src/lib/science/topocentric';

const root = resolve(__dirname, '..');
const meta = JSON.parse(readFileSync(resolve(root, 'public/data/ephemeris.json'), 'utf8')) as EphemerisMeta;
const bin = readFileSync(resolve(root, 'public/data/ephemeris.bin'));
const eph: Ephemeris = parseEphemeris(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const reference = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/spice-reference.json'), 'utf8')) as {
  rows: { site: string; lat: number; lon: number; utc: string; sun: { azimuthDeg: number; elevationDeg: number }; earth: { azimuthDeg: number; elevationDeg: number } }[];
};

const sphereSite = (lat: number, lon: number, key = 'test'): SiteModel => ({ key, name: key, frame: siteFrame(lat, lon, 0, 0), horizon: SPHERE_HORIZON });
const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function loadSiteProfile(id: string): { profile: HorizonProfile; heightM: number } {
  const j = JSON.parse(readFileSync(resolve(root, `public/data/terrain/sites/${id}.json`), 'utf8')) as { horizonDeg: number[]; azimuthStepDeg: number; heightM: number };
  return { profile: { kind: 'terrain', stepDeg: j.azimuthStepDeg, values: Float32Array.from(j.horizonDeg), source: 'test' }, heightM: j.heightM };
}

describe('ephemeris', () => {
  it('covers 2026-01-01 to 2029-01-01 hourly in the Moon ME frame', () => {
    expect(eph.start).toBe(Date.UTC(2026, 0, 1));
    expect(eph.end).toBe(Date.UTC(2029, 0, 1));
    expect(eph.step).toBe(HOUR_MS);
    expect(eph.meta.frame).toBe('MOON_ME_DE440_ME421');
  });

  it('places the Sun ~1 AU and Earth ~384,000 km from the Moon', () => {
    const t = Date.UTC(2026, 10, 14, 12);
    const s = sunAt(eph, t);
    const e = earthAt(eph, t);
    expect(Math.hypot(...s) / 149_597_870.7).toBeGreaterThan(0.97);
    expect(Math.hypot(...s) / 149_597_870.7).toBeLessThan(1.03);
    expect(Math.hypot(...e)).toBeGreaterThan(356_000);
    expect(Math.hypot(...e)).toBeLessThan(407_000);
  });

  it('keeps Earth near the sub-Earth point (libration < 10°)', () => {
    for (let t = eph.start; t < eph.end; t += 7 * DAY_MS) {
      const e = earthAt(eph, t);
      const lat = Math.asin(e[2] / Math.hypot(...e)) * 180 / Math.PI;
      const lon = Math.atan2(e[1], e[0]) * 180 / Math.PI;
      expect(Math.abs(lat)).toBeLessThan(8);
      expect(Math.abs(lon)).toBeLessThan(9);
    }
  });
});

describe('topocentric geometry vs independent SPICE azlcpo', () => {
  for (const row of reference.rows) {
    it(`${row.site} @ ${row.utc}`, () => {
      const frame = siteFrame(row.lat, row.lon, 0, 0);
      const t = Date.parse(row.utc);
      const sun = toHorizontal(frame, sunAt(eph, t));
      const earth = toHorizontal(frame, earthAt(eph, t));
      expect(Math.abs(sun.el - row.sun.elevationDeg)).toBeLessThan(0.002);
      expect(Math.abs(earth.el - row.earth.elevationDeg)).toBeLessThan(0.002);
      expect(azDiff(sun.az, row.sun.azimuthDeg)).toBeLessThan(0.01);
      expect(azDiff(earth.az, row.earth.azimuthDeg)).toBeLessThan(0.01);
    });
  }
});

describe('basic transforms', () => {
  it('reports a body directly overhead at 90° elevation and east at 90° azimuth', () => {
    const f = siteFrame(0, 0, 0, 0);
    expect(toHorizontal(f, [MOON_RADIUS_KM + 1000, 0, 0]).el).toBeCloseTo(90, 6);
    const east = toHorizontal(f, [MOON_RADIUS_KM, 1e6, 0]);
    expect(east.az).toBeCloseTo(90, 3);
    expect(east.el).toBeCloseTo(0, 1);
    const north = toHorizontal(f, [MOON_RADIUS_KM, 0, 1e6]);
    expect(north.az).toBeCloseTo(0, 3);
  });

  it('handles the exact poles with a longitude-defined basis', () => {
    const f = siteFrame(-90, 30, 0, 0);
    expect(f.up[2]).toBeCloseTo(-1, 12);
    const h = toHorizontal(f, [0, 0, -1e6]);
    expect(h.el).toBeCloseTo(90, 6);
    expect(Number.isFinite(toHorizontal(f, [1e6, 0, 0]).az)).toBe(true);
  });

  it('wraps longitude into [-180, 180)', () => {
    expect(normalizeLon(180)).toBe(-180);
    expect(normalizeLon(540)).toBe(-180);
    expect(normalizeLon(-190)).toBeCloseTo(170, 10);
    expect(normalizeLon(359.5)).toBeCloseTo(-0.5, 10);
  });

  it('computes partial disk visibility', () => {
    expect(diskVisibleFraction(0, 0.27)).toBeCloseTo(0.5, 10);
    expect(diskVisibleFraction(0.27, 0.27)).toBe(1);
    expect(diskVisibleFraction(-0.3, 0.27)).toBe(0);
    expect(diskVisibleFraction(0.1, 0.27) + diskVisibleFraction(-0.1, 0.27)).toBeCloseTo(1, 10);
  });
});

describe('horizon profiles', () => {
  it('interpolates with azimuth wrap-around', () => {
    const p: HorizonProfile = { kind: 'terrain', stepDeg: 90, values: Float32Array.from([0, 10, 20, 30]), source: 't' };
    expect(horizonAt(p, 45)).toBeCloseTo(5);
    expect(horizonAt(p, 315)).toBeCloseTo(15);
    expect(horizonAt(p, -45)).toBeCloseTo(15);
  });

  it('gives the geometric dip of a 2 m observer over a smooth sphere', () => {
    const { values } = computeHorizon(() => 0, -10, 20, { bins: 8, maxDistanceM: 20_000, minStepM: 20 });
    const dip = -Math.acos((MOON_RADIUS_KM * 1000) / (MOON_RADIUS_KM * 1000 + 2)) * 180 / Math.PI;
    for (const v of values) expect(v).toBeCloseTo(dip, 3);
  });

  it('sees a 1 km plateau 10 km to the north at ~5.6°', () => {
    const sampler = (lat: number) => (lat > 0.33 ? 1000 : 0);
    const { values } = computeHorizon(sampler, 0, 0, { bins: 4, maxDistanceM: 12_000, minStepM: 20 });
    const expected = Math.atan2(998 - 10_000 ** 2 / (2 * MOON_RADIUS_KM * 1000), 10_000) * 180 / Math.PI;
    expect(values[0]).toBeGreaterThan(expected - 0.2);
    expect(values[0]).toBeLessThan(expected + 0.4);
    expect(values[2]).toBeLessThan(0);
  });

  it('ships LOLA horizon masks with 0.25° bins for curated sites', () => {
    const { profile } = loadSiteProfile('connecting-ridge');
    expect(profile.values.length).toBe(1440);
    expect(Math.max(...profile.values)).toBeLessThan(5);
  });
});

describe('visibility analysis', () => {
  it('builds intervals for always-on, always-off and crossing margins', () => {
    expect(intervalsFromMargins(0, 10, [1, 1, 1])).toEqual([{ start: 0, end: 20 }]);
    expect(intervalsFromMargins(0, 10, [-1, -2, -3])).toEqual([]);
    const iv = intervalsFromMargins(0, 10, [-1, 1, 1, -1]);
    expect(iv).toHaveLength(1);
    expect(iv[0].start).toBeCloseTo(5);
    expect(iv[0].end).toBeCloseTo(25);
  });

  it('intersects intervals', () => {
    expect(intersectIntervals([{ start: 0, end: 10 }, { start: 20, end: 30 }], [{ start: 5, end: 25 }])).toEqual([{ start: 5, end: 10 }, { start: 20, end: 25 }]);
  });

  it('keeps visibility status consistent with elevation and terrain', () => {
    const { profile, heightM } = loadSiteProfile('shackleton-rim');
    const site: SiteModel = { key: 's', name: 's', frame: siteFrame(-89.7668, -171.87, heightM), horizon: profile };
    for (let t = Date.UTC(2026, 10, 1); t < Date.UTC(2026, 11, 1); t += 7 * HOUR_MS) {
      const x = instantAt(eph, site, t, DEFAULT_CRITERIA);
      expect(x.sun.visible).toBe(x.sun.el > x.sun.horizon);
      expect(x.earth.visible).toBe(x.earth.el > x.earth.horizon);
      expect(x.both).toBe(x.sun.visible && x.earth.visible);
    }
  });

  it('changes with time and with site', () => {
    const a = instantAt(eph, sphereSite(-89.46, -137.49), Date.UTC(2026, 10, 14));
    const b = instantAt(eph, sphereSite(-89.46, -137.49), Date.UTC(2026, 10, 15));
    const c = instantAt(eph, sphereSite(-85.99, -0.24), Date.UTC(2026, 10, 14));
    expect(a.sun.az).not.toBeCloseTo(b.sun.az, 1);
    expect(a.earth.el).not.toBeCloseTo(c.earth.el, 1);
  });

  it('reports far-side sites as never seeing Earth', () => {
    const r = analyzeMission(eph, sphereSite(-45.4562, 177.5885), Date.UTC(2026, 10, 14), 60 * DAY_MS, DEFAULT_CRITERIA);
    expect(r.earth.fraction).toBe(0);
    expect(r.sun.fraction).toBeGreaterThan(0.4);
    expect(r.sun.fraction).toBeLessThan(0.6);
  });

  it('gives an equatorial site roughly half sunlight over a year and constant Earth for near side', () => {
    const r = analyzeMission(eph, sphereSite(0.674, 23.47), Date.UTC(2027, 0, 1), 365 * DAY_MS, DEFAULT_CRITERIA);
    expect(r.sun.fraction).toBeGreaterThan(0.48);
    expect(r.sun.fraction).toBeLessThan(0.52);
    expect(r.earth.fraction).toBe(1);
    expect(r.both.fraction).toBeCloseTo(r.sun.fraction, 6);
  });

  it('finds the next transition consistently with mission intervals', () => {
    const site = sphereSite(0.674, 23.47);
    const t0 = Date.UTC(2026, 10, 14);
    const mission = analyzeMission(eph, site, t0, 40 * DAY_MS, DEFAULT_CRITERIA);
    const long = computeLongSeries(eph, site, DEFAULT_CRITERIA);
    const next = nextTransition(eph, site, DEFAULT_CRITERIA, long, t0, 'sun');
    expect(next).not.toBeNull();
    const boundaries = mission.sun.intervals.flatMap((iv) => [iv.start, iv.end]).filter((t) => t > t0 + 1000);
    expect(Math.abs(next!.at - boundaries[0])).toBeLessThan(2 * 60_000);
  });

  it('scans landing dates using the same visibility definition', () => {
    const site = sphereSite(0.674, 23.47);
    const long = computeLongSeries(eph, site, DEFAULT_CRITERIA);
    const scan = scanLandingDates(long, Date.UTC(2027, 0, 1), 14 * DAY_MS);
    expect(scan.n).toBeGreaterThan(1000);
    const max = Math.max(...scan.sun);
    const min = Math.min(...scan.sun);
    expect(max).toBe(1);
    expect(min).toBe(0);
  });
});

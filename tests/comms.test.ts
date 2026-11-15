import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEphemeris, type EphemerisMeta } from '../src/lib/science/ephemeris';
import { BANDS, linkBudget, rainExceedance, stationViews, STATIONS } from '../src/lib/science/comms';
import { siteFrame } from '../src/lib/science/topocentric';

const meta = JSON.parse(readFileSync('public/data/ephemeris.json', 'utf8')) as EphemerisMeta;
const buf = readFileSync('public/data/ephemeris.bin');
const eph = parseEphemeris(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
// Moon's centre stands in for the site here (Horizons target 301): a site 1737 km off-centre moves it < 0.3°.
const centre = { ...siteFrame(0, 0, 0), position: [0, 0, 0] as [number, number, number] };

// JPL Horizons, airless apparent elevation of the Moon (target 301) from the station, 2026-11-14/15 and 2027-03-02.
const horizons: [string, number, number][] = [
  ['goldstone', Date.UTC(2026, 10, 14, 18), -12.890591],
  ['goldstone', Date.UTC(2026, 10, 15, 0), 30.357516],
  ['goldstone', Date.UTC(2026, 10, 15, 6), -11.143642],
  ['canberra', Date.UTC(2027, 2, 2, 12), -21.729358],
  ['canberra', Date.UTC(2027, 2, 2, 18), 36.713947],
];

describe('ground stations', () => {
  it('puts the Moon where JPL Horizons does, within 0.6° (Horizons includes light-time and aberration)', () => {
    for (const [id, t, el] of horizons) {
      const v = stationViews(eph, centre, t).find((s) => s.station.id === id)!;
      expect(Math.abs(v.el - el)).toBeLessThan(0.6);
    }
  });
  it('always has at least one station near-continuously over a month', () => {
    let covered = 0;
    const n = 30 * 24;
    for (let h = 0; h < n; h++) if (stationViews(eph, centre, Date.UTC(2027, 0, 1) + h * 3_600_000).some((s) => s.up)) covered++;
    expect(covered / n).toBeGreaterThan(0.95);
    expect(STATIONS).toHaveLength(5);
  });
  it('ranks the bands by clear-sky data rate and fades Ka in rain far more than S', () => {
    const v = stationViews(eph, centre, Date.UTC(2026, 10, 15, 0)).find((s) => s.station.id === 'goldstone')!;
    const s = linkBudget('S', v), x = linkBudget('X', v), ka = linkBudget('Ka', v);
    expect(ka.rate).toBeGreaterThan(x.rate);
    expect(x.rate).toBeGreaterThan(s.rate);
    expect(linkBudget('Ka', v, 10).rainDb).toBeGreaterThan(20 * linkBudget('S', v, 10).rainDb);
    expect(BANDS.Ka.ghz).toBeGreaterThan(BANDS.X.ghz);
  });
  it('interpolates rain exceedance monotonically', () => {
    const m = { hours: 2000, wet: 0.08, r1: 2.5, r01: 7, mean: 0.1 };
    expect(rainExceedance(m, 0.1)).toBeCloseTo(0.08, 5);
    expect(rainExceedance(m, 2.5)).toBeCloseTo(0.01, 5);
    expect(rainExceedance(m, 1)).toBeLessThan(0.08);
    expect(rainExceedance(m, 20)).toBeLessThan(0.001);
  });
});

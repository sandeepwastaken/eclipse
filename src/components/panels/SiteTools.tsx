import { Download, ExternalLink } from 'lucide-react';
import { useEphemeris, type ScenarioData } from '../../hooks/data';
import { bestStation, linkBudget, lightTimeS, stationViews } from '../../lib/science/comms';
import { useApp } from '../../state/store';

const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

/** JPL Horizons observer table for the Sun (10) or Earth (399) seen from this spot on the Moon. */
export function horizonsUrl(target: '10' | '399', lat: number, lon: number, heightM: number, t0: number, t1: number) {
  const p = new URLSearchParams({
    format: 'text',
    COMMAND: `'${target}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${lon.toFixed(4)},${lat.toFixed(4)},${(heightM / 1000).toFixed(3)}'`,
    START_TIME: `'${iso(t0)}'`,
    STOP_TIME: `'${iso(t1)}'`,
    STEP_SIZE: "'1 h'",
    QUANTITIES: "'4'",
    APPARENT: "'AIRLESS'",
    ANG_FORMAT: "'DEG'",
  });
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${p.toString()}`;
}

export const moonTrekUrl = (lat: number, lon: number) =>
  `https://trek.nasa.gov/moon/#v=0.1&x=${lon.toFixed(4)}&y=${lat.toFixed(4)}&z=${Math.abs(lat) > 80 ? 9 : 8}&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104903&d=`;

/** Every sample of the mission as CSV: Sun, Earth, terrain horizon, station and link rate. */
function exportCsv(data: ScenarioData, band: 'S' | 'X' | 'Ka', eph: NonNullable<ReturnType<typeof useEphemeris>['eph']>) {
  const m = data.mission;
  if (!m) return;
  const s = m.series;
  const rows = ['utc,sun_az_deg,sun_el_deg,sun_horizon_deg,sun_disk_visible,earth_az_deg,earth_el_deg,earth_horizon_deg,sun_up,earth_up,irradiance_w_m2,station,station_moon_el_deg,light_time_s,' + `${band}_rate_bps`];
  for (let i = 0; i < s.n; i++) {
    const t = s.t0 + i * s.step;
    const earthUp = s.earthMargin[i] > 0;
    const best = bestStation(stationViews(eph, data.site.model.frame, t));
    const rate = earthUp && best ? linkBudget(band, best).rate : 0;
    rows.push([
      new Date(t).toISOString(),
      s.sunAz[i].toFixed(3), s.sunEl[i].toFixed(3), s.sunHorizon[i].toFixed(3), s.sunFraction[i].toFixed(3),
      s.earthAz[i].toFixed(3), s.earthEl[i].toFixed(3), s.earthHorizon[i].toFixed(3),
      s.sunMargin[i] > 0 ? 1 : 0, earthUp ? 1 : 0, s.irradiance[i].toFixed(1),
      best ? best.station.name : '', best ? best.el.toFixed(2) : '', best ? lightTimeS(best.rangeKm).toFixed(4) : '', rate,
    ].join(','));
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `eclipse-${data.site.model.key.replace(/[^a-z0-9-]+/gi, '_')}-${new Date(s.t0).toISOString().slice(0, 10)}.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Verify the numbers in NASA's own tools, or take them away. */
export function SiteTools({ data, t }: { data: ScenarioData; t: number }) {
  const { eph } = useEphemeris();
  const band = useApp((s) => s.band);
  const f = data.site.model.frame;
  const t0 = Math.floor(t / 3_600_000) * 3_600_000;
  return (
    <div className="section">
      <span className="eyebrow">Verify &amp; export</span>
      <div className="chip-row" style={{ marginTop: 10 }}>
        <a className="chip link-chip" href={horizonsUrl('10', f.lat, f.lon, f.heightM, t0, t0 + 6 * 3_600_000)} target="_blank" rel="noreferrer" title="JPL Horizons: the Sun's azimuth and elevation from this site, next 6 hours">Sun in JPL Horizons <ExternalLink size={11} /></a>
        <a className="chip link-chip" href={horizonsUrl('399', f.lat, f.lon, f.heightM, t0, t0 + 6 * 3_600_000)} target="_blank" rel="noreferrer" title="JPL Horizons: Earth's azimuth and elevation from this site, next 6 hours">Earth in JPL Horizons <ExternalLink size={11} /></a>
        <a className="chip link-chip" href={moonTrekUrl(f.lat, f.lon)} target="_blank" rel="noreferrer" title="Open this spot in NASA Moon Trek">Moon Trek <ExternalLink size={11} /></a>
        <button type="button" className="chip link-chip" disabled={!eph || !data.mission} onClick={() => eph && exportCsv(data, band, eph)} title="Download every sample of this mission as CSV">
          <Download size={11} /> Mission CSV
        </button>
      </div>
      <p className="note" style={{ marginTop: 8 }}>Horizons uses the IAU Moon frame and terrain-free geometry: elevations agree with the "geometric" Sun and Earth to a few hundredths of a degree.</p>
    </div>
  );
}

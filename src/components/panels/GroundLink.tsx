import { memo, useEffect, useMemo, useState } from 'react';
import { Segmented } from '../ui/primitives';
import { BlurText } from '../ui/BlurNumber';
import { useEphemeris, type ScenarioData } from '../../hooks/data';
import { fmtPct } from '../../lib/format';
import { HOUR_MS } from '../../lib/science/constants';
import {
  bestStation, fmtRate, lightTimeS, linkBudget, loadStationWeather, rainOutage, stationViews, stationWeatherNow, STATIONS, STATION_MASK_DEG, type Band,
} from '../../lib/science/comms';
import { useApp } from '../../state/store';

/** Mission-long Earth-link figures once ground stations and rain are counted. */
export function useLinkStats(data: ScenarioData, band: Band, weatherReady: boolean) {
  const { eph } = useEphemeris();
  return useMemo(() => {
    const s = data.mission?.series;
    if (!eph || !s) return null;
    let geo = 0, station = 0, expected = 0, n = 0;
    const stride = Math.max(1, Math.floor(s.n / 1500));
    for (let i = 0; i < s.n; i += stride) {
      n++;
      if (s.earthMargin[i] <= 0) continue;
      geo++;
      const t = s.t0 + i * s.step;
      const best = bestStation(stationViews(eph, data.site.model.frame, t));
      if (!best) continue;
      station++;
      const out = weatherReady ? rainOutage(band, best, new Date(t).getUTCMonth()) : 0;
      expected += 1 - (out ?? 0);
    }
    return { geometric: geo / n, station: station / n, expected: expected / n };
  }, [eph, data.mission, data.site.model.frame, band, weatherReady]);
}

const CoverageStrip = memo(function CoverageStrip({ rows, best }: { rows: string[]; best: string | null }) {
  return (
    <div className="gl-strip" aria-label="Station coverage, next 48 hours">
      {STATIONS.map((st, k) => (
        <div className="gl-row" key={st.id}>
          <span className={`gl-lab ${best === st.id ? 'is-best' : ''}`}>{st.name}</span>
          <svg className="gl-cells" viewBox="0 0 96 1" preserveAspectRatio="none" aria-hidden>
            <path d={rows[k]} />
          </svg>
        </div>
      ))}
      <div className="gl-axis faint"><span>now</span><span>+24 h</span><span>+48 h</span></div>
    </div>
  );
});

/**
 * Direct-to-Earth link, Earth end: which deep-space station has the Moon right now, the
 * one-way light time, the link budget in the chosen band, and how often rain at that station
 * takes the band down in this calendar month (ERA5 climatology, not a forecast).
 */
export function GroundLink({ data, t }: { data: ScenarioData; t: number }) {
  const { eph } = useEphemeris();
  const band = useApp((s) => s.band);
  const setBand = useApp((s) => s.setBand);
  const [weatherReady, setWeatherReady] = useState(!!stationWeatherNow());
  useEffect(() => {
    void loadStationWeather().then((w) => setWeatherReady(!!w));
  }, []);
  const frame = data.site.model.frame;
  // Stations move fast (Earth turns 15°/h): step at simulated minutes, not at every render.
  const tq = Math.floor(t / 60_000) * 60_000;
  const views = useMemo(() => (eph ? stationViews(eph, frame, tq) : null), [eph, frame, tq]);
  const best = views ? bestStation(views) : null;
  const month = new Date(tq).getUTCMonth();
  const link = best ? linkBudget(band, best) : null;
  const outage = best && weatherReady ? rainOutage(band, best, month) : null;
  const wx = best ? stationWeatherNow()?.stations[best.station.id]?.months[month] : null;
  const stats = useLinkStats(data, band, weatherReady);
  // Next 48 h of coverage, one row per station: handovers at a glance. One SVG path per row.
  const hour = Math.floor(tq / HOUR_MS);
  const strip = useMemo(() => {
    if (!eph) return null;
    const N = 96;
    const rows = STATIONS.map(() => '');
    for (let i = 0; i < N; i++) {
      const v = stationViews(eph, frame, hour * HOUR_MS + i * 0.5 * HOUR_MS);
      v.forEach((s, k) => {
        if (s.up) rows[k] += `M${i} 0h1v1h-1z`;
      });
    }
    return rows;
  }, [eph, frame, hour]);
  const earthUp = !!data.mission && (() => {
    const s = data.mission.series;
    const i = Math.max(0, Math.min(s.n - 1, Math.round((t - s.t0) / s.step)));
    return s.earthMargin[i] > 0;
  })();
  const monthName = new Date(tq).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return (
    <div className="section ground-link">
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="eyebrow">Direct-to-Earth link</span>
        <Segmented small label="Radio band" value={band} onChange={setBand} options={(['S', 'X', 'Ka'] as const).map((b) => ({ value: b, label: b }))} />
      </div>
      <div className={`gl-now ${earthUp && best ? 'on' : 'off'}`}>
        <div className="gl-station">
          <span className={`dot ${earthUp && best ? '' : 'off'}`} style={{ color: 'var(--earth)' }} />
          <div>
            <div className="gl-name">{best ? best.station.name : 'No station'}<span className="faint"> · {best ? `${best.station.agency} ${best.station.dish}` : `Moon below ${STATION_MASK_DEG}° everywhere`}</span></div>
            <div className="gl-sub tnum">
              {!earthUp ? 'Earth is below the site’s horizon: no line of sight' : best ? <>Moon <BlurText text={`${best.el.toFixed(1)}°`} /> up · light time <BlurText text={`${lightTimeS(best.rangeKm).toFixed(3)} s`} /></> : '—'}
            </div>
          </div>
        </div>
        <div className="gl-figs tnum">
          <div><span className="k">Rate</span><span className="v">{earthUp && link ? fmtRate(link.rate) : '—'}</span></div>
          <div><span className="k">Margin</span><span className="v">{earthUp && link && link.rate ? `${link.marginDb.toFixed(1)} dB` : '—'}</span></div>
          <div><span className="k">Rain-out</span><span className="v">{outage === null ? '—' : outage < 0.0005 ? '<0.1%' : fmtPct(outage, outage < 0.1 ? 1 : 0)}</span></div>
        </div>
      </div>
      {strip && <CoverageStrip rows={strip} best={best?.station.id ?? null} />}
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Earth in view at the site</dt>
        <dd>{stats ? fmtPct(stats.geometric) : '—'}</dd>
        <dt>…and a station has the Moon</dt>
        <dd>{stats ? fmtPct(stats.station) : '—'}</dd>
        <dt>Usable {band}-band, after rain</dt>
        <dd>{stats ? fmtPct(stats.expected) : '—'}</dd>
      </dl>
      <p className="note" style={{ marginTop: 10 }}>
        {wx ? <>{best?.station.name} in {monthName}: rain on {fmtPct(wx.wet, 0)} of hours, 1% of hours above {wx.r1.toFixed(1)} mm/h. </> : null}
        Rain climatology from ERA5 (2018–2020) via the Microsoft Planetary Computer, not a forecast. Lander radio is an assumed CLPS-class design (see Methodology).
      </p>
    </div>
  );
}

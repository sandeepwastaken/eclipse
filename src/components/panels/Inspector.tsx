import { memo, useMemo } from 'react';
import { BlurNumber, BlurText } from '../ui/BlurNumber';
import { BothGlyph, EarthGlyph, GlassPanel, Morph, SunGlyph } from '../ui/primitives';
import { useEphemeris, useScenarioData, useThrottledElapsed, type ScenarioData } from '../../hooks/data';
import { fmtAz, fmtDeg, fmtDuration, fmtInt, fmtLat, fmtLon, fmtPct, fmtUtc } from '../../lib/format';
import { instantAt, nextTransition, type Channel, type Instant } from '../../lib/science/analysis';
import { horizonStats } from '../../lib/science/horizon';
import { playheadTime, siteLatLon, siteName, useApp, type ScenarioId } from '../../state/store';
import { GroundLink } from './GroundLink';
import { SiteTools } from './SiteTools';
import { SiteIntel } from './SiteIntel';

function useInstant(data: ScenarioData, id: ScenarioId) {
  const { eph } = useEphemeris();
  // Fewer panel updates while time runs: the 3D view carries the motion.
  const playing = useApp((s) => s.playing);
  const elapsed = useThrottledElapsed(playing ? 8 : 18);
  const sc = useApp((s) => s.scenarios[id]);
  const criteria = useApp((s) => s.criteria);
  const t = playheadTime(sc, elapsed);
  const inst = useMemo(() => (eph ? instantAt(eph, data.site.model, t, criteria) : null), [eph, data.site, t, criteria]);
  const next = useMemo(() => {
    if (!eph || !data.long) return null;
    const f = (c: Channel) => nextTransition(eph, data.site.model, criteria, data.long!, t, c);
    return { sun: f('sun'), earth: f('earth'), both: f('both') };
    // Throttle the (cheap but not free) event search to ~2 Hz of simulated movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eph, data.site, data.long, Math.floor(t / 600_000), criteria]);
  return { t, inst, next, elapsed };
}

function Countdown({ label, glyph, tr, t, visible }: { label: [string, string]; glyph: React.ReactNode; tr: { at: number; rising: boolean } | null | undefined; t: number; visible: boolean }) {
  const text = tr ? fmtDuration(tr.at - t) : visible ? 'Beyond dataset' : 'Not before 2029';
  return (
    <div className="countdown">
      <span className="what">{glyph}{visible ? label[1] : label[0]} in</span>
      <span className="when tnum"><BlurText text={text} /></span>
    </div>
  );
}

function HeroCard({ kind, inst }: { kind: 'sun' | 'earth'; inst: Instant | null }) {
  const b = inst?.[kind];
  const on = !!b?.visible;
  const statusText = kind === 'sun'
    ? !b ? '—' : b.fraction >= 0.999 ? 'Visible' : b.fraction > 0 ? `${Math.round(b.fraction * 100)}% visible` : b.el > 0 ? 'Behind terrain' : 'Below horizon'
    : !b ? '—' : on ? 'In view' : b.el > 0 ? 'Behind terrain' : 'Below horizon';
  return (
    <div className={`hero-card ${kind}`}>
      <div className="k">{kind === 'sun' ? <SunGlyph /> : <EarthGlyph />}{kind === 'sun' ? 'Sun' : 'Earth'} elevation</div>
      <div className="v tnum"><BlurNumber value={b?.el} format={(v) => fmtDeg(v, 2)} /></div>
      <div className="s tnum">Azimuth <BlurNumber value={b?.az} format={fmtAz} /></div>
      <div className={`status ${on ? 'on' : 'off'}`}>
        <span className={`dot ${on ? '' : 'off'}`} style={{ color: kind === 'sun' ? 'var(--sun)' : 'var(--earth)' }} />
        <BlurText text={statusText} />
      </div>
    </div>
  );
}

const Availability = memo(function Availability({ m }: { m: ScenarioData['mission'] }) {
  const rows: { k: string; label: string; glyph: React.ReactNode; color: string; f: number | undefined }[] = [
    { k: 'sun', label: 'Sunlight', glyph: <SunGlyph size={12} />, color: 'var(--sun)', f: m?.sun.fraction },
    { k: 'earth', label: 'Earth link', glyph: <EarthGlyph size={12} />, color: 'var(--earth)', f: m?.earth.fraction },
    { k: 'both', label: 'Both', glyph: <BothGlyph size={12} />, color: 'var(--both)', f: m?.both.fraction },
  ];
  return (
    <div className="avail">
      {rows.map((r) => (
        <div className="avail-row" key={r.k}>
          <span className="avail-label" style={{ color: r.color }}>{r.glyph}<span className="muted">{r.label}</span></span>
          <div className="bar"><i style={{ width: `${(r.f ?? 0) * 100}%`, background: r.color }} /></div>
          <span className="avail-val tnum"><BlurNumber value={r.f !== undefined ? r.f * 100 : null} format={(v) => `${Math.round(v)}%`} /></span>
        </div>
      ))}
    </div>
  );
});

function SingleInspector({ id }: { id: ScenarioId }) {
  const data = useScenarioData(id);
  const sc = useApp((s) => s.scenarios[id]);
  const { t, inst, next } = useInstant(data, id);
  const [lat, lon] = siteLatLon(sc.site);
  const hz = data.site.model.horizon;
  const stats = hz.kind === 'terrain' ? horizonStats(hz) : null;
  const m = data.mission;
  return (
    <>
      <div className="panel-head">
        <Morph k={`${data.site.model.key}`}>
          <div className="title">{siteName(sc.site)}</div>
          <div className="row" style={{ justifyContent: 'flex-start' }}>
            <span className="subtitle tnum">{fmtLat(lat)} · {fmtLon(lon)}{hz.kind === 'terrain' ? ` · ${fmtInt(data.site.model.frame.heightM)} m` : ''}</span>
            <span className={`badge ${hz.kind === 'terrain' ? 'terrain' : ''}`}>{hz.kind === 'terrain' ? 'LOLA terrain' : 'Sphere'}</span>
          </div>
        </Morph>
      </div>
      <div className="panel-scroll">
        <div className="section" style={{ paddingTop: 4 }}>
          <div className="metric-hero">
            <HeroCard kind="sun" inst={inst} />
            <HeroCard kind="earth" inst={inst} />
          </div>
        </div>
        <div className="section">
          <Countdown label={['Sunrise', 'Sunset']} glyph={<SunGlyph size={12} />} tr={next?.sun} t={t} visible={!!inst?.sun.visible} />
          <Countdown label={['Earthrise', 'Earthset']} glyph={<EarthGlyph size={12} />} tr={next?.earth} t={t} visible={!!inst?.earth.visible} />
        </div>
        <GroundLink data={data} t={t} />
        <div className="section">
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="eyebrow">{sc.durationDays === 365 ? '1-year' : `${sc.durationDays}-day`} mission</span>
          </div>
          <Availability m={data.mission} />
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Longest Sun + Earth window</dt>
            <dd><BlurText text={m ? fmtDuration(m.both.longestMs) : '—'} /></dd>
            <dt>Longest darkness</dt>
            <dd><BlurText text={m ? fmtDuration(m.sun.longestGapMs) : '—'} /></dd>
          </dl>
        </div>
        <SiteTools data={data} t={t} />
        <SiteIntel site={sc.site} />
        <details className="section disclosure">
          <summary>Details</summary>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Mean solar input, Sun-pointing</dt>
            <dd><BlurNumber value={m?.meanIrradiance} format={(v) => `${fmtInt(v)} W/m²`} /></dd>
            <dt>Solar energy per m²</dt>
            <dd><BlurNumber value={m?.energyKWh} format={(v) => `${fmtInt(v)} kWh`} /></dd>
            <dt>Irradiance now, Sun-pointing</dt>
            <dd><BlurNumber value={inst?.irradiance} format={(v) => `${fmtInt(v)} W/m²`} /></dd>
            <dt>Irradiance now, horizontal</dt>
            <dd><BlurNumber value={inst?.irradianceHorizontal} format={(v) => `${fmtInt(v)} W/m²`} /></dd>
            <dt>Earth signal delay</dt>
            <dd><BlurNumber value={inst?.lightTimeS} format={(v) => `${v.toFixed(3)} s`} /></dd>
            <dt>Earth phase from site</dt>
            <dd><BlurNumber value={inst?.earthPhase} format={(v) => fmtPct(v)} /></dd>
            <dt>Terrain horizon, max / mean</dt>
            <dd>{stats ? `${fmtDeg(stats.max, 1)} / ${fmtDeg(stats.mean, 1)}` : '—'}</dd>
          </dl>
        </details>
      </div>
    </>
  );
}

function CompareInspector() {
  const A = useScenarioData('A');
  const B = useScenarioData('B');
  const active = useApp((s) => s.active);
  const setActive = useApp((s) => s.setActive);
  const scenarios = useApp((s) => s.scenarios);
  const ia = useInstant(A, 'A');
  const ib = useInstant(B, 'B');
  type Row = { label: string; a: number | undefined; b: number | undefined; fmt: (v: number) => string; higher?: boolean };
  const rows: Row[] = [
    { label: 'Sun elevation now', a: ia.inst?.sun.el, b: ib.inst?.sun.el, fmt: (v) => fmtDeg(v, 1), higher: true },
    { label: 'Earth elevation now', a: ia.inst?.earth.el, b: ib.inst?.earth.el, fmt: (v) => fmtDeg(v, 1), higher: true },
    { label: 'Sunlight', a: A.mission?.sun.fraction, b: B.mission?.sun.fraction, fmt: (v) => fmtPct(v), higher: true },
    { label: 'Earth link', a: A.mission?.earth.fraction, b: B.mission?.earth.fraction, fmt: (v) => fmtPct(v), higher: true },
    { label: 'Both', a: A.mission?.both.fraction, b: B.mission?.both.fraction, fmt: (v) => fmtPct(v), higher: true },
    { label: 'Longest joint window', a: A.mission?.both.longestMs, b: B.mission?.both.longestMs, fmt: (v) => fmtDuration(v, 1), higher: true },
    { label: 'Longest darkness', a: A.mission?.sun.longestGapMs, b: B.mission?.sun.longestGapMs, fmt: (v) => fmtDuration(v, 1), higher: false },
    { label: 'Solar energy / m²', a: A.mission?.energyKWh, b: B.mission?.energyKWh, fmt: (v) => `${fmtInt(v)} kWh`, higher: true },
  ];
  const verdict = (() => {
    const a = A.mission, b = B.mission;
    if (!a || !b) return null;
    const nA = siteName(scenarios.A.site), nB = siteName(scenarios.B.site);
    const pick = (x: number, y: number) => (Math.abs(x - y) < 0.005 ? null : x > y ? 'A' : 'B');
    const pw = pick(a.sun.fraction, b.sun.fraction);
    const cm = pick(a.earth.fraction, b.earth.fraction);
    const both = pick(a.both.fraction, b.both.fraction);
    const name = (k: string | null) => (k === 'A' ? nA : k === 'B' ? nB : null);
    return { pw: name(pw), cm: name(cm), both: name(both), diff: Math.abs(a.both.fraction - b.both.fraction) };
  })();
  return (
    <>
      <div className="panel-head">
        <div className="cmp-head">
          {(['A', 'B'] as const).map((id) => {
            const sc = scenarios[id];
            const inst = id === 'A' ? ia : ib;
            return (
              <button key={id} type="button" className={`cmp-site ${active === id ? 'is-active' : ''}`} onClick={() => setActive(id)}>
                <div className="n"><span className={`site-tag ${id === 'B' ? 'b' : ''}`}>{id}</span>{siteName(sc.site)}</div>
                <div className="d tnum"><BlurText text={fmtUtc(inst.t)} /></div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="panel-scroll">
        <div className="section" style={{ paddingTop: 6 }}>
          <div className="cmp-table">
            <span />
            <span className="h">A</span>
            <span className="h">B</span>
            {rows.map((r) => {
              const winA = r.a !== undefined && r.b !== undefined && Math.abs(r.a - r.b) > 1e-6 && (r.higher ? r.a > r.b : r.a < r.b);
              const winB = r.a !== undefined && r.b !== undefined && Math.abs(r.a - r.b) > 1e-6 && !winA;
              return (
                <div key={r.label} style={{ display: 'contents' }}>
                  <span className="l">{r.label}</span>
                  <span className={`c ${winA ? 'win' : ''}`}><BlurNumber value={r.a} format={r.fmt} /></span>
                  <span className={`c ${winB ? 'win' : ''}`}><BlurNumber value={r.b} format={r.fmt} /></span>
                </div>
              );
            })}
          </div>
        </div>
        {verdict && (
          <div className="section">
            <div className="verdict">
              {verdict.pw ? <>More sunlight for power: <b>{verdict.pw}</b>. </> : <>Sunlight is about equal. </>}
              {verdict.cm ? <>More direct-to-Earth time: <b>{verdict.cm}</b>. </> : <>Earth visibility is about equal. </>}
              {verdict.both ? <>Joint availability favours <b>{verdict.both}</b> by {fmtPct(verdict.diff)} of the mission.</> : null}
            </div>
          </div>
        )}
        <div className="section">
          <span className="eyebrow">Mission windows</span>
          <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
            {[A, B].map((d) => (
              <div key={d.id}>
                <div className="row" style={{ marginBottom: 8 }}><span className="muted"><span className={`site-tag ${d.id === 'B' ? 'b' : ''}`}>{d.id}</span>{scenarios[d.id].durationDays}-day mission</span><span className="badge">{d.site.model.horizon.kind === 'terrain' ? 'LOLA terrain' : 'Sphere'}</span></div>
                <Availability m={d.mission} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function Inspector() {
  const compare = useApp((s) => s.compare);
  const active = useApp((s) => s.active);
  return (
    <GlassPanel className="panel panel-right" from="right" delay={0.1}>
      <Morph k={compare ? 'cmp' : `single-${active}`} className="panel-morph">
        {compare ? <CompareInspector /> : <SingleInspector id={active} />}
      </Morph>
    </GlassPanel>
  );
}

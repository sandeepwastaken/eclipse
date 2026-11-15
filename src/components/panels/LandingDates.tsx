import { useMemo, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { BlurText } from '../ui/BlurNumber';
import { BothGlyph, EarthGlyph, Segmented, SunGlyph } from '../ui/primitives';
import { useScenarioData } from '../../hooks/data';
import { fmtDate, fmtPct } from '../../lib/format';
import { scanLandingDates } from '../../lib/science/analysis';
import { DAY_MS } from '../../lib/science/constants';
import { siteName, useApp } from '../../state/store';

type Metric = 'both' | 'sun' | 'earth';

/**
 * Landing-date explorer: for every possible landing day in the ephemeris
 * (same time of day), the share of the mission with sunlight, Earth link and
 * both. Click to move the landing date.
 */
export function LandingDates() {
  const active = useApp((s) => s.active);
  const sc = useApp((s) => s.scenarios[active]);
  const setLanding = useApp((s) => s.setLanding);
  const data = useScenarioData(active);
  const [metric, setMetric] = useState<Metric>('both');
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const scan = useMemo(() => (data.long ? scanLandingDates(data.long, sc.landing, sc.durationDays * DAY_MS) : null), [data.long, sc.landing, sc.durationDays]);
  const W = 700, H = 220, top = 10, bottom = 26;
  const ch = H - top - bottom;
  const best = useMemo(() => {
    if (!scan) return null;
    let k = 0;
    for (let i = 1; i < scan.n; i++) if (scan[metric][i] > scan[metric][k]) k = i;
    return k;
  }, [scan, metric]);
  if (!scan) return null;
  const x = (k: number) => (k / (scan.n - 1)) * W;
  const y = (f: number) => top + ch - f * ch;
  const path = (arr: Float32Array) => {
    let d = '';
    for (let k = 0; k < scan.n; k++) d += `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(arr[k]).toFixed(1)}`;
    return d;
  };
  const area = (arr: Float32Array) => `${path(arr)}L${W},${top + ch}L0,${top + ch}Z`;
  const current = Math.round((sc.landing - scan.t0) / scan.step);
  const k = hover ?? current;
  const years = [2026, 2027, 2028].map((yr) => ({ yr, k: (Date.UTC(yr, 0, 1) - scan.t0) / scan.step })).filter((v) => v.k >= 0 && v.k < scan.n);
  const months = Array.from({ length: 36 }, (_, i) => (Date.UTC(2026, i, 1) - scan.t0) / scan.step).filter((v) => v > 0 && v < scan.n);
  const color = metric === 'sun' ? 'var(--sun)' : metric === 'earth' ? 'var(--earth)' : '#fff';
  const pick = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    return Math.max(0, Math.min(scan.n - 1, Math.round(((clientX - r.left) / r.width) * (scan.n - 1))));
  };
  return (
    <Sheet title={`When to land at ${siteName(sc.site)}`} eyebrow={`${sc.durationDays}-day mission · 2026–2028`} width={820}>
      <div className="sheet-body">
        <div className="row" style={{ marginBottom: 14 }}>
          <Segmented
            small
            label="Metric"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'both', label: <><BothGlyph size={12} /> Sun + Earth</> },
              { value: 'sun', label: <><SunGlyph size={12} /> Sunlight</> },
              { value: 'earth', label: <><EarthGlyph size={12} /> Earth link</> },
            ]}
          />
          <div className="tnum" style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--label)', letterSpacing: '-0.02em' }}>
              <BlurText text={fmtPct(scan[metric][k])} />
            </div>
            <div className="faint" style={{ fontSize: 12 }}><BlurText text={`Landing ${fmtDate(scan.t0 + k * scan.step)}`} /></div>
          </div>
        </div>
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', cursor: 'crosshair', touchAction: 'none' }}
          onPointerMove={(e) => setHover(pick(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => setLanding(active, scan.t0 + pick(e.clientX) * scan.step)}
          role="img"
          aria-label="Availability by landing date"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={0} x2={W} y1={y(f)} y2={y(f)} stroke="rgba(255,255,255,0.07)" />
              <text x={W} y={y(f) - 3} textAnchor="end" className="tl-label">{f * 100}%</text>
            </g>
          ))}
          {months.map((m) => <line key={m} x1={x(m)} x2={x(m)} y1={top + ch} y2={top + ch + 4} stroke="rgba(255,255,255,0.2)" />)}
          {years.map((v) => <text key={v.yr} x={x(v.k) + 2} y={H - 4} className="tl-label">{v.yr}</text>)}
          <path d={area(scan[metric])} fill={color} opacity={0.12} />
          {metric !== 'sun' && <path d={path(scan.sun)} fill="none" stroke="var(--sun)" strokeWidth={0.8} opacity={0.35} />}
          {metric !== 'earth' && <path d={path(scan.earth)} fill="none" stroke="var(--earth)" strokeWidth={0.8} opacity={0.35} />}
          <path d={path(scan[metric])} fill="none" stroke={color} strokeWidth={1.4} />
          {best !== null && <circle cx={x(best)} cy={y(scan[metric][best])} r={4} fill="#000" stroke={color} strokeWidth={1.5} />}
          <line x1={x(current)} x2={x(current)} y1={top} y2={top + ch} stroke="#fff" strokeWidth={1.5} />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + ch} stroke="rgba(255,255,255,0.4)" strokeDasharray="2 3" />}
        </svg>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="note">Click to set the landing date. Polar seasons come from the Moon's 1.5° axial tilt.</span>
          {best !== null && (
            <button type="button" className="chip" style={{ flex: 'none' }} onClick={() => setLanding(active, scan.t0 + best * scan.step)}>
              Best: {fmtDate(scan.t0 + best * scan.step)} · {fmtPct(scan[metric][best])}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

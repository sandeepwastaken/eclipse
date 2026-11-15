import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GlassPanel } from '../ui/primitives';
import { viewHeading } from '../surface/viewState';
import { useEphemeris, useScenarioData, useThrottledElapsed } from '../../hooks/data';
import { instantAt } from '../../lib/science/analysis';
import { horizonAt } from '../../lib/science/horizon';
import { playheadTime, useApp } from '../../state/store';


/**
 * Unrolled 360° horizon panorama for the surface view: LOLA terrain horizon,
 * the Sun's and Earth's tracks over the mission, their current positions, and
 * the camera's field of view. The x axis is centred on the camera heading.
 */
export function Panorama() {
  const active = useApp((s) => s.active);
  const sc = useApp((s) => s.scenarios[active]);
  const criteria = useApp((s) => s.criteria);
  const data = useScenarioData(active);
  const { eph } = useEphemeris();
  const elapsed = useThrottledElapsed(15);
  const strip = useRef<SVGGElement>(null);
  const fov = useRef<SVGRectElement>(null);
  // Draw in real pixels so dots stay round and strokes stay crisp.
  const box = useRef<HTMLDivElement>(null);
  const [{ W, H }, setDims] = useState({ W: 720, H: 108 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setDims({ W: Math.max(100, e.contentRect.width), H: Math.max(40, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The strip is drawn once in absolute azimuth and slid under a fixed centre line on the
  // GPU (transform only), so turning the camera never re-renders the SVG.
  useEffect(() => {
    let raf = 0;
    let lastAz = -1, lastFov = -1;
    const tick = () => {
      if (Math.abs(viewHeading.az - lastAz) > 0.05 && strip.current) {
        lastAz = viewHeading.az;
        strip.current.setAttribute('transform', `translate(${(W / 2 - (lastAz / 360) * W).toFixed(2)},0)`);
      }
      if (Math.abs(viewHeading.hfov - lastFov) > 0.2 && fov.current) {
        lastFov = viewHeading.hfov;
        const fw = (Math.min(lastFov, 359) / 360) * W;
        fov.current.setAttribute('x', String(W / 2 - fw / 2));
        fov.current.setAttribute('width', String(fw));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [W]);

  const hz = data.site.model.horizon;
  const series = data.mission?.series;
  const [lo, hi] = useMemo(() => {
    let mx = 4, mn = -4;
    for (let a = 0; a < 360; a += 2) mx = Math.max(mx, horizonAt(hz, a) + 2);
    if (series) {
      for (let i = 0; i < series.n; i += 4) {
        mx = Math.max(mx, series.sunEl[i] + 2, series.earthEl[i] + 2);
        mn = Math.min(mn, series.sunEl[i] - 1, series.earthEl[i] - 1);
      }
    }
    // Fit every track, but don't spend more than a little room below the horizon.
    return [Math.max(-15, Math.floor(mn)), Math.min(90, Math.ceil(mx))];
  }, [hz, series]);

  const x = (az: number) => (((az % 360) + 360) % 360 / 360) * W;
  const y = (el: number) => 6 + (H - 22) * (1 - (el - lo) / (hi - lo));

  const terrainPath = useMemo(() => {
    const pts: string[] = [];
    for (let k = 0; k <= 720; k++) pts.push(`${((k / 720) * W).toFixed(1)},${y(horizonAt(hz, k * 0.5)).toFixed(1)}`);
    return { fill: `M0,${H - 16}L${pts.join('L')}L${W},${H - 16}Z`, line: `M${pts.join('L')}` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hz, lo, hi, W, H]);

  // Each track is one path of zero-length round-capped segments: hundreds of dots, one element.
  const tracks = useMemo(() => {
    if (!series) return null;
    const dots = (az: Float32Array, el: Float32Array, hor: Float32Array) => {
      let vis = '', hid = '';
      const stride = Math.max(1, Math.floor(series.n / 600));
      for (let i = 0; i < series.n; i += stride) {
        const seg = `M${x(az[i]).toFixed(1)} ${y(el[i]).toFixed(1)}h0`;
        if (el[i] > hor[i]) vis += seg;
        else hid += seg;
      }
      return { vis, hid };
    };
    return { sun: dots(series.sunAz, series.sunEl, series.sunHorizon), earth: dots(series.earthAz, series.earthEl, series.earthHorizon) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, lo, hi, W, H]);

  const now = eph ? instantAt(eph, data.site.model, playheadTime(sc, elapsed), criteria) : null;
  const cards = [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const;
  const content = (
    <>
      <path d={terrainPath.fill} fill="rgba(160,160,165,0.16)" />
      <path d={terrainPath.line} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1} />
      {tracks && (
        <>
          <path d={tracks.sun.hid} stroke="var(--sun)" strokeOpacity={0.25} strokeWidth={1.8} strokeLinecap="round" />
          <path d={tracks.earth.hid} stroke="var(--earth)" strokeOpacity={0.25} strokeWidth={1.8} strokeLinecap="round" />
          <path d={tracks.sun.vis} stroke="var(--sun)" strokeOpacity={0.9} strokeWidth={2.6} strokeLinecap="round" />
          <path d={tracks.earth.vis} stroke="var(--earth)" strokeOpacity={0.9} strokeWidth={2.6} strokeLinecap="round" />
        </>
      )}
      {now && (
        <>
          <circle cx={x(now.sun.az)} cy={y(now.sun.el)} r={5} fill="var(--sun)" stroke="#000" strokeWidth={1.5} />
          <circle cx={x(now.earth.az)} cy={y(now.earth.el)} r={5} fill="var(--earth)" stroke="#000" strokeWidth={1.5} />
        </>
      )}
      {cards.map(([l, az]) => (
        <text key={l} x={x(az)} y={H - 3} textAnchor="middle" className="tl-label" style={{ fontWeight: 600 }}>{l}</text>
      ))}
    </>
  );

  return (
    <GlassPanel className="panorama" from="bottom" delay={0.05}>
      <div ref={box} style={{ position: 'absolute', inset: '8px 10px 6px' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="360 degree horizon panorama with Sun and Earth tracks" style={{ overflow: 'hidden' }}>
        <defs>
          <clipPath id="pano-clip">
            <rect x={0} y={0} width={W} height={H} />
          </clipPath>
        </defs>
        <rect ref={fov} x={W / 2 - W / 12} y={2} width={W / 6} height={H - 18} rx={6} fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.12)" strokeWidth={0.5} />
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 4" />
        <g clipPath="url(#pano-clip)">
          <g ref={strip}>
            <g transform={`translate(${-W},0)`}>{content}</g>
            {content}
            <g transform={`translate(${W},0)`}>{content}</g>
          </g>
        </g>
        <text x={4} y={y(0) - 3} className="tl-label">0°</text>
        <text x={4} y={12} className="tl-label">{hi}°</text>
      </svg>
      </div>
    </GlassPanel>
  );
}

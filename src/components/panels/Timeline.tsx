import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BlurText } from '../ui/BlurNumber';
import { GlassPanel, Segmented } from '../ui/primitives';
import { useScenarioData, type ScenarioData } from '../../hooks/data';
import { fmtDate, fmtElapsed, fmtShortDate, fmtTime, fromInputUtc, toInputUtc } from '../../lib/format';
import { DAY_MS, HOUR_MS } from '../../lib/science/constants';
import type { Interval } from '../../lib/science/analysis';
import { SPEEDS, playheadTime, useApp } from '../../state/store';
import { VoiceToggle } from './VoiceCallouts';

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 100 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The slice of the mission the chart shows: from v0 (ms after landing) for vs ms. */
interface View {
  v0: number;
  vs: number;
}
const VIEW_DAYS = 30; // longer missions are shown 30 days at a time, following the playhead

function indexRange(s: { n: number; step: number }, view: View): [number, number] {
  return [Math.max(0, Math.floor(view.v0 / s.step) - 1), Math.min(s.n - 1, Math.ceil((view.v0 + view.vs) / s.step) + 1)];
}

function Bands({ intervals, t0, view, w, y, h, color, opacity = 1 }: { intervals: Interval[]; t0: number; view: View; w: number; y: number; h: number; color: string; opacity?: number }) {
  return (
    <g>
      <rect x={0} y={y} width={w} height={h} rx={h / 2} fill="rgba(255,255,255,0.05)" />
      {intervals.map((iv, i) => (
        <rect key={i} x={((iv.start - t0 - view.v0) / view.vs) * w} y={y} width={Math.max(1, ((iv.end - iv.start) / view.vs) * w)} height={h} rx={Math.min(h / 2, 3)} fill={color} opacity={opacity} />
      ))}
    </g>
  );
}

function elevationPath(d: ScenarioData, key: 'sunEl' | 'earthEl', w: number, y0: number, h: number, lo: number, hi: number, view: View): string {
  const s = d.mission?.series;
  if (!s) return '';
  const pts: string[] = [];
  const [i0, i1] = indexRange(s, view);
  const stride = Math.max(1, Math.floor((i1 - i0) / (w * 1.5)));
  for (let i = i0; i <= i1; i += stride) {
    const x = ((i * s.step - view.v0) / view.vs) * w;
    const y = y0 + h - ((s[key][i] - lo) / (hi - lo)) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}

/** Closed shapes between a body's elevation curve and its terrain horizon, where it is above it (= in view). */
function visibleFill(d: ScenarioData, elKey: 'sunEl' | 'earthEl', horKey: 'sunHorizon' | 'earthHorizon', w: number, y0: number, h: number, lo: number, hi: number, view: View): string {
  const s = d.mission?.series;
  if (!s) return '';
  const [i0, i1] = indexRange(s, view);
  const stride = Math.max(1, Math.floor((i1 - i0) / (w * 1.5)));
  const Y = (v: number) => y0 + h - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * h;
  let out = '';
  let top: string[] = [], bot: string[] = [];
  const close = () => {
    if (top.length > 1) out += `M${top.join('L')}L${bot.reverse().join('L')}Z`;
    top = [];
    bot = [];
  };
  for (let i = i0; i <= i1; i += stride) {
    const x = ((i * s.step - view.v0) / view.vs) * w;
    const e = s[elKey][i], hz = s[horKey][i];
    if (e > hz) {
      top.push(`${x.toFixed(1)},${Y(e).toFixed(1)}`);
      bot.push(`${x.toFixed(1)},${Y(hz).toFixed(1)}`);
    } else close();
  }
  close();
  return out;
}

function horizonPath(d: ScenarioData, key: 'sunHorizon' | 'earthHorizon', w: number, y0: number, h: number, lo: number, hi: number, view: View) {
  const s = d.mission?.series;
  if (!s) return '';
  const pts: string[] = [];
  const [i0, i1] = indexRange(s, view);
  const stride = Math.max(1, Math.floor((i1 - i0) / (w * 1.5)));
  for (let i = i0; i <= i1; i += stride) {
    const x = ((i * s.step - view.v0) / view.vs) * w;
    const y = y0 + h - ((Math.max(lo, Math.min(hi, s[key][i])) - lo) / (hi - lo)) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}

const GUTTER = 64; // left column for the track legend and percentages

/**
 * Date/time readout. It follows the playhead on its own (throttled) subscription, so the
 * chart beside it never re-renders while time runs.
 */
function TimeReadout({ span }: { span: number }) {
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(() => {
    const st = useApp.getState();
    return playheadTime(st.scenarios[st.active], st.elapsed);
  });
  const landing = useApp((s) => s.scenarios[s.active].landing);
  useEffect(() => {
    let last = 0;
    let timer = 0;
    const push = () => {
      timer = 0;
      last = performance.now();
      const st = useApp.getState();
      setT(playheadTime(st.scenarios[st.active], st.elapsed));
    };
    push();
    const unsub = useApp.subscribe(() => {
      if (performance.now() - last > 80) push();
      else if (!timer) timer = window.setTimeout(push, 80);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);
  const { setElapsed, setPlaying } = useApp.getState();
  return (
    <div className="tl-time">
      {editing ? (
        <input
          className="input tl-date-input tnum"
          type="datetime-local"
          autoFocus
          defaultValue={toInputUtc(t)}
          min="2026-01-01T00:00"
          max="2028-12-31T00:00"
          aria-label="Go to date and time (UTC)"
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={(e) => {
            setEditing(false);
            const v = fromInputUtc(e.target.value);
            if (!Number.isFinite(v)) return;
            const st = useApp.getState();
            const s0 = st.scenarios[st.active];
            // Inside the mission: move the playhead. Outside: move the landing so the mission starts there.
            if (v >= s0.landing && v <= s0.landing + span) setElapsed(v - s0.landing);
            else {
              st.setLanding(st.active, v);
              setElapsed(0);
            }
          }}
        />
      ) : (
        <button type="button" className="tl-date tnum" onClick={() => { setPlaying(false); setEditing(true); }} title="Click to go to a date">
          <BlurText text={`${fmtDate(t)}  ${fmtTime(t)}`} />
        </button>
      )}
      <span className="tl-elapsed tnum">UTC · <BlurText text={fmtElapsed(t - landing)} /></span>
    </div>
  );
}

export function Timeline() {
  const A = useScenarioData('A');
  const compare = useApp((s) => s.compare);
  const B = useScenarioData('B', compare);
  const active = useApp((s) => s.active);
  const scenarios = useApp((s) => s.scenarios);
  const playing = useApp((s) => s.playing);
  const setPlaying = useApp((s) => s.setPlaying);
  const speed = useApp((s) => s.speed);
  const setSpeed = useApp((s) => s.setSpeed);
  const setElapsed = useApp((s) => s.setElapsed);
  const [ref, size] = useSize<HTMLDivElement>();
  const head = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const spanDays = Math.max(scenarios.A.durationDays, compare ? scenarios.B.durationDays : 0);
  const span = spanDays * DAY_MS;
  const fullW = size.w;
  const w = Math.max(10, fullW - GUTTER);
  // Missions longer than VIEW_DAYS are shown a window at a time; the window follows the playhead.
  const viewSpan = Math.min(span, VIEW_DAYS * DAY_MS);
  const [viewStart, setViewStart] = useState(0);
  const view = useMemo<View>(() => ({ v0: Math.min(viewStart, Math.max(0, span - viewSpan)), vs: viewSpan }), [viewStart, span, viewSpan]);
  useEffect(() => {
    const follow = (e: number) => {
      setViewStart((v0) => {
        const max = Math.max(0, span - viewSpan);
        if (e < v0) return Math.max(0, Math.min(max, e - viewSpan * 0.85)); // went back: show what led here
        if (e > v0 + viewSpan * 0.97) return Math.max(0, Math.min(max, e - viewSpan * 0.1)); // page forward
        return Math.min(v0, max);
      });
    };
    follow(useApp.getState().elapsed);
    return useApp.subscribe((st, prev) => {
      if (st.elapsed !== prev.elapsed) follow(st.elapsed);
    });
  }, [span, viewSpan]);
  const primary = active === 'A' || !compare ? A : B;

  // The playhead (and the slider's accessible value) follow the store without re-rendering the SVG.
  useEffect(() => {
    let lastAria = -1;
    const apply = () => {
      const st = useApp.getState();
      const k = (st.elapsed - view.v0) / view.vs;
      if (head.current) {
        head.current.style.transform = `translateX(${GUTTER + k * w}px)`;
        head.current.style.opacity = k < -0.001 || k > 1.001 ? '0' : '1';
      }
      const hours = Math.round(st.elapsed / HOUR_MS);
      if (hours !== lastAria && ref.current) {
        lastAria = hours;
        const t = playheadTime(st.scenarios[st.active], st.elapsed);
        ref.current.setAttribute('aria-valuenow', String(hours));
        ref.current.setAttribute('aria-valuetext', `${fmtDate(t)} ${fmtTime(t)} UTC`);
      }
    };
    apply();
    return useApp.subscribe(apply);
  }, [span, w, view, ref]);

  const toElapsed = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return view.v0 + Math.max(0, Math.min(1, (clientX - r.left - GUTTER) / (r.width - GUTTER))) * view.vs;
  }, [ref, view]);

  const events = useMemo(() => {
    const out: number[] = [];
    for (const d of compare ? [A, B] : [A]) {
      const m = d.mission;
      if (!m) continue;
      for (const ch of [m.sun, m.earth]) for (const iv of ch.intervals) out.push(iv.start - m.t0, iv.end - m.t0);
    }
    return [...new Set(out.map((x) => Math.round(x / 60_000) * 60_000))].filter((x) => x > 0 && x < span).sort((a, b) => a - b);
  }, [A, B, compare, span]);

  // Play at the end of the mission starts again from landing.
  const togglePlay = () => {
    const st = useApp.getState();
    if (!st.playing && st.elapsed >= span - 1000) setElapsed(0);
    setPlaying(!st.playing);
  };

  const jump = (dir: 1 | -1) => {
    const e = useApp.getState().elapsed;
    const target = dir > 0 ? events.find((x) => x > e + 60_000) : [...events].reverse().find((x) => x < e - 60_000);
    setElapsed(target ?? (dir > 0 ? span : 0));
  };

  // Layout
  const H = size.h;
  const chartH = compare ? Math.max(28, H - 66) : Math.max(36, H - 64);
  const lo = useMemo(() => {
    const m = primary.mission;
    if (!m) return -10;
    return Math.max(-90, Math.floor(Math.min(m.sunElRange[0], m.earthElRange[0], -2) - 1));
  }, [primary.mission]);
  const hi = useMemo(() => {
    const m = primary.mission;
    if (!m) return 10;
    return Math.min(90, Math.ceil(Math.max(m.sunElRange[1], m.earthElRange[1], 2) + 1));
  }, [primary.mission]);
  const zeroY = 4 + chartH - ((0 - lo) / (hi - lo)) * chartH;
  const bandY = chartH + 12;
  // Day ticks across the visible window (mission days since landing).
  const viewDays = view.vs / DAY_MS;
  const ticks = useMemo(() => {
    const count = Math.min(viewDays, Math.floor(w / 70));
    const stepDays = Math.max(1, Math.ceil(viewDays / Math.max(1, count)));
    const first = Math.ceil(view.v0 / DAY_MS / stepDays) * stepDays;
    const out: number[] = [];
    for (let d = first; d <= (view.v0 + view.vs) / DAY_MS + 1e-6; d += stepDays) out.push(d);
    return out;
  }, [viewDays, w, view.v0, view.vs]);
  const tx = (d: number) => ((d * DAY_MS - view.v0) / view.vs) * w;

  const sc = scenarios[active];
  const hover = useMemo(() => {
    if (hoverX === null || hoverX < GUTTER) return null;
    const s = primary.mission?.series;
    const e = view.v0 + ((hoverX - GUTTER) / w) * view.vs;
    if (!s) return null;
    const i = Math.max(0, Math.min(s.n - 1, Math.round(e / s.step)));
    return { x: hoverX, t: sc.landing + e, sun: s.sunEl[i], earth: s.earthEl[i], sunVis: s.sunEl[i] > s.sunHorizon[i], earthVis: s.earthEl[i] > s.earthHorizon[i] };
  }, [hoverX, primary.mission, w, view, sc.landing]);

  return (
    <GlassPanel className="timeline" from="bottom" delay={0.15}>
      <div className="tl-bar">
        <button type="button" className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} fill="#000" /> : <Play size={16} fill="#000" style={{ marginLeft: 2 }} />}
        </button>
        <button type="button" className="icon-btn flat" onClick={() => jump(-1)} aria-label="Previous event"><ChevronLeft size={16} /></button>
        <button type="button" className="icon-btn flat" onClick={() => jump(1)} aria-label="Next event"><ChevronRight size={16} /></button>
        <TimeReadout span={span} />
        <div className="tl-spacer" />
        <VoiceToggle />
        <span className="faint" style={{ fontSize: 11.5 }}>Speed</span>
        <Segmented small label="Playback speed" value={speed} onChange={setSpeed} options={SPEEDS.map((s) => ({ value: s, label: s < 24 ? `${s}h/s` : s === 168 ? '1w/s' : `${s / 24}d/s` }))} />
      </div>
      <div
        ref={ref}
        className="tl-tracks"
        role="slider"
        tabIndex={0}
        aria-label="Mission time"
        aria-valuemin={0}
        aria-valuemax={spanDays * 24}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setPlaying(false);
          setElapsed(toElapsed(e.clientX));
        }}
        onPointerMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          setHoverX(e.clientX - r.left);
          if (e.buttons & 1) setElapsed(toElapsed(e.clientX));
        }}
        onPointerLeave={() => setHoverX(null)}
        onKeyDown={(e) => {
          const st = useApp.getState();
          const step = e.shiftKey ? DAY_MS : HOUR_MS;
          if (e.key === 'ArrowRight') setElapsed(st.elapsed + step);
          else if (e.key === 'ArrowLeft') setElapsed(st.elapsed - step);
          else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
          else return;
          e.preventDefault();
        }}
      >
        <svg width={fullW} height={H} aria-hidden>
          {/* legend column */}
          <text x={0} y={10} className="tl-label">{hi}°</text>
          <text x={0} y={zeroY + 3} className="tl-label">0°</text>
          <text x={0} y={chartH + 2} className="tl-label">{lo}°</text>
          {(compare ? [A, B] : [A]).map((d, gi) => {
            const y = bandY + gi * 26;
            const bh = compare ? 6 : 10;
            const gap = compare ? 2 : 3;
            const pct = (f: number | undefined) => (f === undefined ? '' : ` ${Math.round(f * 100)}%`);
            const m = d.mission;
            return compare ? (
              <text key={d.id} x={0} y={y + bh * 1.5 + gap + 3} className="tl-label tl-legend">{d.id}</text>
            ) : (
              <g key={d.id} className="tl-legend">
                <text x={0} y={y + bh - 1.5} className="tl-label" style={{ fill: 'var(--sun)' }}>Sun{pct(m?.sun.fraction)}</text>
                <text x={0} y={y + 2 * bh + gap - 1.5} className="tl-label" style={{ fill: 'var(--earth)' }}>Earth{pct(m?.earth.fraction)}</text>
                <text x={0} y={y + 3 * bh + 2 * gap - 1.5} className="tl-label" style={{ fill: '#fff' }}>Both{pct(m?.both.fraction)}</text>
              </g>
            );
          })}
          <defs>
            <clipPath id="tl-window"><rect x={0} y={-4} width={w} height={H + 8} /></clipPath>
          </defs>
          <g transform={`translate(${GUTTER},0)`}>
            {/* day grid */}
            {ticks.map((d) => (
              <line key={`g${d}`} x1={tx(d)} x2={tx(d)} y1={4} y2={chartH + 4} stroke="rgba(255,255,255,0.045)" />
            ))}
            <line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.16)" strokeDasharray="2 4" />
            <g transform="translate(0,4)" clipPath="url(#tl-window)">
              {/* Shaded = in view: each body's curve filled down to the terrain horizon at its own azimuth. */}
              {primary.mission && (
                <>
                  <path d={visibleFill(primary, 'earthEl', 'earthHorizon', w, 0, chartH, lo, hi, view)} fill="var(--earth)" fillOpacity={0.28} />
                  <path d={visibleFill(primary, 'sunEl', 'sunHorizon', w, 0, chartH, lo, hi, view)} fill="var(--sun)" fillOpacity={0.3} />
                  <path d={horizonPath(primary, 'earthHorizon', w, 0, chartH, lo, hi, view)} fill="none" stroke="var(--earth)" strokeOpacity={0.45} strokeWidth={0.9} strokeDasharray="1.5 2.5" />
                  <path d={horizonPath(primary, 'sunHorizon', w, 0, chartH, lo, hi, view)} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={0.9} strokeDasharray="1.5 2.5" />
                </>
              )}
              <path d={elevationPath(primary, 'earthEl', w, 0, chartH, lo, hi, view)} fill="none" stroke="var(--earth)" strokeWidth={1.4} strokeLinejoin="round" opacity={0.95} />
              <path d={elevationPath(primary, 'sunEl', w, 0, chartH, lo, hi, view)} fill="none" stroke="var(--sun)" strokeWidth={1.7} strokeLinejoin="round" />
            </g>
            {/* availability bands */}
            <g clipPath="url(#tl-window)">
            {(compare ? [A, B] : [A]).map((d, gi) => {
              const m = d.mission;
              const y = bandY + gi * 26;
              const bh = compare ? 6 : 10;
              const gap = compare ? 2 : 3;
              if (!m) return null;
              return (
                <g key={d.id}>
                  <Bands intervals={m.sun.intervals} t0={m.t0} view={view} w={w} y={y} h={bh} color="var(--sun)" />
                  <Bands intervals={m.earth.intervals} t0={m.t0} view={view} w={w} y={y + bh + gap} h={bh} color="var(--earth)" />
                  <Bands intervals={m.both.intervals} t0={m.t0} view={view} w={w} y={y + 2 * (bh + gap)} h={bh} color="#fff" />
                </g>
              );
            })}
            </g>
            {ticks.map((d) => (
              <text key={d} x={tx(d)} y={H - 1} textAnchor={tx(d) < 20 ? 'start' : tx(d) > w - 20 ? 'end' : 'middle'} className="tl-label">
                Day {d}
              </text>
            ))}
          </g>
        </svg>
        {hover && (
          <div className="tl-tip tnum" style={{ left: Math.min(Math.max(hover.x, GUTTER + 90), fullW - 90) }}>
            <span>{fmtShortDate(hover.t)} {fmtTime(hover.t)}</span>
            <span style={{ color: 'var(--sun)', opacity: hover.sunVis ? 1 : 0.45 }}>☀ {hover.sun.toFixed(1)}°</span>
            <span style={{ color: 'var(--earth)', opacity: hover.earthVis ? 1 : 0.45 }}>◍ {hover.earth.toFixed(1)}°</span>
          </div>
        )}
        {hoverX !== null && hoverX >= GUTTER && <div className="tl-hover" style={{ left: hoverX }} />}
        <div ref={head} className="tl-playhead"><div className="tl-knob" /></div>
      </div>
    </GlassPanel>
  );
}

/** Advances the shared playhead while playing (simulated hours per real second). */
export function PlaybackTicker() {
  const playing = useApp((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const st = useApp.getState();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const max = Math.max(st.scenarios.A.durationDays, st.compare ? st.scenarios.B.durationDays : 0) * DAY_MS;
      const next = st.elapsed + dt * st.speed * HOUR_MS;
      if (next >= max) {
        st.setElapsed(max);
        st.setPlaying(false);
        return;
      }
      st.setElapsed(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return null;
}

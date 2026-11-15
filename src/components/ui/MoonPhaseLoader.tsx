import { useEffect, useRef } from 'react';

const R = 50;

/** Shadow region of the disk for a phase angle φ (0 = new, π = full). */
function shadowPath(phi: number) {
  const k = Math.cos(phi);
  const rx = Math.abs(k) * R;
  const waxing = phi < Math.PI;
  // Dark limb half: left while waxing, right while waning.
  const limbSweep = waxing ? 0 : 1;
  const termSweep = waxing ? (k > 0 ? 0 : 1) : k < 0 ? 0 : 1;
  return `M50,0 A${R},${R} 0 0 ${limbSweep} 50,100 A${rx.toFixed(2)},${R} 0 0 ${termSweep} 50,0 Z`;
}

const PHASES = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

/**
 * The logo Moon (its real near-side maria) running through a lunation in a few seconds: the
 * terminator sweeps across, the night side keeps a faint earthshine, and the caption names the
 * phase. The disk breathes very slightly so the loader never looks frozen between phases.
 */
export function MoonPhaseLoader({ size = 76, label = 'Loading' }: { size?: number; label?: string }) {
  const path = useRef<SVGPathElement>(null);
  const caption = useRef<HTMLSpanElement>(null);
  const disk = useRef<SVGGElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      path.current?.setAttribute('d', shadowPath(Math.PI * 0.6));
      return;
    }
    let raf = 0;
    let lastName = '';
    const t0 = performance.now();
    const tick = (now: number) => {
      const u = ((now - t0) / 3600) % 1;
      // Ease through each half so the crescents linger and the full Moon is a beat.
      const phi = u * Math.PI * 2;
      path.current?.setAttribute('d', shadowPath(phi));
      const name = PHASES[Math.round(u * 8) % 8];
      if (name !== lastName && caption.current) {
        lastName = name;
        caption.current.textContent = name;
      }
      disk.current?.setAttribute('transform', `rotate(${(Math.sin(now / 1900) * 2.4).toFixed(2)} 50 50)`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="moon-loader" role="status" aria-live="polite" aria-label={label}>
      <svg viewBox="-4 -4 108 108" width={size} height={size} aria-hidden>
        <defs>
          <clipPath id="ml-disk">
            <circle cx="50" cy="50" r="50" />
          </clipPath>
          <radialGradient id="ml-glow" cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="54" fill="url(#ml-glow)" className="ml-halo" />
        <g ref={disk} clipPath="url(#ml-disk)">
          {/* Logo art scaled so its 476/1000 disk fills r = 50. */}
          <image href={`${import.meta.env.BASE_URL}assets/moon-logo.svg`} x={-500 / 9.52 + 50} y={-500 / 9.52 + 50} width={1000 / 9.52} height={1000 / 9.52} />
        </g>
        <g clipPath="url(#ml-disk)">
          <path ref={path} d={shadowPath(0)} fill="#000" fillOpacity={0.9} />
        </g>
        <circle cx="50" cy="50" r="51.5" fill="none" stroke="#fff" strokeWidth="1.6" />
      </svg>
      <span className="moon-loader-label">{label}</span>
      <span ref={caption} className="moon-loader-phase">New Moon</span>
    </div>
  );
}

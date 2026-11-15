import { earthAt, earthRotationAt, skyRotationAt, sunAt } from '../../lib/science/ephemeris';
import { normalize, type Quat, type V3 } from '../../lib/science/vec';
import { ephemerisNow } from '../../hooks/data';
import { playheadTime, useApp } from '../../state/store';

/** Per-frame snapshot of the simulated sky, read directly from the store (no React re-render). */
export interface SkyState {
  t: number;
  sun: V3;
  earth: V3;
  sunDir: V3;
  earthDir: V3;
  qSky: Quat;
  qEarth: Quat;
  earthPhase: number;
}

const snap: SkyState = { t: 0, sun: [1, 0, 0], earth: [1, 0, 0], sunDir: [1, 0, 0], earthDir: [1, 0, 0], qSky: [0, 0, 0, 1], qEarth: [0, 0, 0, 1], earthPhase: 0.5 };

export function currentTime(scenario?: 'A' | 'B'): number {
  const st = useApp.getState();
  return playheadTime(st.scenarios[scenario ?? st.active], st.elapsed);
}

export function skyAt(t: number): SkyState | null {
  const eph = ephemerisNow();
  if (!eph) return null;
  snap.t = t;
  sunAt(eph, t, snap.sun);
  earthAt(eph, t, snap.earth);
  normalize(snap.sun, snap.sunDir);
  normalize(snap.earth, snap.earthDir);
  skyRotationAt(eph, t, snap.qSky);
  earthRotationAt(eph, t, snap.qEarth);
  const es: V3 = [snap.sun[0] - snap.earth[0], snap.sun[1] - snap.earth[1], snap.sun[2] - snap.earth[2]];
  const l = Math.hypot(...es) * Math.hypot(...snap.earth);
  const cos = -(es[0] * snap.earth[0] + es[1] * snap.earth[1] + es[2] * snap.earth[2]) / l;
  snap.earthPhase = (1 + cos) / 2;
  return snap;
}

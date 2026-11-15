import { create } from 'zustand';

/** Mutable camera heading shared between the 3D surface view and the 2D panorama (no React state). */
export const viewHeading = { az: 0, el: 0, hfov: 60, active: false };

/** Direction in the surface frame (three: east, up, −north) for a local azimuth/elevation in degrees. */
export function dirFromAzEl(az: number, el: number, r = 1): [number, number, number] {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e) * r, Math.sin(e) * r, -Math.cos(a) * Math.cos(e) * r];
}

/** Lander placement in the surface frame (m). `descentStart` is a performance.now() timestamp, null when parked. */
export const lander = {
  pos: { x: 0, z: 0, set(x: number, _y: number, z: number) { this.x = x; this.z = z; } },
  alt: 0,
  groundY: 0,
  maxRadius: 110,
  descentStart: null as number | null,
};
if (import.meta.env.DEV) (window as unknown as { __landerState: unknown }).__landerState = lander;


/** Double-click lock: the camera tracks this body until it is double-clicked again. */
export const useLock = create<{ lock: 'sun' | 'earth' | null; occluded: boolean; setLock: (l: 'sun' | 'earth' | null) => void; setOccluded: (o: boolean) => void }>((set) => ({
  lock: null,
  occluded: false,
  setLock: (lock) => set({ lock }),
  setOccluded: (occluded) => set({ occluded }),
}));

/** First-person walking: while true the orbit controls are unmounted and the walk controller drives the camera. */
export const useWalkMode = create<{ fp: boolean }>(() => ({ fp: false }));
/** Where the orbit controls should aim when they take the camera back (e.g. the astronaut after a walk). */
export const cameraRest: { override: { x: number; y: number; z: number } | null } = { override: null };

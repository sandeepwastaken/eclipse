import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { moonToSurfaceMatrix, moonToThree } from './frames';
import type { SkyState as Sky } from './sim';
import { MOON_RADIUS_KM } from '../../lib/science/constants';
import type { SiteFrame } from '../../lib/science/topocentric';
import type { ViewMode } from '../../state/store';

/**
 * Orbit ⇄ surface hand-off. Both views agree on one camera pose above the site
 * (the "gate"): the leaving view flies its camera there, the scene swaps, and the
 * arriving view starts from exactly that pose and flies on. The gate sits on the
 * sunward-side flank so terrain relief reads as the camera descends.
 */
export const viewTransition: {
  exit: ((to: ViewMode) => Promise<void>) | null;
  /** Set by the scene when a swap happened through the gate. */
  arrivedFrom: ViewMode | null;
} = { exit: null, arrivedFrom: null };

export interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
}

const Y = new THREE.Vector3(0, 1, 0);

/** Sun and Earth unit vectors in the surface frame (three = east, up, −north). */
export function surfaceDirs(frame: SiteFrame, sky: Sky) {
  const m = moonToSurfaceMatrix(frame);
  const P = frame.position;
  // Topocentric: seen from the site, not the Moon's centre (Earth shifts ~0.26° by parallax).
  return {
    sun: new THREE.Vector3(sky.sun[0] - P[0], sky.sun[1] - P[1], sky.sun[2] - P[2]).applyMatrix4(m).normalize(),
    earth: new THREE.Vector3(sky.earth[0] - P[0], sky.earth[1] - P[1], sky.earth[2] - P[2]).applyMatrix4(m).normalize(),
  };
}

/** Horizontal camera direction for the lander shot: Sun raking across the vehicle from the side. */
export function sideDir(sunENU: THREE.Vector3) {
  const flat = new THREE.Vector3(sunENU.x, 0, sunENU.z);
  if (flat.lengthSq() < 1e-8) flat.set(1, 0, 0);
  return flat.normalize().applyAxisAngle(Y, -1.0);
}

/** The shared gate pose, in surface metres. */
export function gatePoseENU(sunENU: THREE.Vector3): Pose {
  // Sun mostly behind the camera: the descent looks onto sunlit slopes, not into polar shadow.
  const flat = new THREE.Vector3(sunENU.x, 0, sunENU.z);
  if (flat.lengthSq() < 1e-8) flat.set(1, 0, 0);
  const s = flat.normalize().applyAxisAngle(Y, -0.45);
  return { pos: new THREE.Vector3(s.x * 17000, 12000, s.z * 17000), target: new THREE.Vector3(0, 0, 0), up: Y.clone() };
}

/** Three-quarter view of the lander. */
export function landerPoseENU(sunENU: THREE.Vector3): Pose {
  const s = sideDir(sunENU);
  return { pos: new THREE.Vector3(s.x * 22, 6.5, s.z * 22), target: new THREE.Vector3(0, 2.6, 0), up: Y.clone() };
}

/** Surface-frame point (m) → orbit-view point (lunar radii). */
export function enuToOrbit(p: THREE.Vector3, frame: SiteFrame, out = new THREE.Vector3()) {
  const R = MOON_RADIUS_KM * 1000;
  const e = p.x, u = p.y, n = -p.z;
  const { up: U, east: E, north: N } = frame;
  const r = R + frame.heightM;
  const v: [number, number, number] = [0, 1, 2].map((i) => (U[i] * (r + u) + E[i] * e + N[i] * n) / R) as [number, number, number];
  return moonToThree(v, out);
}

export function gatePoseOrbit(frame: SiteFrame, sky: Sky): Pose {
  const g = gatePoseENU(surfaceDirs(frame, sky).sun);
  return { pos: enuToOrbit(g.pos, frame), target: enuToOrbit(g.target, frame), up: moonToThree(frame.up).normalize() };
}

function slerpDir(a: THREE.Vector3, b: THREE.Vector3, k: number, out: THREE.Vector3) {
  const d = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const th = Math.acos(d);
  if (th < 1e-4) return out.lerpVectors(a, b, k).normalize();
  const s = Math.sin(th);
  return out.copy(a).multiplyScalar(Math.sin((1 - k) * th) / s).addScaledVector(b, Math.sin(k * th) / s);
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/**
 * Camera path between two poses. `orbit` mode swings around the Moon's centre and
 * interpolates altitude logarithmically (a dive); `local` mode orbits the moving
 * look-target and interpolates distance logarithmically (a descent onto a subject).
 */
function poseAt(a: Pose, b: Pose, k: number, mode: 'orbit' | 'local', out: Pose, tmp: { da: THREE.Vector3; db: THREE.Vector3; dir: THREE.Vector3 }) {
  out.target.lerpVectors(a.target, b.target, k);
  const base = mode === 'orbit' ? 1 : 0;
  if (mode === 'orbit') {
    tmp.da.copy(a.pos);
    tmp.db.copy(b.pos);
  } else {
    tmp.da.copy(a.pos).sub(a.target);
    tmp.db.copy(b.pos).sub(b.target);
  }
  const ra = Math.max(1e-7, tmp.da.length() - base);
  const rb = Math.max(1e-7, tmp.db.length() - base);
  slerpDir(tmp.da.normalize(), tmp.db.normalize(), k, tmp.dir);
  const r = Math.exp(THREE.MathUtils.lerp(Math.log(ra), Math.log(rb), k));
  out.pos.copy(tmp.dir).multiplyScalar(base + r);
  if (mode === 'local') out.pos.add(out.target);
  out.up.lerpVectors(a.up, b.up, k).normalize();
  return out;
}

interface Job {
  a: Pose;
  b: Pose;
  mode: 'orbit' | 'local';
  ms: number;
  roll: number;
  t0: number | null;
  resolve: () => void;
}

/** Drives the camera along a pose path; resolves when it arrives. Controls must be unmounted meanwhile. */
export function useFlight() {
  const job = useRef<Job | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const scratch = useMemo(() => ({ out: { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3() }, tmp: { da: new THREE.Vector3(), db: new THREE.Vector3(), dir: new THREE.Vector3() } }), []);
  useFrame(({ camera }) => {
    const j = job.current;
    if (!j) return;
    const now = performance.now();
    if (j.t0 === null) j.t0 = now;
    const k = Math.min(1, (now - j.t0) / j.ms);
    const p = poseAt(j.a, j.b, easeInOut(k), j.mode, scratch.out, scratch.tmp);
    camera.position.copy(p.pos);
    camera.up.copy(p.up);
    camera.lookAt(p.target);
    // A slight banked (dutch) angle through the middle of the move, like a crane or drone shot.
    camera.rotateZ(Math.sin(Math.PI * k) * j.roll);
    camera.updateMatrixWorld();
    if (k >= 1) {
      job.current = null;
      j.resolve();
    } else invalidate();
  }, -1);
  const fly = useCallback(
    (a: Pose, b: Pose, mode: 'orbit' | 'local', ms: number) =>
      new Promise<void>((resolve) => {
        job.current?.resolve();
        job.current = { a, b, mode, ms, roll: (Math.random() < 0.5 ? -1 : 1) * 0.055, t0: null, resolve };
        invalidate();
      }),
    [invalidate],
  );
  const flying = useCallback(() => job.current !== null, []);
  return { fly, flying };
}

/** Current camera pose; the look target is the point `dist` ahead. */
export function cameraPose(camera: THREE.Camera, target: THREE.Vector3): Pose {
  return { pos: camera.position.clone(), target: target.clone(), up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize() };
}

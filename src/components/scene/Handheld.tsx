import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useLock } from '../surface/viewState';

/**
 * Handheld camera feel: a small layered-sine shake whose strength follows how fast the
 * camera is moving, so moves feel operated rather than rail-perfect, and a still camera
 * stays still. The offset is removed before the controls run each frame, so it never
 * accumulates into the controls' state.
 */
export function Handheld({ strength = 1 }: { strength?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const s = useMemo(() => ({ offset: new THREE.Quaternion(), inv: new THREE.Quaternion(), e: new THREE.Euler(), prevP: new THREE.Vector3(), prevQ: new THREE.Quaternion(), amp: 0, t: 0, first: true }), []);
  const last = useRef(performance.now());
  // Before the controls/flight: take back last frame's shake.
  useFrame(({ camera }) => {
    s.inv.copy(s.offset).invert();
    camera.quaternion.multiply(s.inv);
    s.offset.identity();
  }, -2);
  // After the controls/flight, before rendering: measure motion and apply this frame's shake.
  useFrame(({ camera }) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last.current) / 1000);
    last.current = now;
    s.t += dt;
    if (s.first) {
      s.first = false;
      s.prevP.copy(camera.position);
      s.prevQ.copy(camera.quaternion);
      return;
    }
    const ang = s.prevQ.angleTo(camera.quaternion) / Math.max(dt, 1e-3);
    const scale = Math.max(1e-6, camera.position.length() > 50 ? camera.position.distanceTo(s.prevP) / Math.max(camera.position.y, 1) : camera.position.distanceTo(s.prevP) / Math.max(camera.position.length() - 0.98, 0.002));
    const lin = scale / Math.max(dt, 1e-3);
    const target = THREE.MathUtils.clamp(ang * 0.9 + lin * 0.35, 0, 1);
    s.amp += (target - s.amp) * (target > s.amp ? 0.25 : 0.05);
    s.prevP.copy(camera.position);
    s.prevQ.copy(camera.quaternion);
    // A locked body must stay dead centre: no shake while tracking.
    if (useLock.getState().lock) s.amp = 0;
    if (s.amp < 0.002) return;
    const t = s.t, a = s.amp * strength * (Math.PI / 180);
    const yaw = (Math.sin(t * 1.7) * 0.6 + Math.sin(t * 4.3 + 1.2) * 0.25 + Math.sin(t * 9.1 + 0.4) * 0.08) * 0.32 * a;
    const pitch = (Math.sin(t * 1.3 + 2.1) * 0.6 + Math.sin(t * 3.7 + 0.7) * 0.25 + Math.sin(t * 8.3 + 2.4) * 0.08) * 0.28 * a;
    const roll = (Math.sin(t * 0.9 + 0.3) * 0.7 + Math.sin(t * 2.9 + 1.9) * 0.2) * 0.45 * a;
    s.offset.setFromEuler(s.e.set(pitch, yaw, roll, 'YXZ'));
    camera.quaternion.multiply(s.offset);
    camera.updateMatrixWorld();
    invalidate();
  }, 0.5);
  return null;
}

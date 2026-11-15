import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { astro, EYE_HEIGHT, forwardOf, GAIT } from './Astronaut';
import { cameraRest, lander, useLock, useWalkMode } from './viewState';
import { cameraPose, useFlight, type Pose } from '../scene/transition';
import type { SiteModel } from '../../lib/science/analysis';
import type { SiteTerrain } from '../../lib/terrain/sources';
import { useWalker, walkerModel } from '../../lib/terrain/walker';

const WALK = 1.6; // m/s, a loping lunar walk
const RUN = 3.4; // m/s with Shift
const LANDER_CLEAR = 4.6; // m: don't walk through the descent stage

type Ground = (x: number, z: number) => { y: number; normal: THREE.Vector3 };

/**
 * WASD walking. The first key eases the camera into the astronaut's helmet; while you walk
 * you see the suit's arms and legs move below you, and the analysis follows your position.
 * About a second after you stop, the camera eases back out to a third-person view.
 */
export function Walk({ t, base, ground }: { t: SiteTerrain; base: SiteModel; ground: Ground }) {
  const { camera, gl, invalidate } = useThree();
  const { fly } = useFlight();
  const keys = useRef(new Set<string>());
  const st = useRef({ mode: 'idle' as 'idle' | 'enter' | 'fp' | 'exit', last: 0, yaw: 0, pitch: -0.12, vel: new THREE.Vector3(), drag: null as null | { x: number; y: number }, spawned: false, walked: false, shift: 0, prevT: performance.now() });
  const tmp = useMemo(() => ({ f: new THREE.Vector3(), r: new THREE.Vector3(), e: new THREE.Euler(), d: new THREE.Vector3() }), []);

  const eyePose = (): Pose => {
    const f = forwardOf(astro.yaw);
    const pos = new THREE.Vector3(astro.pos.x, astro.groundY + EYE_HEIGHT, astro.pos.z).addScaledVector(f, 0.1);
    const s = st.current;
    const dir = new THREE.Vector3(Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch));
    return { pos, target: pos.clone().add(dir), up: new THREE.Vector3(0, 1, 0) };
  };

  const enter = () => {
    const s = st.current;
    if (s.mode !== 'idle' || !astro.visible) return;
    s.mode = 'enter';
    useLock.getState().setLock(null);
    camera.getWorldDirection(tmp.d);
    s.yaw = Math.atan2(tmp.d.x, -tmp.d.z);
    s.pitch = -0.12;
    astro.yaw = s.yaw;
    const a = cameraPose(camera, camera.position.clone().addScaledVector(tmp.d, 8));
    useWalkMode.setState({ fp: true });
    // Hide the helmet just before the camera passes into it.
    window.setTimeout(() => (astro.firstPerson = true), 620);
    void fly(a, eyePose(), 'local', 900).then(() => {
      astro.firstPerson = true;
      s.mode = 'fp';
      s.last = performance.now();
    });
  };

  const exit = () => {
    const s = st.current;
    s.mode = 'exit';
    astro.speed = 0;
    astro.firstPerson = false;
    const a = eyePose();
    const f = forwardOf(astro.yaw);
    const chest = new THREE.Vector3(astro.pos.x, astro.groundY + 1.15, astro.pos.z);
    // Back out over the shoulder, a little to the side, so the astronaut stays in frame.
    const side = new THREE.Vector3(-f.z, 0, f.x);
    const b: Pose = { pos: chest.clone().addScaledVector(f, -5.2).addScaledVector(side, 1.6).add(new THREE.Vector3(0, 1.5, 0)), target: chest, up: new THREE.Vector3(0, 1, 0) };
    void fly(a, b, 'local', 1500).then(() => {
      cameraRest.override = chest;
      useWalkMode.setState({ fp: false });
      s.mode = 'idle';
      if ([...keys.current].some((k) => 'wasd'.includes(k))) enter();
    });
  };

  // Keyboard + mouse look.
  useEffect(() => {
    const typing = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'shift') keys.current.add(k);
      if (!['w', 'a', 's', 'd'].includes(k)) return;
      e.preventDefault();
      keys.current.add(k);
      if (st.current.mode === 'idle') enter();
      invalidate();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    const el = gl.domElement;
    const pd = (e: PointerEvent) => {
      if (st.current.mode !== 'fp') return;
      st.current.drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      const s = st.current;
      if (!s.drag) return;
      s.yaw += (e.clientX - s.drag.x) * 0.0032;
      s.pitch = THREE.MathUtils.clamp(s.pitch - (e.clientY - s.drag.y) * 0.0032, -1.35, 1.35);
      s.drag = { x: e.clientX, y: e.clientY };
      s.last = performance.now();
      invalidate();
    };
    const pu = () => {
      st.current.drag = null;
      st.current.last = performance.now();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    el.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      el.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, invalidate]);

  // Analysis follows the astronaut: re-cast the horizon from where they stand.
  const wk = useRef({ e: NaN, n: NaN, at: 0, bins: 0 });
  const updateWalker = (now: number, moving: boolean) => {
    // The astronaut steps out a few metres from the lander on arrival: the site's own (finer)
    // horizon stays in charge until you actually walk somewhere.
    if (!st.current.walked) return;
    const w = wk.current;
    const e = astro.pos.x, n = -astro.pos.z;
    const moved = Math.hypot(e - w.e, n - w.n);
    if (Math.hypot(e, n) < 3) {
      if (useWalker.getState().model) useWalker.getState().clear();
      return;
    }
    const due = moving ? moved > 2 && now - w.at > 450 : (moved > 0.5 || w.bins < 720) && now - w.at > 500;
    if (!due) return;
    const bins = moving ? 360 : 720;
    useWalker.getState().set(base.key, e, n, walkerModel(base, t, e, n, bins));
    Object.assign(w, { e, n, at: now, bins });
  };

  useEffect(() => () => {
    (camera as THREE.PerspectiveCamera).clearViewOffset();
    (camera as THREE.PerspectiveCamera).fov = 38;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    useWalker.getState().clear();
    useWalkMode.setState({ fp: false });
    astro.firstPerson = false;
    astro.visible = false;
  }, []);

  useFrame(() => {
    const s = st.current;
    const now = performance.now();
    const dt = Math.min(0.1, (now - s.prevT) / 1000);
    s.prevT = now;

    // Step out beside the LM once it has landed.
    if (!s.spawned && lander.descentStart !== null && lander.alt === 0 && now - lander.descentStart > 7600) {
      s.spawned = true;
      // In view: a few metres toward the camera from the LM and off to the camera's left,
      // clear of the inspector panel on the right of the screen.
      camera.getWorldDirection(tmp.d);
      tmp.d.y = 0;
      tmp.d.normalize();
      const right = tmp.r.set(-tmp.d.z, 0, tmp.d.x);
      astro.pos.set(lander.pos.x - tmp.d.x * 0.5 - right.x * 6, 0, lander.pos.z - tmp.d.z * 0.5 - right.z * 6);
      tmp.d.set(camera.position.x - astro.pos.x, 0, camera.position.z - astro.pos.z).normalize();
      astro.groundY = ground(astro.pos.x, astro.pos.z).y;
      astro.yaw = Math.atan2(tmp.d.x, -tmp.d.z);
      astro.visible = true;
      invalidate();
    }
    if (!astro.visible) return;

    const k = keys.current;
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const walking = s.mode === 'fp' && (fwd !== 0 || strafe !== 0);
    if (walking) s.walked = true;
    // Accelerate/decelerate like a body with momentum (slow to stop in low gravity).
    const f = forwardOf(s.yaw, tmp.f);
    const r = tmp.r.set(-f.z, 0, f.x);
    const want = new THREE.Vector3().addScaledVector(f, fwd).addScaledVector(r, strafe);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(k.has('shift') ? RUN : WALK);
    s.vel.lerp(want, Math.min(1, dt * (want.lengthSq() > 0 ? 3.5 : 2.2)));
    if (s.mode === 'fp' || s.vel.lengthSq() > 1e-4) {
      const step = s.vel.clone().multiplyScalar(dt);
      astro.pos.add(step);
      // Keep clear of the lander and inside the high-resolution terrain.
      const lx = astro.pos.x - lander.pos.x, lz = astro.pos.z - lander.pos.z, ld = Math.hypot(lx, lz);
      if (ld < LANDER_CLEAR) astro.pos.set(lander.pos.x + (lx / ld) * LANDER_CLEAR, 0, lander.pos.z + (lz / ld) * LANDER_CLEAR);
      const lim = t.meta.outer.halfSizeM * 0.85;
      astro.pos.x = THREE.MathUtils.clamp(astro.pos.x, -lim, lim);
      astro.pos.z = THREE.MathUtils.clamp(astro.pos.z, -lim, lim);
      astro.groundY = ground(astro.pos.x, astro.pos.z).y;
      astro.speed = s.vel.length();
    } else astro.speed = 0;
    if (walking) s.last = now;

    if (s.mode === 'fp') {
      astro.yaw = s.yaw;
      // Head bob from the gait phase: two dips per cycle, deeper when running.
      const run = THREE.MathUtils.smoothstep(astro.speed, GAIT.walkSpeed, GAIT.runSpeed);
      const bob = (0.035 + 0.05 * run) * Math.min(1, astro.speed / WALK) * Math.abs(Math.sin(astro.phase * Math.PI));
      const eye = eyePose();
      camera.position.copy(eye.pos).add(new THREE.Vector3(0, bob, 0));
      camera.up.set(0, 1, 0);
      camera.quaternion.setFromEuler(tmp.e.set(s.pitch, -s.yaw, 0, 'YXZ'));
      camera.updateMatrixWorld();
      if (!walking && !s.drag && now - s.last > 1100 && s.vel.lengthSq() < 0.05) exit();
    }
    // A natural first-person lens inside the helmet; the cinematic 38° lens outside.
    const cam = camera as THREE.PerspectiveCamera;
    const inFp = s.mode === 'fp' || s.mode === 'enter';
    const wantFov = inFp ? 75 : 38;
    // Shift the optical centre up so what's below you (arms, boots) lands above the timeline panel.
    const wantShift = inFp ? 110 : 0;
    if (Math.abs(cam.fov - wantFov) > 0.05 || Math.abs(s.shift - wantShift) > 0.5) {
      const k = Math.min(1, dt * 4);
      cam.fov += (wantFov - cam.fov) * k;
      s.shift += (wantShift - s.shift) * k;
      const { width, height } = gl.domElement.getBoundingClientRect();
      if (s.shift > 0.5) cam.setViewOffset(width, height + 2 * s.shift, 0, 2 * s.shift, width, height);
      else cam.clearViewOffset();
      cam.updateProjectionMatrix();
      invalidate();
    }
    if (s.mode !== 'idle' || astro.speed > 0.01) invalidate();
    updateWalker(now, astro.speed > 0.2);
  });
  return null;
}

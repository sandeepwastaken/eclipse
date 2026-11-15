import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import gait from './astronaut-gait.json';
import { markShadows } from './shadowState';
import { profile } from '../../lib/perf/quality';

// Versioned so browsers never reuse a cached older rig.
const MODEL = `${import.meta.env.BASE_URL}models/astronaut.glb?v=5`;
useGLTF.preload(MODEL);

/**
 * Rigged in Blender (scripts/rig_astronaut.py) with automatic weights; Walk and Run are CMU
 * motion-capture clips (mocap.cs.cmu.edu, subject 02) retargeted onto the suit; Idle is a slow
 * breathing loop. Model is 3.23 units tall: a suited astronaut stands about 1.8 m.
 */
const SCALE = 1.8 / 3.23;
export const EYE_HEIGHT = 1.62;
/** Low gravity: longer, floatier strides than the Earth-recorded clips at the same cadence. */
const LUNAR_STRIDE = 1.35;
const WALK_CLIP_SPEED = gait.walk.speedModelPerS * SCALE * LUNAR_STRIDE; // m/s at timeScale 1
const RUN_CLIP_SPEED = gait.run.speedModelPerS * SCALE * LUNAR_STRIDE;

/** Shared astronaut state (surface frame, metres). Yaw: heading clockwise from north (−z). */
export const astro = {
  pos: new THREE.Vector3(6, 0, 4),
  yaw: 0,
  /** Ground speed, m/s. */
  speed: 0,
  /** Gait phase in steps (0..2 per cycle), for the first-person head bob. */
  phase: 0,
  firstPerson: false,
  visible: false,
  groundY: 0,
  /** World positions of the ankles, updated every rendered frame. */
  feet: { L: new THREE.Vector3(), R: new THREE.Vector3() },
};
if (import.meta.env.DEV) (window as unknown as { __astro: unknown }).__astro = astro;

export const forwardOf = (yaw: number, out = new THREE.Vector3()) => out.set(Math.sin(yaw), 0, -Math.cos(yaw));
export const GAIT = { walkSpeed: WALK_CLIP_SPEED, runSpeed: RUN_CLIP_SPEED };

export function Astronaut() {
  const { scene, animations } = useGLTF(MODEL);
  const model = useMemo(() => {
    const root = cloneSkinned(scene) as THREE.Group;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      // White suit fabric picks up a lot of bounce light from the sunlit regolith.
      mat.envMapIntensity = mat.name === 'helmet' ? 1.2 : 1.7;
      if (mat.name === 'helmet') m.userData.helmet = true;
    });
    root.scale.setScalar(SCALE);
    return root;
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actions = useMemo(() => {
    const get = (n: string) => {
      const clip = animations.find((a) => a.name === n);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    return { idle: get('Idle'), walk: get('Walk'), run: get('Run') };
  }, [animations, mixer]);
  useEffect(() => () => {
    mixer.stopAllAction();
  }, [mixer]);

  const holder = useRef<THREE.Group>(null);
  const invalidate = useThree((st) => st.invalidate);
  const breathTick = useRef(0);
  const sm = useRef({ yaw: astro.yaw });
  const feet = useMemo(() => ({ L: model.getObjectByName('FootL'), R: model.getObjectByName('FootR') }), [model]);
  useFrame(({ camera }, dtRaw) => {
    const h = holder.current;
    if (!h) return;
    if (h.visible !== astro.visible) markShadows();
    h.visible = astro.visible;
    if (!astro.visible) return;
    const dt = Math.min(dtRaw, 0.1);
    const s = sm.current;
    // Turn smoothly toward the heading, the short way round.
    let dy = astro.yaw - s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    s.yaw += dy * Math.min(1, dt * 8);
    if (astro.speed > 0.01 || Math.abs(dy) > 1e-3) markShadows();
    const f = forwardOf(s.yaw);
    h.position.set(astro.pos.x, astro.groundY, astro.pos.z);
    h.rotation.set(0, Math.atan2(f.x, f.z), 0);

    // Blend idle → walk → run by ground speed, keeping walk and run in step.
    const v = astro.speed;
    const moving = THREE.MathUtils.smoothstep(v, 0.05, 0.6);
    const runK = THREE.MathUtils.smoothstep(v, WALK_CLIP_SPEED * 1.15, RUN_CLIP_SPEED * 0.9);
    const { idle, walk, run } = actions;
    if (idle) idle.setEffectiveWeight(1 - moving);
    if (walk && run) {
      walk.setEffectiveWeight(moving * (1 - runK));
      run.setEffectiveWeight(moving * runK);
      const wDur = walk.getClip().duration, rDur = run.getClip().duration;
      const useRun = runK > 0.5;
      const lead = useRun ? run : walk;
      const follow = useRun ? walk : run;
      // Cadence follows ground speed so the boots don't slide.
      lead.timeScale = moving > 0.01 ? Math.max(0.35, v / (useRun ? RUN_CLIP_SPEED : WALK_CLIP_SPEED)) : 0;
      follow.timeScale = 0;
      mixer.update(dt);
      const u = lead.time / (useRun ? rDur : wDur);
      follow.time = u * (useRun ? wDur : rDur);
      astro.phase = u * 2;
    } else mixer.update(dt);
    model.traverse((o) => {
      if (o.userData.helmet) o.visible = !astro.firstPerson;
    });
    // Keep the idle breathing alive (render-on-demand would freeze it) at a gentle 15 fps,
    // only while the astronaut is close enough to see it.
    if (!breathTick.current && profile().ambient && camera.position.distanceTo(h.position) < 60) {
      breathTick.current = window.setTimeout(() => {
        breathTick.current = 0;
        invalidate();
      }, 66);
    }
    // Publish where the boots are (ankle joints) for footprints and dust kicks.
    if (feet.L && feet.R) {
      feet.L.getWorldPosition(astro.feet.L);
      feet.R.getWorldPosition(astro.feet.R);
    }
  });
  return (
    <group ref={holder} visible={false}>
      <primitive object={model} />
    </group>
  );
}

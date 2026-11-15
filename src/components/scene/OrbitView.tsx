import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EarthBody, type EarthPlacement } from './EarthBody';
import { latLonToThree, moonToThree, MOON_TO_THREE, threeToLatLon } from './frames';
import { Globe } from './Globe';
import { currentTime, skyAt, type SkyState } from './sim';
import { Stars } from './Stars';
import { hideLabel, LABEL_PRIORITY, labelEls, labelState, placeLabel } from './labels';
import { cameraPose, gatePoseOrbit, useFlight, viewTransition, type Pose } from './transition';
import { useScenarioData } from '../../hooks/data';
import { SunGlare } from './SunGlare';
import { SITES } from '../../data/sites';
import { globalSampler, loadGlobalGrid, loadPolarGrid, polarSampler } from '../../lib/terrain/sources';
import { EARTH_RADIUS_KM, MOON_RADIUS_KM } from '../../lib/science/constants';
import { siteKey, siteLatLon, useApp } from '../../state/store';

const EARTH_SCALE = EARTH_RADIUS_KM / MOON_RADIUS_KM;

function useEarthPlacement() {
  const m = useMemo(() => new THREE.Matrix4(), []);
  const r = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const out = useMemo<EarthPlacement>(() => ({ matrix: new THREE.Matrix4(), sunDirWorld: new THREE.Vector3() }), []);
  return useCallback(() => {
    const sky = skyAt(currentTime());
    if (!sky) return null;
    moonToThree([sky.earth[0] / MOON_RADIUS_KM, sky.earth[1] / MOON_RADIUS_KM, sky.earth[2] / MOON_RADIUS_KM], p);
    q.set(sky.qEarth[0], sky.qEarth[1], sky.qEarth[2], sky.qEarth[3]);
    r.makeRotationFromQuaternion(q);
    m.copy(MOON_TO_THREE).multiply(r);
    out.matrix.makeScale(EARTH_SCALE, EARTH_SCALE, EARTH_SCALE).premultiply(m).setPosition(p);
    // Direction from Earth to the Sun, in scene axes (Sun is ~400× farther than Earth)
    moonToThree([sky.sun[0] - sky.earth[0], sky.sun[1] - sky.earth[1], sky.sun[2] - sky.earth[2]], out.sunDirWorld).normalize();
    return out;
  }, [m, r, q, p, out]);
}

/** Projects every site marker (DOM, in the label layer) onto the globe; fades them across the limb. */
function MarkerProjector() {
  const scenarios = useApp((s) => s.scenarios);
  const compare = useApp((s) => s.compare);
  const anchors = useMemo(() => {
    const list = SITES.map((s) => ({ id: `site:${s.id}`, pos: latLonToThree(s.lat, s.lon, 1.004) }));
    (compare ? (['A', 'B'] as const) : (['A'] as const)).forEach((id) => {
      const sc = scenarios[id].site;
      if (sc.kind === 'custom') list.push({ id: `custom:${id}`, pos: latLonToThree(sc.lat, sc.lon, 1.004) });
    });
    return list.map((a) => ({ ...a, normal: a.pos.clone().normalize() }));
  }, [scenarios, compare]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of anchors) {
      tmp.copy(camera.position).sub(a.pos).normalize();
      const facing = a.normal.dot(tmp);
      const o = labelState.orbitHidden ? 0 : THREE.MathUtils.clamp((facing - 0.06) * 6, 0, 1);
      placeLabel(a.id, a.pos, camera, size, o);
    }
  }, LABEL_PRIORITY);
  return null;
}

/** Resting camera pose for a site (or the pole / a reset), in orbit-view units. */
function restPose(kind: string, sky: SkyState, lat: number, lon: number): Pose {
  const up = latLonToThree(lat, lon);
  const polar = Math.abs(lat) > 65;
  const dist = kind === 'reset' ? 3.6 : polar ? 1.55 : 2.6;
  let dir: THREE.Vector3;
  if (polar) {
    // Look up the polar axis with the Sun from the side, so long shadows read as relief.
    const sun = moonToThree(sky.sunDir);
    const pole = new THREE.Vector3(0, Math.sign(up.y) || -1, 0);
    const sunEq = sun.clone().setY(0).normalize();
    const sideways = new THREE.Vector3().crossVectors(pole, sunEq).normalize();
    dir = pole.multiplyScalar(0.86).add(sunEq.multiplyScalar(0.42)).add(sideways.multiplyScalar(0.28)).normalize();
  } else {
    dir = up.clone();
  }
  const target = polar && kind !== 'reset' ? up.clone().multiplyScalar(0.7) : new THREE.Vector3();
  return { pos: dir.multiplyScalar(dist).add(target), target, up: new THREE.Vector3(0, 1, 0) };
}

function CameraRig({ initialSmooth }: { initialSmooth: boolean }) {
  const ref = useRef<CameraControls>(null);
  const camera = useApp((s) => s.camera);
  const active = useApp((s) => s.active);
  const site = useApp((s) => s.scenarios[s.active].site);
  const pending = useRef<{ kind: string; smooth: boolean } | null>({ kind: 'site', smooth: initialSmooth });
  const first = useRef(true);
  const tmpTarget = useMemo(() => new THREE.Vector3(), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const camera3 = useThree((s) => s.camera);
  // LOLA heights for the terrain floor: 480 m polar grid where it covers, ~5 km global elsewhere.
  const heightAt = useRef<((lat: number, lon: number) => number) | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([loadGlobalGrid(), loadPolarGrid()]).then(([g, p]) => {
      if (!alive) return;
      const gs = globalSampler(g), ps = polarSampler(p);
      heightAt.current = (lat, lon) => {
        const h = ps(lat, lon);
        return Number.isFinite(h) ? h : gs(lat, lon);
      };
    }, () => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = { kind: camera.kind, smooth: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.nonce, active, siteKey(site)]);
  useFrame(() => {
    const c = ref.current;
    if (!c) return;
    const job = pending.current;
    const sky = skyAt(currentTime());
    if (job && sky) {
      pending.current = null;
      const st = useApp.getState();
      const [lat, lon] = job.kind === 'pole' ? [-90, 0] : siteLatLon(st.scenarios[st.active].site);
      const p = restPose(job.kind, sky, lat, lon);
      void c.setLookAt(p.pos.x, p.pos.y, p.pos.z, p.target.x, p.target.y, p.target.z, job.smooth);
    }
    c.getTarget(tmpTarget);
    // Altitude above the actual LOLA surface under the camera (lunar radii).
    c.getPosition(tmpPos);
    const r = tmpPos.length();
    const [lat, lon] = threeToLatLon(tmpPos);
    const exag = useApp.getState().reliefExaggeration;
    const hM = heightAt.current ? heightAt.current(lat, lon) : 0;
    const floor = 1 + (exag * Math.max(-9500, Number.isFinite(hM) ? hM : 0)) / (MOON_RADIUS_KM * 1000) + 0.0006; // ≥ ~1 km clearance
    if (r < floor) {
      // Never pass into the ground: slide the camera back up to the floor along the vertical.
      tmpPos.multiplyScalar(floor / r);
      void c.setPosition(tmpPos.x, tmpPos.y, tmpPos.z, false);
    }
    const alt = Math.max(1e-5, Math.max(r, floor) - (floor - 0.0006));
    c.minDistance = 0.0004;
    // Zoom and drag rates follow altitude, so a scroll step or a drag moves the same fraction of
    // the view whether you're at 2 lunar radii or 2 km up.
    const k = THREE.MathUtils.clamp(alt * 0.7, 0.0015, 1);
    c.azimuthRotateSpeed = k;
    c.polarRotateSpeed = k;
    c.dollySpeed = THREE.MathUtils.clamp((alt / Math.max(c.distance, 1e-6)) * 2.2, 0.004, 0.6);
    // Near plane shrinks with altitude so nearby terrain never clips (log depth keeps precision).
    const cam = camera3 as THREE.PerspectiveCamera;
    const near = THREE.MathUtils.clamp(alt * 0.04, 0.000004, 0.001);
    if (Math.abs(cam.near / near - 1) > 0.15) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
  });

  // Horizon tilt (as in a spacecraft window): once the disk overfills the frame, pitch the view up
  // so the limb stays at a fixed height on screen. Applied after the controls, removed before them.
  const tilt = useRef({ q: new THREE.Quaternion(), inv: new THREE.Quaternion(), fwd: new THREE.Vector3(), nadir: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0) });
  useFrame(({ camera }) => {
    camera.quaternion.multiply(tilt.current.inv.copy(tilt.current.q).invert());
    tilt.current.q.identity();
  }, -1.5);
  useFrame(({ camera }) => {
    const t = tilt.current;
    const cam = camera as THREE.PerspectiveCamera;
    const d = cam.position.length();
    if (d < 1.0001) return;
    const alt = d - 1;
    const s = THREE.MathUtils.smoothstep(Math.log(alt), Math.log(0.15), Math.log(4));
    const vfov = (cam.fov * Math.PI) / 180;
    const limbAng = Math.asin(1 / d);
    cam.getWorldDirection(t.fwd);
    t.nadir.copy(cam.position).normalize().negate();
    const off = t.fwd.angleTo(t.nadir);
    const excess = limbAng - off - THREE.MathUtils.lerp(0.3, 0.46, s) * vfov;
    const soft = 0.06;
    const a = excess > soft ? excess : soft * Math.exp(excess / soft - 1);
    if (a < 1e-4) return;
    t.q.setFromAxisAngle(t.axis, Math.min(a, 1.45));
    cam.quaternion.multiply(t.q);
    cam.updateMatrixWorld();
  }, 0.4);
  return <CameraControls ref={ref} makeDefault minDistance={0.0004} maxDistance={9} smoothTime={0.55} draggingSmoothTime={0.12} />;
}

/** Orbit camera: free controls at rest; scripted flights to and from the surface gate. */
function OrbitCamera() {
  const { fly } = useFlight();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const active = useApp((s) => s.active);
  const data = useScenarioData(active);
  const frame = data.site.model.frame;
  const [free, setFree] = useState(viewTransition.arrivedFrom !== 'surface');
  useEffect(() => {
    labelState.orbitHidden = !free;
  }, [free]);
  const arriving = useRef(viewTransition.arrivedFrom === 'surface');
  useEffect(() => {
    viewTransition.exit = async () => {
      const sky = skyAt(currentTime());
      if (!sky) return;
      const target = new THREE.Vector3();
      controls?.getTarget(target);
      const a = cameraPose(camera, target);
      setFree(false);
      const gate = gatePoseOrbit(frame, sky);
      await fly(a, gate, 'orbit', 2300);
      // Switched back before the swap: climb out again and hand back the controls.
      if (useApp.getState().view === 'orbit') {
        await fly(gate, restPose('site', sky, frame.lat, frame.lon), 'orbit', 1800);
        camera.up.set(0, 1, 0);
        setFree(true);
      }
    };
    return () => {
      viewTransition.exit = null;
    };
  }, [camera, controls, fly, frame]);
  useFrame(() => {
    if (!arriving.current) return;
    const sky = skyAt(currentTime());
    if (!sky) return;
    arriving.current = false;
    viewTransition.arrivedFrom = null;
    const gate = gatePoseOrbit(frame, sky);
    camera.position.copy(gate.pos);
    camera.up.copy(gate.up);
    camera.lookAt(gate.target);
    const [lat, lon] = [frame.lat, frame.lon];
    void fly(gate, restPose('site', sky, lat, lon), 'orbit', 2600).then(() => {
      camera.up.set(0, 1, 0);
      setFree(true);
    });
  });
  return free ? <CameraRig initialSmooth={false} /> : null;
}

export function OrbitView({ onReady }: { onReady?: () => void }) {
  const active = useApp((s) => s.active);
  const setSite = useApp((s) => s.setSite);
  const hoverPos = useRef<THREE.Vector3 | null>(null);
  const placeEarth = useEarthPlacement();
  const skyRotation = useCallback(() => skyAt(currentTime())?.qSky ?? null, []);
  const sunDir = useCallback(() => {
    const s = skyAt(currentTime());
    return s ? moonToThree(s.sunDir) : null;
  }, []);
  const cam = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ camera, size }) => {
    if (hoverPos.current && size.width > 700 && !labelState.orbitHidden) placeLabel('pick', hoverPos.current, camera, size, 1);
    else hideLabel('pick');
  }, LABEL_PRIORITY);
  // Glare fades as the Sun's line of sight from the camera grazes the lunar limb.
  const sunVisible = useCallback(() => {
    const s = skyAt(currentTime());
    if (!s) return 0;
    const d = moonToThree(s.sunDir);
    const o = cam.position;
    const b = o.dot(d);
    const closest = Math.sqrt(Math.max(0, o.lengthSq() - b * b));
    if (b > 0) return 1;
    return THREE.MathUtils.smoothstep(closest, 1.0, 1.02);
  }, [cam]);

  return (
    <>
      <Stars radius={2400} toWorld={MOON_TO_THREE} rotation={skyRotation} brightness={0.75} />
      <SunGlare direction={sunDir} distance={2200} visibility={sunVisible} glareScale={0.6} />
      <EarthBody place={placeEarth} exposure={1.1} />
      <Globe
        onReady={onReady}
        onPointer={({ point, type }) => {
          if (type === 'leave') {
            hoverPos.current = null;
            hideLabel('pick');
            return;
          }
          const [lat, lon] = threeToLatLon(point);
          if (type === 'move') {
            hoverPos.current = point.clone().normalize().multiplyScalar(1.004);
            const t = labelEls.get('pick')?.querySelector('.tnum');
            if (t) t.textContent = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
            invalidate();
          } else setSite(active, { kind: 'custom', lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) });
        }}
      />
      <MarkerProjector />
      <OrbitCamera />
    </>
  );
}

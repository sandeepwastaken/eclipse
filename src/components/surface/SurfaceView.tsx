import { CameraControls, CameraControlsImpl, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Line2, LineSegments2 } from 'three-stdlib';
import { LandingDust, LunarModule } from './Lander';
import { Rocks } from './Rocks';
import { buildTerrainGeometry, gridTexture, makeLocalSampler, meshSurfaceY, surfaceY, viewHorizon } from './terrain';
import { buildSkirt, createSkirtMaterial, createTerrainMaterial } from './terrainMaterial';
import { cameraRest, dirFromAzEl, lander, useLock, useWalkMode, viewHeading } from './viewState';
import { Astronaut } from './Astronaut';
import { Walk } from './Walk';
import { Footprints } from './Footprints';
import { cameraPose, gatePoseENU, landerPoseENU, sideDir, surfaceDirs, useFlight, viewTransition } from '../scene/transition';
import { EarthBody, type EarthPlacement } from '../scene/EarthBody';
import { moonToSurfaceMatrix } from '../scene/frames';
import { currentTime, skyAt } from '../scene/sim';
import { Stars } from '../scene/Stars';
import { LABEL_PRIORITY, labelEls, placeLabel } from '../scene/labels';
import { CARDINALS } from '../scene/SceneLabels';
import { SunGlare } from '../scene/SunGlare';
import { ephemerisNow, useScenarioData, useSiteModel, useSiteTerrain } from '../../hooks/data';
import { fmtAz, fmtDeg } from '../../lib/format';
import { instantAt } from '../../lib/science/analysis';
import { EARTH_RADIUS_KM, SUN_RADIUS_KM } from '../../lib/science/constants';
import { horizonAt } from '../../lib/science/horizon';
import { diskVisibleFraction } from '../../lib/science/topocentric';
import type { SiteTerrain } from '../../lib/terrain/sources';
import { useApp } from '../../state/store';
import { useProfile } from '../../lib/perf/quality';
import { growFor } from '../scene/Globe';
import { markShadows, shadowState } from './shadowState';

const DEG_S = Math.PI / 180;
// Headlamp strengths, matched so terrain and the PBR objects read equally bright in the beam
// (bright enough to work by at ~10 m, falling off with the square of distance).
const LAMP_TERRAIN = 150;
/** Camera height above the ground (m) over which the distant-mountain ring fades out. */
const SKIRT_FADE = [60, 300] as const;
const LAMP_SPOT = 150;
const SKY_R = 150_000; // overlay sphere radius around the camera, m (beyond the terrain, so terrain can occlude it)
const EYE = 2; // observer height, m

/** Topocentric Sun/Earth directions in the surface frame (from the site, not the Moon's centre). */
function useSurfaceDirs(frameMatrix: THREE.Matrix4, site: readonly number[]) {
  const sun = useMemo(() => new THREE.Vector3(), []);
  const earth = useMemo(() => new THREE.Vector3(), []);
  return useCallback(() => {
    const s = skyAt(currentTime());
    if (!s) return null;
    sun.set(s.sun[0] - site[0], s.sun[1] - site[1], s.sun[2] - site[2]).applyMatrix4(frameMatrix).normalize();
    earth.set(s.earth[0] - site[0], s.earth[1] - site[1], s.earth[2] - site[2]).applyMatrix4(frameMatrix).normalize();
    return { sun, earth, sky: s };
  }, [frameMatrix, site, sun, earth]);
}

/** Environment for metals: black sky, sunlit regolith below, the Sun itself. Rebuilt as the Sun moves. */
function LunarEnvironment({ sunDir }: { sunDir: () => THREE.Vector3 | null }) {
  const { gl, scene } = useThree();
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl]);
  const envScene = useMemo(() => {
    const s = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSun; varying vec3 vDir;
        void main(){
          float up = vDir.y;
          float sunUp = max(uSun.y, 0.0);
          vec3 ground = vec3(0.32, 0.31, 0.3) * (0.12 + 1.6 * sqrt(sunUp + 0.02));
          float g = smoothstep(0.02, -0.06, up);
          vec3 col = mix(vec3(0.0), ground, g);
          float s = smoothstep(0.9990, 0.99995, dot(vDir, uSun));
          col += vec3(40.0, 38.0, 35.0) * s;
          col += vec3(0.9, 0.85, 0.8) * pow(max(dot(vDir, uSun), 0.0), 64.0) * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
    return { s, mat };
  }, []);
  const last = useRef(new THREE.Vector3(0, -1, 0));
  const target = useRef<THREE.WebGLRenderTarget | null>(null);
  useFrame(() => {
    const d = sunDir();
    if (!d || d.angleTo(last.current) < 0.08) return;
    last.current.copy(d);
    envScene.mat.uniforms.uSun.value.copy(d);
    target.current?.dispose();
    target.current = pmrem.fromScene(envScene.s, 0.02);
    scene.environment = target.current.texture;
  });
  useEffect(() => () => {
    target.current?.dispose();
    pmrem.dispose();
    scene.environment = null;
  }, [pmrem, scene]);
  return null;
}

function Terrain({ t, geometry, dirs, farVis }: { t: SiteTerrain; geometry: THREE.BufferGeometry; dirs: ReturnType<typeof useSurfaceDirs>; farVis: () => number }) {
  const material = useMemo(() => {
    const inner = gridTexture(t.inner);
    const outer = gridTexture(t.outer);
    return createTerrainMaterial({ inner, outer, innerHalf: t.meta.inner.halfSizeM, outerHalf: t.meta.outer.halfSizeM, innerN: t.inner.width, outerN: t.outer.width, h0: t.meta.heightM, albedo: new THREE.Color(0.2, 0.192, 0.182) });
  }, [t]);
  const skirt = useMemo(() => buildSkirt(t.horizon.far ?? t.horizon.values, t.horizon.stepDeg, 90_000, EYE), [t]);
  // Distant mountains (LOLA far-field horizon). Its triangles face away from the viewer, so it must be
  // drawn double-sided or the whole ring is culled and Earth/Sun show through where terrain blocks them.
  const skirtMat = useMemo(createSkirtMaterial, []);
  const skirtRef = useRef<THREE.Mesh>(null);
  const tSampler = useMemo(() => makeLocalSampler(t), [t]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  const prof = useProfile();
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const steps = prof.steps[2];
    material.uniforms.uSteps.value = steps;
    material.uniforms.uGrow.value = growFor(1.31, 34, steps);
    material.uniforms.uDetail.value = Math.max(0.3, prof.detail);
    invalidate();
  }, [material, prof, invalidate]);
  useFrame(({ camera }) => {
    // Headlamp: shines from the camera along the view direction.
    const lampOn = useApp.getState().lamp;
    material.uniforms.uLamp.value = lampOn ? LAMP_TERRAIN : 0;
    if (lampOn) {
      material.uniforms.uLampPos.value.copy(camera.position);
      camera.getWorldDirection(material.uniforms.uLampDir.value);
    }
    const d = dirs();
    if (!d) return;
    material.uniforms.uSunDir.value.copy(d.sun);
    material.uniforms.uEarthDir.value.copy(d.earth);
    material.uniforms.uEarthPhase.value = d.sky.earthPhase;
    material.uniforms.uFarVis.value = farVis();
    skirtMat.uniforms.uSunDir.value.copy(d.sun);
    // The distant-mountain ring is placed for an observer near the ground: fade it as the camera climbs.
    const alt = camera.position.y - surfaceY(tSampler, t.meta.heightM, camera.position.x, -camera.position.z);
    const f = 1 - THREE.MathUtils.smoothstep(alt, SKIRT_FADE[0], SKIRT_FADE[1]);
    skirtMat.uniforms.uOpacity.value = f;
    skirtMat.depthWrite = f > 0.99;
    if (skirtRef.current) skirtRef.current.visible = f > 0.01;
  });
  return (
    <>
      <mesh geometry={geometry} material={material} name="terrain" />
      <mesh ref={skirtRef} geometry={skirt} material={skirtMat} renderOrder={-2} />
    </>
  );
}

/** Thin transparent copy of the ground near the lander that only shows the lander's shadow-map shadow. */
function ShadowCatcher({ t, terrainGeom }: { t: SiteTerrain; terrainGeom: THREE.BufferGeometry }) {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(260, 260, 130, 130);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, meshSurfaceY(terrainGeom, p.getX(i), p.getZ(i)) + 0.03);
    g.computeVertexNormals();
    return g;
  }, [t, terrainGeom]);
  return (
    <mesh geometry={geom} receiveShadow renderOrder={1}>
      <shadowMaterial opacity={0.88} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

function SkyOverlay({ terrain }: { terrain: SiteTerrain }) {
  const group = useRef<THREE.Group>(null);
  const active = useApp((s) => s.active);
  // Hiding the interface (H) hides the sky guides too: scene only.
  const overlays = useApp((s) => s.overlays && !s.uiHidden);
  const data = useScenarioData(active);
  // The analysis may be for a walked-to spot whose east/north differ slightly from the
  // site's (noticeably near the pole): convert its azimuth/elevation into scene directions.
  const siteFrameRef = useApp((s) => s.scenarios[s.active].site);
  const baseFrame = useSiteModel(siteFrameRef).model.frame;
  const toScene = useMemo(() => {
    const m = moonToSurfaceMatrix(baseFrame);
    const F = data.site.model.frame;
    const v = new THREE.Vector3();
    return (az: number, el: number, r: number): [number, number, number] => {
      if (F === baseFrame) return dirFromAzEl(az, el, r);
      const a = az * DEG_S, e = el * DEG_S;
      const ce = Math.cos(e), ca = Math.cos(a), sa = Math.sin(a), se = Math.sin(e);
      v.set(ce * (ca * F.north[0] + sa * F.east[0]) + se * F.up[0], ce * (ca * F.north[1] + sa * F.east[1]) + se * F.up[1], ce * (ca * F.north[2] + sa * F.east[2]) + se * F.up[2]).applyMatrix4(m).normalize().multiplyScalar(r);
      return [v.x, v.y, v.z];
    };
  }, [baseFrame, data.site.model.frame]);
  // Skyline guide: re-cast from wherever the camera is whenever it comes to rest.
  const [viewHz, setViewHz] = useState<Float32Array | null>(null);
  const hzState = useRef({ last: new THREE.Vector3(1e9, 0, 0), moved: 0, pending: false, fast: 0 });
  const horizonPts = useMemo(() => {
    const pts: [number, number, number][] = [];
    const n = viewHz?.length ?? 0;
    for (let az = 0; az <= 360; az += 0.5) {
      let el: number;
      if (viewHz) {
        const x = (az / 360) * n, i = Math.floor(x) % n, f = x - Math.floor(x);
        el = viewHz[i] + (viewHz[(i + 1) % n] - viewHz[i]) * f;
      } else el = horizonAt(terrain.horizon, az);
      pts.push(dirFromAzEl(az, el, SKY_R));
    }
    return pts;
  }, [terrain, viewHz]);
  const ring = useMemo(() => {
    const segs: [number, number, number][] = [];
    for (let az = 0; az < 360; az += 5) {
      const big = az % 30 === 0;
      segs.push(dirFromAzEl(az, -0.25, SKY_R), dirFromAzEl(az, big ? 1.1 : 0.45, SKY_R));
    }
    return segs;
  }, []);
  const paths = useMemo(() => {
    const s = data.mission?.series;
    if (!s) return null;
    const build = (az: Float32Array, el: Float32Array, hor: Float32Array) => {
      const vis: [number, number, number][] = [];
      const hid: [number, number, number][] = [];
      for (let i = 1; i < s.n; i++) {
        const a = toScene(az[i - 1], el[i - 1], SKY_R);
        const b = toScene(az[i], el[i], SKY_R);
        const target = el[i] > hor[i] ? vis : hid;
        target.push(a, b);
      }
      return { vis, hid };
    };
    return { sun: build(s.sunAz, s.sunEl, s.sunHorizon), earth: build(s.earthAz, s.earthEl, s.earthHorizon) };
  }, [data.mission, toScene]);
  const anchors = useMemo(() => ({ sun: new THREE.Vector3(), earth: new THREE.Vector3(), tmp: new THREE.Vector3() }), []);
  const hzLine = useRef<Line2 | LineSegments2>(null);
  const ringLine = useRef<Line2 | LineSegments2>(null);
  const skySampler = useMemo(() => makeLocalSampler(terrain), [terrain]);
  const invalidateSky = useThree((s) => s.invalidate);
  useFrame(({ camera, size }) => {
    group.current?.position.copy(camera.position);
    // Recompute the skyline from the camera once it has settled after moving.
    const hs = hzState.current;
    const now = performance.now();
    const groundAlt = camera.position.y - surfaceY(skySampler, terrain.meta.heightM, camera.position.x, -camera.position.z);
    // The far-field skyline only applies near the ground (the ring that draws it fades out above).
    const farFn = terrain.horizon.far && groundAlt < (SKIRT_FADE[0] + SKIRT_FADE[1]) / 2 ? (az: number) => horizonAt(terrain.horizon, az, 'far') : null;
    if (camera.position.distanceToSquared(hs.last) > 0.25) {
      hs.last.copy(camera.position);
      hs.moved = now;
      hs.pending = true;
      // Live while moving: a quick, coarser cast ~20 times a second.
      if (now - hs.fast > 50) {
        hs.fast = now;
        setViewHz(viewHorizon(terrain, farFn, camera.position, 180, 0.06));
      }
    } else if (hs.pending && now - hs.moved > 140) {
      // At rest: refine to full resolution.
      hs.pending = false;
      setViewHz(viewHorizon(terrain, farFn, camera.position, 360));
    }
    if (hs.pending) invalidateSky();
    // Only meaningful near the ground: fade the guide out from high above.
    const altitude = camera.position.y - surfaceY(skySampler, terrain.meta.heightM, camera.position.x, -camera.position.z);
    const f = 1 - THREE.MathUtils.smoothstep(altitude, 600, 2500);
    for (const [l, base] of [[hzLine.current, 0.55], [ringLine.current, 0.35]] as const) {
      if (!l) continue;
      (l.material as THREE.Material).opacity = base * f;
      l.visible = f > 0.01;
    }
    const eph = ephemerisNow();
    if (!eph) return;
    const st = useApp.getState();
    const x = instantAt(eph, data.site.model, currentTime(), st.criteria);
    const o = overlays ? 1 : 0;
    const at = (az: number, el: number) => anchors.tmp.set(...toScene(az, el, SKY_R)).add(camera.position);
    for (const [l, az] of CARDINALS) placeLabel(`card:${l}`, at(az, 1.9), camera, size, o);
    // Bodies hidden by terrain keep a faint label rather than disappearing.
    const locked = useLock.getState().lock;
    placeLabel('sky:sun', at(x.sun.az, x.sun.el), camera, size, o * (x.sun.visible ? 1 : 0.4) * (locked === 'sun' ? 0 : 1));
    placeLabel('sky:earth', at(x.earth.az, x.earth.el), camera, size, o * (x.earth.visible ? 1 : 0.4) * (locked === 'earth' ? 0 : 1));
    const sl = labelEls.get('sky:sun')?.firstElementChild;
    const el = labelEls.get('sky:earth')?.firstElementChild;
    const lk = useLock.getState();
    if (lk.lock) {
      const b = lk.lock === 'sun' ? x.sun : x.earth;
      placeLabel('lock', at(b.az, b.el), camera, size, 1);
      // Size the ring to the body's real angular radius as projected through the current lens.
      const sky = skyAt(currentTime());
      if (sky) {
        const B = lk.lock === 'sun' ? sky.sun : sky.earth, P = data.site.model.frame.position;
        const range = Math.hypot(B[0] - P[0], B[1] - P[1], B[2] - P[2]);
        const angR = Math.asin((lk.lock === 'sun' ? SUN_RADIUS_KM : EARTH_RADIUS_KM) / range);
        const cam = camera as THREE.PerspectiveCamera;
        const fovEff = (cam.fov * Math.PI) / 180 / Math.max(cam.zoom, 1e-3);
        const rpx = (Math.tan(angR) / Math.tan(fovEff / 2)) * (size.height / 2) + 3;
        const node = labelEls.get('lock');
        const cur = Number(node?.querySelector('[data-ring]')?.getAttribute('r') ?? 0);
        if (node && Math.abs(cur - rpx) > 0.25) {
          node.querySelectorAll('[data-ring]').forEach((c) => c.setAttribute('r', rpx.toFixed(2)));
          node.querySelector('[data-glyph]')?.setAttribute('transform', `translate(0,${(rpx + 12).toFixed(1)})`);
          const lab = node.querySelector<HTMLElement>('[data-label]');
          if (lab) lab.style.top = `${(32 + rpx + 26).toFixed(1)}px`;
        }
      }
      if (lk.occluded === b.visible) lk.setOccluded(!b.visible);
    }
    const sunHtml = `<span style="color:var(--sun)">Sun</span> ${fmtDeg(x.sun.el, 2)} <span class="faint">${fmtAz(x.sun.az)}</span>`;
    const earthHtml = `<span style="color:var(--earth)">Earth</span> ${fmtDeg(x.earth.el, 2)} <span class="faint">${fmtAz(x.earth.az)}</span>`;
    if (sl && sl.getAttribute('data-html') !== sunHtml) {
      sl.innerHTML = sunHtml;
      sl.setAttribute('data-html', sunHtml);
    }
    if (el && el.getAttribute('data-html') !== earthHtml) {
      el.innerHTML = earthHtml;
      el.setAttribute('data-html', earthHtml);
    }
  }, LABEL_PRIORITY);
  return (
    <group ref={group} visible={overlays}>
      <Line ref={hzLine} points={horizonPts} color="#ffffff" lineWidth={1.2} transparent opacity={0.55} depthTest={false} renderOrder={40} dashed dashSize={2200} gapSize={1500} />
      <Line ref={ringLine} points={ring} segments color="#ffffff" lineWidth={1} transparent opacity={0.35} depthTest={false} renderOrder={40} />
      {paths && (['sun', 'earth'] as const).map((b) => {
        const color = b === 'sun' ? '#ffd480' : '#8ec5ff';
        const p = paths[b];
        // Each track is drawn twice: depth-tested at full strength, and through terrain at low opacity.
        return (
          <group key={b}>
            {p.vis.length > 0 && <Line points={p.vis} segments color={color} lineWidth={2} transparent opacity={0.9} renderOrder={41} />}
            {p.vis.length > 0 && <Line points={p.vis} segments color={color} lineWidth={1.5} transparent opacity={0.22} depthTest={false} renderOrder={40} />}
            {p.hid.length > 0 && <Line points={p.hid} segments color={color} lineWidth={1} transparent opacity={0.28} renderOrder={41} />}
            {p.hid.length > 0 && <Line points={p.hid} segments color={color} lineWidth={1} transparent opacity={0.1} depthTest={false} renderOrder={40} />}
          </group>
        );
      })}
    </group>
  );
}

/** Camera headlamp for the LM, rocks and astronaut (the terrain shader adds the same beam itself). */
function Headlamp({ sunLight }: { sunLight: () => number }) {
  const light = useRef<THREE.SpotLight>(null);
  const lamp = useApp((s) => s.lamp);
  const decided = useRef(false);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    // When you land: lamp on in darkness, off in sunlight (you can still toggle it).
    if (!decided.current && lander.descentStart !== null && lander.alt === 0) {
      decided.current = true;
      useApp.getState().setLamp(sunLight() < 0.15);
    }
    const l = light.current;
    if (!l) return;
    // Keep the light in the scene and dim it, so toggling never recompiles every shader.
    l.intensity = lamp ? LAMP_SPOT : 0;
    if (!lamp) return;
    camera.getWorldDirection(dir);
    l.position.copy(camera.position);
    l.target.position.copy(camera.position).add(dir);
    l.target.updateMatrixWorld();
  });
  return <spotLight ref={light} intensity={LAMP_SPOT} distance={160} angle={0.5} penumbra={0.55} decay={2} color={new THREE.Color(1, 0.97, 0.92)} />;
}

/** Redraws the shadow map only when a caster or the Sun has moved (see shadowState). */
function ShadowScheduler({ size }: { size: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    markShadows();
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  // A new map size needs a fresh render target.
  useEffect(() => {
    scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (l.isDirectionalLight && l.shadow?.map && l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map.dispose();
        (l.shadow as unknown as { map: null }).map = null;
      }
    });
    markShadows();
  }, [scene, size]);
  useFrame(() => {
    if (!shadowState.dirty) return;
    shadowState.dirty = false;
    gl.shadowMap.needsUpdate = true;
  }, -500);
  return null;
}

/** Double-click the Sun or Earth to lock the camera onto it; double-click again to release. */
function LockPicker({ frame }: { frame: import('../../lib/science/topocentric').SiteFrame }) {
  const { gl, camera, invalidate } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const v = new THREE.Vector3();
    const onDbl = (e: MouseEvent) => {
      const st = useLock.getState();
      if (st.lock) {
        st.setLock(null);
        invalidate();
        return;
      }
      const s = skyAt(currentTime());
      if (!s) return;
      const d = surfaceDirs(frame, s);
      const r = el.getBoundingClientRect();
      let best: { k: 'sun' | 'earth'; dist: number } | null = null;
      for (const k of ['sun', 'earth'] as const) {
        v.copy(d[k]).multiplyScalar(1000).add(camera.position).project(camera);
        if (v.z > 1) continue;
        const px = (v.x * 0.5 + 0.5) * r.width, py = (-v.y * 0.5 + 0.5) * r.height;
        const dist = Math.hypot(px - (e.clientX - r.left), py - (e.clientY - r.top));
        if (dist < 70 && (!best || dist < best.dist)) best = { k, dist };
      }
      if (best) {
        st.setLock(best.k);
        invalidate();
      }
    };
    el.addEventListener('dblclick', onDbl);
    return () => el.removeEventListener('dblclick', onDbl);
  }, [gl, camera, frame, invalidate]);
  useEffect(() => () => useLock.getState().setLock(null), []);
  return null;
}

function SurfaceCamera({ t, frame }: { t: SiteTerrain; frame: import('../../lib/science/topocentric').SiteFrame }) {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera);
  const command = useApp((s) => s.camera);
  const sample = useMemo(() => makeLocalSampler(t), [t]);
  const { fly } = useFlight();
  const [free, setFree] = useState(false);
  const fp = useWalkMode((s) => s.fp);
  const started = useRef(false);
  const restTarget = useRef(new THREE.Vector3(0, 3, 0));
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  const lockDir = useRef(new THREE.Vector3());
  const dirsNow = useCallback(() => {
    const s = skyAt(currentTime());
    return s ? surfaceDirs(frame, s) : null;
  }, [frame]);
  useEffect(() => {
    camera.near = 0.05;
    camera.far = 700_000;
    camera.updateProjectionMatrix();
    return () => {
      camera.near = 0.001;
      camera.far = 5000;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  // Leaving for orbit: climb back up to the shared gate pose.
  useEffect(() => {
    viewTransition.exit = async () => {
      const d = dirsNow();
      if (!d) return;
      const target = new THREE.Vector3();
      if (ref.current) ref.current.getTarget(target);
      else target.copy(restTarget.current);
      const a = cameraPose(camera, target);
      setFree(false);
      const gate = gatePoseENU(d.sun);
      await fly(a, gate, 'local', 1900);
      if (useApp.getState().view === 'surface') {
        await fly(gate, a, 'local', 1900);
        setFree(true);
      }
    };
    return () => {
      viewTransition.exit = null;
    };
  }, [camera, dirsNow, fly]);

  // 'orbit' circles a subject; 'look' turns the camera in place (free up/down, wheel zooms the lens).
  const mode = useRef<'orbit' | 'look'>('orbit');
  const setMode = useCallback((m: 'orbit' | 'look') => {
    mode.current = m;
    const c = ref.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    if (m === 'look') {
      c.minDistance = 0.01;
      c.azimuthRotateSpeed = -0.32;
      c.polarRotateSpeed = -0.32;
      c.minPolarAngle = 0.04;
      c.maxPolarAngle = Math.PI - 0.04;
      c.mouseButtons.wheel = A.ZOOM;
      c.touches.two = A.TOUCH_ZOOM_TRUCK;
      c.minZoom = 1;
      c.maxZoom = 12;
    } else {
      c.minDistance = 3;
      c.azimuthRotateSpeed = 1;
      c.polarRotateSpeed = 1;
      c.minPolarAngle = 0.02;
      c.mouseButtons.wheel = A.DOLLY;
      c.touches.two = A.TOUCH_DOLLY_TRUCK;
      void c.zoomTo(1, true);
    }
  }, []);
  const look = useCallback((kind: string, smooth: boolean) => {
    const c = ref.current;
    const d = dirsNow();
    if (!c || !d) return;
    // Facing the body that is already locked keeps the lock; any other shot releases it.
    if (useLock.getState().lock !== kind) useLock.getState().setLock(null);
    const { sun, earth } = d;
    const flat = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z).normalize();
    const L = new THREE.Vector3(lander.pos.x, lander.groundY, lander.pos.z);
    setMode('orbit');
    if (kind === 'overview') {
      const back = flat(sun).multiplyScalar(-1);
      void c.setLookAt(L.x + back.x * 2600, L.y + 1900, L.z + back.z * 2600, L.x, L.y, L.z, smooth);
    } else if (kind === 'sun' || kind === 'earth') {
      const dir = kind === 'sun' ? sun : earth;
      // Stand beside the lander (not behind it) so the vehicle frames the shot without blocking the body.
      const f = flat(dir);
      const from = f.clone().multiplyScalar(-6).add(new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(11)).add(L);
      from.y = surfaceY(sample, t.meta.heightM, from.x, -from.z) + 1.7;
      setMode('look');
      void c.setLookAt(from.x, from.y, from.z, from.x + dir.x * 0.05, from.y + dir.y * 0.05, from.z + dir.z * 0.05, smooth);
      return;
    } else {
      const s = sideDir(sun);
      void c.setLookAt(L.x + s.x * 22, L.y + 6.5, L.z + s.z * 22, L.x, L.y + 2.6, L.z, smooth);
    }
  }, [dirsNow, sample, t, setMode]);

  useEffect(() => {
    if (!free) return;
    look(command.kind === 'reset' ? 'overview' : command.kind === 'sun' || command.kind === 'earth' ? command.kind : 'lander', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.nonce]);

  // Hand the camera to the controls exactly where the flight left it.
  useEffect(() => {
    if (!free || fp || !ref.current) return;
    const p = camera.position;
    const tg = cameraRest.override ?? restTarget.current;
    cameraRest.override = null;
    mode.current = 'orbit';
    void ref.current.setLookAt(p.x, p.y, p.z, tg.x, tg.y, tg.z, false);
  }, [free, fp, camera]);

  useFrame(() => {
    if (!started.current) {
      const d = dirsNow();
      if (!d) return;
      started.current = true;
      // Arrival: from the gate pose straight down onto the landing as the LM touches down.
      const gate = gatePoseENU(d.sun);
      camera.position.copy(gate.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(gate.target);
      lander.pos.set(0, 0, 0);
      lander.descentStart = performance.now();
      const end = landerPoseENU(d.sun);
      end.target.y = 3;
      restTarget.current.copy(end.target);
      void fly(gate, end, 'local', 5600).then(() => setFree(true));
    }
    const c = ref.current;
    if (free && c) {
      c.getPosition(tmp);
      const ground = surfaceY(sample, t.meta.heightM, tmp.x, -tmp.z) + 1.2;
      if (tmp.y < ground) void c.setPosition(tmp.x, ground, tmp.z, false);
      const lockOn = useLock.getState().lock;
      if (lockOn) {
        // Locked: keep the body centred as time runs; the lens can still zoom.
        const d = dirsNow();
        if (d) {
          if (mode.current !== 'look') {
            setMode('look');
            void c.zoomTo(4, true); // tighten the lens on the tracked body
          }
          // No easing: the view snaps to the body every frame so it never trails behind.
          const v = lockOn === 'sun' ? d.sun : d.earth;
          lockDir.current.copy(v);
          const L = lockDir.current;
          void c.setTarget(tmp.x + L.x * 0.05, tmp.y + L.y * 0.05, tmp.z + L.z * 0.05, false);
          c.update(0); // apply now, not next frame, so the body is centred in this very frame
          c.azimuthRotateSpeed = 0;
          c.polarRotateSpeed = 0;
        }
      } else if (mode.current === 'look' && c.azimuthRotateSpeed === 0) {
        lockDir.current.set(0, 0, 0);
        setMode('look'); // released: free look again from where the lock left the camera
        void c.zoomTo(1, true);
      } else if (mode.current === 'orbit') {
        // Let the camera dip below the subject (to look up at it) down to just above the ground.
        c.getTarget(tgt);
        const k = THREE.MathUtils.clamp((tgt.y - (ground - 1.2) - 1.0) / Math.max(c.distance, 1e-3), -1, 1);
        c.maxPolarAngle = THREE.MathUtils.clamp(Math.PI / 2 + Math.asin(k), 0.3, Math.PI - 0.05);
      }
    }
    const dir = tmp;
    camera.getWorldDirection(dir);
    viewHeading.az = (((Math.atan2(dir.x, -dir.z) * 180) / Math.PI) + 360) % 360;
    viewHeading.el = (Math.asin(dir.y) * 180) / Math.PI;
    viewHeading.hfov = (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI;
    viewHeading.active = true;
  });
  useEffect(() => () => {
    viewHeading.active = false;
    lander.descentStart = null;
  }, []);
  return free && !fp ? <CameraControls ref={ref} makeDefault minDistance={3} maxDistance={7_000} smoothTime={0.6} draggingSmoothTime={0.12} dollySpeed={0.5} /> : null;
}

export default function SurfaceView({ onReady }: { onReady?: () => void }) {
  const siteRef = useApp((s) => s.scenarios[s.active].site);
  const terrain = useSiteTerrain(siteRef, true);
  // The 3D scene stays in the site's frame; only the analysis follows the walking astronaut.
  const baseModel = useSiteModel(siteRef).model;
  const frame = baseModel.frame;
  const frameMatrix = useMemo(() => moonToSurfaceMatrix(frame), [frame]);
  const dirs = useSurfaceDirs(frameMatrix, frame.position);
  const sunDir = useCallback(() => dirs()?.sun ?? null, [dirs]);

  const farVis = useCallback(() => {
    const eph = ephemerisNow();
    if (!eph || !terrain?.horizon.far) return 1;
    const x = instantAt(eph, baseModel, currentTime(), useApp.getState().criteria);
    const far = horizonAt(terrain.horizon, x.sun.az, 'far');
    return diskVisibleFraction(x.sun.el - far, x.sun.radiusDeg);
  }, [terrain, baseModel]);
  const sunVisibility = useCallback(() => {
    const eph = ephemerisNow();
    if (!eph) return 0;
    return instantAt(eph, baseModel, currentTime(), useApp.getState().criteria).sun.fraction;
  }, [baseModel]);

  const earthPlace = useMemo(() => {
    const out: EarthPlacement = { matrix: new THREE.Matrix4(), sunDirWorld: new THREE.Vector3() };
    const q = new THREE.Quaternion();
    const r = new THREE.Matrix4();
    const cam = new THREE.Vector3();
    return (camera: THREE.Camera) => () => {
      const s = skyAt(currentTime());
      if (!s) return null;
      const dist = 260_000;
      const P = frame.position;
      const rel = [s.earth[0] - P[0], s.earth[1] - P[1], s.earth[2] - P[2]] as const;
      const range = Math.hypot(...rel);
      const radius = dist * Math.tan(Math.asin(EARTH_RADIUS_KM / range));
      const dir = new THREE.Vector3(rel[0], rel[1], rel[2]).applyMatrix4(frameMatrix).normalize();
      cam.copy(camera.position);
      q.set(s.qEarth[0], s.qEarth[1], s.qEarth[2], s.qEarth[3]);
      r.makeRotationFromQuaternion(q);
      out.matrix.copy(frameMatrix).multiply(r);
      out.matrix.scale(new THREE.Vector3(radius, radius, radius));
      out.matrix.setPosition(dir.multiplyScalar(dist).add(cam));
      out.sunDirWorld.set(s.sun[0] - s.earth[0], s.sun[1] - s.earth[1], s.sun[2] - s.earth[2]).applyMatrix4(frameMatrix).normalize();
      return out;
    };
  }, [frameMatrix, frame]);
  const camera = useThree((s) => s.camera);
  const placeEarth = useMemo(() => earthPlace(camera), [earthPlace, camera]);
  const skyRotation = useCallback(() => skyAt(currentTime())?.qSky ?? null, []);

  const light = useRef<THREE.DirectionalLight>(null);
  const lastLight = useMemo(() => new THREE.Vector3(1e9, 0, 0), []);
  const prof = useProfile();
  useFrame(() => {
    const d = dirs();
    const l = light.current;
    if (!d || !l) return;
    // Shadow frustum follows the lander so it stays sharp wherever it is parked.
    l.target.position.set(lander.pos.x * 0.5, lander.groundY, lander.pos.z * 0.5);
    l.position.copy(d.sun).multiplyScalar(400).add(l.target.position);
    l.target.updateMatrixWorld();
    if (l.position.distanceToSquared(lastLight) > 1e-4) {
      lastLight.copy(l.position);
      markShadows();
    }
    l.intensity = 5.5 * farVis() * sunVisibility();
  });

  useEffect(() => {
    if (terrain) onReady?.();
  }, [terrain, onReady]);

  const terrainGeom = useMemo(() => (terrain ? buildTerrainGeometry(terrain) : null), [terrain]);
  // Everything placed on the ground (lander, astronaut, footprints, rocks) uses the height of
  // the rendered mesh, so it sits exactly on what you see.
  const ground = useMemo(() => {
    if (!terrainGeom) return null;
    const g = terrainGeom;
    const n = new THREE.Vector3();
    return (x: number, z: number) => {
      const e = 1.6;
      const y = meshSurfaceY(g, x, z);
      const dx = (meshSurfaceY(g, x + e, z) - meshSurfaceY(g, x - e, z)) / (2 * e);
      const dz = (meshSurfaceY(g, x, z + e) - meshSurfaceY(g, x, z - e)) / (2 * e);
      return { y, normal: n.set(-dx, 1, -dz).normalize() };
    };
  }, [terrainGeom]);
  const sunLight = useCallback(() => farVis() * sunVisibility(), [farVis, sunVisibility]);

  return (
    <>
      <color attach="background" args={['#000']} />
      <Stars radius={300_000} toWorld={frameMatrix} rotation={skyRotation} brightness={0.55} follow />
      <SunGlare direction={sunDir} distance={200_000} visibility={sunVisibility} occluder="lander" />
      <EarthBody place={placeEarth} exposure={1.15} />
      <LunarEnvironment sunDir={sunDir} />
      <directionalLight
        ref={light}
        castShadow
        shadow-mapSize={[prof.shadowMap, prof.shadowMap]}
        shadow-camera-left={-130}
        shadow-camera-right={130}
        shadow-camera-top={130}
        shadow-camera-bottom={-130}
        shadow-camera-near={1}
        shadow-camera-far={1200}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      <ambientLight intensity={0.02} />
      <ShadowScheduler size={prof.shadowMap} />
      {terrain && (
        <>
          <Terrain t={terrain} geometry={terrainGeom!} dirs={dirs} farVis={farVis} />
          <ShadowCatcher t={terrain} terrainGeom={terrainGeom!} />
          <Suspense fallback={null}>
            <LunarModule ground={ground!} />
          </Suspense>
          <LandingDust sunLight={sunLight} />
          <Rocks ground={ground!} />
          <SkyOverlay terrain={terrain} />
          <Suspense fallback={null}>
            <Astronaut />
          </Suspense>
          <Footprints ground={ground!} sunLight={sunLight} />
          <Walk t={terrain} base={baseModel} ground={ground!} />
          <SurfaceCamera t={terrain} frame={frame} />
          <LockPicker frame={frame} />
          <Headlamp sunLight={sunLight} />
        </>
      )}
    </>
  );
}

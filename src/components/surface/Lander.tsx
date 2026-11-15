import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { lander } from './viewState';
import { markShadows } from './shadowState';
import { say } from '../../lib/voice';

const MODEL = `${import.meta.env.BASE_URL}models/apollo-lm-pbr.glb?v=2`;
useGLTF.preload(MODEL);

/** Powered-descent profile: hover high, then a decelerating descent to a soft touchdown. */
export const DESCENT = { startAlt: 70, holdS: 0.8, descentS: 6.2, dustAlt: 24 };

export function descentAlt(t: number) {
  if (t < DESCENT.holdS) return DESCENT.startAlt;
  const k = Math.min(1, (t - DESCENT.holdS) / DESCENT.descentS);
  return DESCENT.startAlt * Math.pow(1 - k, 1.7);
}

// Selection outline: an inverted hull pushed out along the normals, drawn white and unlit.
// Written by hand so it follows the logarithmic depth buffer the scene uses.
function outlineMaterial(thickness: number) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: { uThick: { value: thickness }, uOpacity: { value: 0.85 } },
    vertexShader: /* glsl */ `
      #include <common>
      uniform float uThick;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec3 p = position + normalize(normal) * uThick;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform float uOpacity;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(vec3(1.0), uOpacity);
      }`,
  });
}

/** Footpad contact points (model space), found as the four lowest vertex clusters of the mesh. */
function findFootpads(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  let minY = Infinity;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y < minY + 0.6) pts.push(v.clone());
      minY = Math.min(minY, v.y);
    }
  });
  const low = pts.filter((p) => p.y < minY + 0.25);
  // Legs may sit on the axes or on the diagonals: split both ways and keep the tighter clusters.
  const split = (rot: number) => {
    const groups: THREE.Vector3[][] = [[], [], [], []];
    for (const p of low) {
      const a = Math.atan2(p.z, p.x) - rot;
      groups[((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4].push(p);
    }
    let spread = 0;
    for (const g of groups) {
      if (!g.length) continue;
      const c = g.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / g.length);
      for (const p of g) spread += p.distanceToSquared(c);
    }
    return { groups, spread };
  };
  const a = split(0), b = split(Math.PI / 4);
  return (a.spread <= b.spread ? a : b).groups
    .filter((g) => g.length)
    .map((g) => {
      const c = g.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / g.length);
      c.y = Math.min(...g.map((p) => p.y));
      return c;
    });
}

/**
 * Apollo Lunar Module (photogrammetric PBR model: albedo, normal, AO/roughness/metal),
 * scaled to the real vehicle (~7 m tall, ~9 m across the footpads). It always rests on a plane
 * fitted through the ground under its four footpads, so every pad touches the surface. To move
 * it, double-click it (it gets a white outline), then drag; double-click again or press Esc to let go.
 */
export function LunarModule({ ground, onDragState }: { ground: (x: number, z: number) => { y: number; normal: THREE.Vector3 }; onDragState?: (dragging: boolean) => void }) {
  const { scene } = useGLTF(MODEL);
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.envMapIntensity = 1.15;
      mat.aoMapIntensity = 1;
      mat.normalScale.set(1, 1);
      m.material = mat;
    });
    return root;
  }, [scene]);
  const pads = useMemo(() => findFootpads(model), [model]);
  useEffect(() => {
    model.userData.pads = pads;
  }, [model, pads]);
  const [selected, setSelected] = useState(false);
  const outlines = useMemo(() => {
    const list: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.isOutline) return;
      // Thickness in the mesh's own units (quantized meshes carry a scale).
      const s = m.getWorldScale(new THREE.Vector3()).x || 1;
      const hull = new THREE.Mesh(m.geometry, outlineMaterial(0.022 / s));
      hull.userData.isOutline = true;
      hull.raycast = () => undefined;
      hull.visible = false;
      m.add(hull);
      list.push(hull);
    });
    return list;
  }, [model]);
  useEffect(() => {
    outlines.forEach((o) => (o.visible = selected));
  }, [selected, outlines]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(false);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const group = useRef<THREE.Group>(null);
  const plume = useRef<THREE.Sprite>(null);
  const plumeMat = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,236,210,1)');
    gr.addColorStop(0.25, 'rgba(255,190,140,0.35)');
    gr.addColorStop(1, 'rgba(255,170,120,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, color: new THREE.Color(3, 2.6, 2.2) });
  }, []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const planeN = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const invalidate = useThree((s) => s.invalidate);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = lander.descentStart === null ? Infinity : (performance.now() - lander.descentStart) / 1000;
    const wasFlying = lander.alt > 0;
    lander.alt = Number.isFinite(t) ? descentAlt(t) : 0;
    if (wasFlying && lander.alt <= 0.0001) void say('touchdown');
    // Fit a plane through the ground under the four footpads (least squares) and rest the
    // vehicle on it: pads lie in the model's y = 0 plane, so tilting that plane onto the fitted
    // one and placing the origin on it puts every pad on the ground.
    let y: number;
    if (pads.length >= 3) {
      let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
      for (const p of pads) {
        const gy = ground(lander.pos.x + p.x, lander.pos.z + p.z).y;
        sx += p.x; sz += p.z; sy += gy; sxx += p.x * p.x; szz += p.z * p.z; sxz += p.x * p.z; sxy += p.x * gy; szy += p.z * gy;
      }
      const n = pads.length;
      const mx = sx / n, mz = sz / n, my = sy / n;
      const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxy = sxy / n - mx * my, czy = szy / n - mz * my;
      const det = cxx * czz - cxz * cxz || 1e-9;
      const b = (cxy * czz - czy * cxz) / det, c = (czy * cxx - cxy * cxz) / det;
      y = my - b * mx - c * mz - 0.03; // pads sink a few centimetres into the regolith
      planeN.set(-b, 1, -c).normalize();
    } else {
      const gr = ground(lander.pos.x, lander.pos.z);
      y = gr.y;
      planeN.copy(gr.normal);
    }
    // Ease the vehicle onto the slope as it settles.
    const settle = 1 - THREE.MathUtils.smoothstep(lander.alt, 0, 1.2); // 1 once on the ground
    q.setFromUnitVectors(up, planeN);
    g.quaternion.identity().slerp(q, settle);
    if (Math.abs(g.position.x - lander.pos.x) + Math.abs(g.position.y - (y + lander.alt)) + Math.abs(g.position.z - lander.pos.z) > 1e-4 || settle < 1) markShadows();
    g.position.set(lander.pos.x, y + lander.alt, lander.pos.z);
    lander.groundY = y;
    if (plume.current) {
      const on = lander.alt > 0.02;
      plume.current.visible = on;
      // Hypergolic exhaust is nearly invisible in vacuum: only the hot nozzle throat glows.
      plume.current.scale.setScalar(0.9 + Math.random() * 0.15);
    }
    if (lander.alt > 0.0001) invalidate();
  });

  // Drag the vehicle across the ground plane.
  const { camera, controls, gl } = useThree();
  const drag = useRef<{ id: number; dx: number; dz: number } | null>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const pickGround = (clientX: number, clientY: number) => {
    const r = gl.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let h = lander.groundY;
    for (let i = 0; i < 3; i++) {
      const d = ray.ray.direction;
      if (Math.abs(d.y) < 1e-4) return null;
      const t = (h - ray.ray.origin.y) / d.y;
      if (t < 0) return null;
      hit.copy(ray.ray.origin).addScaledVector(d, t);
      h = ground(hit.x, hit.z).y;
    }
    return hit;
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const p = pickGround(e.clientX, e.clientY);
      if (!p) return;
      const x = p.x - d.dx, z = p.z - d.dz;
      const r = Math.hypot(x, z);
      const k = r > lander.maxRadius ? lander.maxRadius / r : 1;
      lander.pos.set(x * k, 0, z * k);
      invalidate();
    };
    const up = (e: PointerEvent) => {
      if (!drag.current || e.pointerId !== drag.current.id) return;
      drag.current = null;
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
      gl.domElement.style.cursor = '';
      onDragState?.(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (lander.alt > 0.05 || !selected) return;
    e.stopPropagation();
    const p = pickGround(e.clientX, e.clientY);
    if (!p) return;
    drag.current = { id: e.pointerId, dx: p.x - lander.pos.x, dz: p.z - lander.pos.z };
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
    gl.domElement.style.cursor = 'grabbing';
    onDragState?.(true);
  };

  return (
    <group ref={group} name="lander">
      <primitive
        object={model}
        onPointerDown={onDown}
        onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
          if (lander.alt > 0.05) return;
          e.stopPropagation();
          setSelected((v) => !v);
          invalidate();
        }}
        onPointerMissed={() => selected && setSelected(false)}
        onPointerOver={() => { if (!drag.current && selected) gl.domElement.style.cursor = 'grab'; }}
        onPointerOut={() => { if (!drag.current) gl.domElement.style.cursor = ''; }}
      />
      <sprite ref={plume} material={plumeMat} position={[0, 0.55, 0]} visible={false} />
    </group>
  );
}

// ---------------------------------------------------------------- landing dust

const dustVert = /* glsl */ `
  #include <common>
  attribute vec4 aSeed;
  attribute float aTrail;
  uniform float uTime;
  uniform float uEmit0;
  uniform float uEmit1;
  uniform vec3 uOrigin;
  uniform float uPx;
  varying float vAlpha;
  #include <logdepthbuf_pars_vertex>
  void main() {
    // Each grain is launched once, at a time spread over the emission window.
    float born = uEmit0 + aSeed.x * 4.5;
    float age = uTime - born - aTrail * 0.018; // trailing samples draw each grain as a streak
    float life = 0.7 + aSeed.w * 1.6;
    vec3 p = vec3(0.0, -1e5, 0.0);
    vAlpha = 0.0;
    if (age > 0.0 && age < life && born <= uEmit1) {
      // Vacuum, no drag: a flat ballistic sheet. Exhaust-entrained regolith leaves at
      // low angles (1–3°) and hundreds of m/s, so it streaks outward instead of billowing.
      float az = aSeed.y * 6.2831853;
      float elev = radians(0.3 + aSeed.z * aSeed.z * 2.2);
      float speed = 40.0 + pow(aSeed.w, 1.5) * 260.0;
      float r0 = 2.0 + aSeed.z * 4.0;
      vec3 dir = vec3(cos(az), 0.0, sin(az));
      p = uOrigin + dir * (r0 + speed * cos(elev) * age);
      p.y += 0.15 + speed * sin(elev) * age - 0.81 * age * age;
      vAlpha = (1.0 - age / life) * smoothstep(0.0, 0.06, age) * (1.0 - aTrail * 0.2);
    }
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPx * (0.04 + aSeed.z * 0.07) / -mv.z, 1.0, 5.0);
    #include <logdepthbuf_vertex>
  }
`;
const dustFrag = /* glsl */ `
  #include <common>
  uniform vec3 uColor;
  varying float vAlpha;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float d = 1.0 - smoothstep(0.2, 0.5, length(c));
    if (vAlpha * d < 0.01) discard;
    gl_FragColor = vec4(uColor, vAlpha * d * 0.5);
  }
`;

// Billowing sheets: the dense regolith the plume scours up near the pad reads as soft,
// fast, ground-hugging clouds (as in Apollo landing films) that thin out and settle once
// the engine cuts. Large soft points with per-cloud noise; very few of them, so cheap.
const cloudVert = /* glsl */ `
  #include <common>
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uEmit0;
  uniform float uEmit1;
  uniform vec3 uOrigin;
  uniform float uPx;
  varying float vAlpha;
  varying vec2 vSeed;
  varying float vAge;
  #include <logdepthbuf_pars_vertex>
  void main() {
    float born = uEmit0 + aSeed.x * 4.5;
    float age = uTime - born;
    float life = 1.6 + aSeed.w * 2.6;
    vec3 p = vec3(0.0, -1e5, 0.0);
    vAlpha = 0.0;
    float size = 1.0;
    if (age > 0.0 && age < life && born <= uEmit1) {
      float az = aSeed.y * 6.2831853;
      float speed = 8.0 + aSeed.w * aSeed.w * 55.0;
      float k = 0.9;                                 // sheets spread quickly, then slow and thin
      float dist = 2.5 + aSeed.z * 3.0 + speed * (1.0 - exp(-k * age)) / k;
      vec3 dir = vec3(cos(az), 0.0, sin(az));
      p = uOrigin + dir * dist;
      size = (1.8 + aSeed.z * 3.2) * (1.0 + age * 1.3);
      // Float each cloud so its soft edge rests on the ground: a sprite that cuts into the
      // terrain gets clipped by the depth test and shows a hard horizontal edge.
      float rise = (0.3 + aSeed.z * 1.8) * (1.0 - exp(-age * 1.6));
      p.y += max(0.0, size * 0.42 + rise - 0.1 * age * age);
      float fade = pow(1.0 - age / life, 1.6);
      vAlpha = fade * smoothstep(0.0, 0.2, age) * 0.16;
    }
    vSeed = aSeed.yz * 37.0;
    vAge = age;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPx * size / -mv.z, 2.0, 420.0);
    #include <logdepthbuf_vertex>
  }
`;
const cloudFrag = /* glsl */ `
  #include <common>
  uniform vec3 uColor;
  varying float vAlpha;
  varying vec2 vSeed;
  varying float vAge;
  #include <logdepthbuf_pars_fragment>
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5 || vAlpha < 0.002) discard;
    vec2 q = c * 3.0 + vSeed + vec2(vAge * 0.4, 0.0);
    float billow = n(q) * 0.55 + n(q * 2.1 + 5.3) * 0.3 + n(q * 4.3 + 9.1) * 0.15;
    float a = exp(-r * r * 9.0) * smoothstep(0.25, 0.75, billow + 0.25 - r * 0.6);
    gl_FragColor = vec4(uColor * (0.85 + 0.3 * billow), a * vAlpha);
  }
`;

/** Regolith blown out by the descent engine, lit by the Sun. Driven entirely on the GPU. */
export function LandingDust({ sunLight }: { sunLight: () => number }) {
  const GRAINS = 9000, TRAIL = 5, N = GRAINS * TRAIL;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(N * 4);
    const trail = new Float32Array(N);
    for (let i = 0; i < GRAINS; i++) {
      const r = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < TRAIL; k++) {
        seed.set(r, (i * TRAIL + k) * 4);
        trail[i * TRAIL + k] = k;
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aTrail', new THREE.BufferAttribute(trail, 1));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uEmit0: { value: 0 }, uEmit1: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uPx: { value: 800 }, uColor: { value: new THREE.Color() } },
      }),
    [],
  );
  const CLOUDS = 420;
  const cloudGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(CLOUDS * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CLOUDS * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    return g;
  }, []);
  // Shares the uniform objects with the grains, so one update drives both layers.
  const cloudMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false, uniforms: mat.uniforms }),
    [mat],
  );
  const emit = useRef<{ t0: number | null; t1: number | null }>({ t0: null, t1: null });
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    if (lander.descentStart === null) return;
    const now = (performance.now() - lander.descentStart) / 1000;
    const e = emit.current;
    if (e.t0 === null && lander.alt < DESCENT.dustAlt && lander.alt > 0) e.t0 = now;
    if (e.t0 !== null && e.t1 === null && lander.alt <= 0.0001) e.t1 = now;
    const u = mat.uniforms;
    u.uTime.value = now;
    u.uEmit0.value = e.t0 ?? 0;
    u.uEmit1.value = e.t1 ?? (e.t0 !== null ? now : 0);
    // Anchor the dust where the engine blew it out; it stays put if the LM is moved afterwards.
    if (e.t1 === null) u.uOrigin.value.set(lander.pos.x, lander.groundY, lander.pos.z);
    u.uPx.value = size.height * 1.6;
    const lit = 0.06 + 0.9 * sunLight();
    u.uColor.value.setRGB(1.1 * lit, 1.06 * lit, 1.0 * lit);
    // Keep animating until the last grain and cloud has settled (render-on-demand otherwise freezes them).
    if (e.t0 !== null && (e.t1 === null || now < e.t1 + 4.5)) invalidate();
  });
  return (
    <>
      <points geometry={cloudGeo} material={cloudMat} frustumCulled={false} renderOrder={4} />
      <points geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />
    </>
  );
}

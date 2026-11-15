import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { profile } from '../../lib/perf/quality';

// The Sun as one billboard: a limb-darkened photosphere whose edge wobbles very slightly,
// wrapped in a soft corona of slowly drifting, flame-like streamers. Additive, HDR.
const glareVert = /* glsl */ `
  #include <common>
  varying vec2 vUv;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const glareFrag = /* glsl */ `
  #include <common>
  uniform float uOpacity;
  uniform float uTime;
  uniform float uDiskR;     // disk radius as a fraction of the quad half-size
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
  // Periodic angular noise: sample around the circle so there is no seam.
  float ang(float a, float freq, float t) {
    return n1(a * freq / 6.2831853 * 6.0 + t) * 0.5 + n1(a * freq / 6.2831853 * 13.0 - t * 1.3 + 17.0) * 0.3 + n1(a * freq / 6.2831853 * 29.0 + t * 1.9 + 41.0) * 0.2;
  }
  float seamless(float a, float t) {
    float w = smoothstep(0.0, 1.0, (a + PI) / (2.0 * PI));
    float aa = a + PI;
    return mix(ang(aa, 1.0, t), ang(aa - 2.0 * PI, 1.0, t), w);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float n = seamless(a, uTime * 0.35);
    float m = seamless(a + 1.7, uTime * 0.22 + 9.0);
    // Photosphere: limb-darkened disk with a barely-there wobble on the edge.
    float R = uDiskR * (1.0 + (n - 0.5) * 0.06);
    float edge = 1.0 - smoothstep(R * 0.96, R * 1.04, r);
    float mu = sqrt(max(0.0, 1.0 - (r / R) * (r / R)));
    float limb = 0.55 + 0.45 * mu;
    vec3 disk = vec3(1.0, 0.97, 0.92) * 9.0 * limb * edge;
    // Corona/glare: falls off with distance, stretched into soft licks by the angular noise.
    float x = max(r - R * 0.9, 0.0) / (1.0 - R);
    float flames = pow(n, 2.2) * 1.4 + pow(m, 3.0) * 0.8;
    float corona = exp(-x * (9.0 - 4.0 * flames)) * (0.55 + 0.6 * flames) + exp(-x * 3.0) * 0.06;
    vec3 col = disk + vec3(1.0, 0.94, 0.84) * corona * 0.9 * (1.0 - edge * 0.9);
    col *= 1.0 - smoothstep(0.75, 1.0, r);
    gl_FragColor = vec4(col * uOpacity, 1.0);
  }
`;

/**
 * The Sun as seen without an atmosphere: a hard white disk of its true angular
 * size plus a restrained camera glare. `visibility` (0–1) dims the glare when the
 * disk is partly behind terrain.
 */
export function SunGlare({ direction, distance, angularRadius = 0.00465, visibility, glareScale = 1, occluder }: { direction: () => THREE.Vector3 | null; distance: number; angularRadius?: number; visibility?: () => number; glareScale?: number; occluder?: string }) {
  const scene = useThree((s) => s.scene);
  const occ = useMemo(() => ({ ray: new THREE.Raycaster(), box: new THREE.Box3(), frame: 0, blocked: 0, value: 0 }), []);
  const glare = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const tick = useRef(0);
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  const glareMat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: glareVert, fragmentShader: glareFrag, uniforms: { uOpacity: { value: 1 }, uTime: { value: 0 }, uDiskR: { value: 0.1 } }, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, toneMapped: false }), []);
  useFrame(({ camera }) => {
    const d = direction();
    if (!d || !glare.current) return;
    const p = d.clone().multiplyScalar(distance).add(camera.position);
    const r = Math.tan(angularRadius) * distance;
    const span = 10 * glareScale;  // quad half-size in solar radii
    glare.current.position.copy(p);
    glare.current.quaternion.copy(camera.quaternion);
    glare.current.scale.setScalar(r * span);
    glareMat.uniforms.uDiskR.value = 1 / span;
    glareMat.uniforms.uTime.value = performance.now() / 1000;
    // Keep the corona drifting (at a low frame rate) while the Sun is on screen.
    if (profile().ambient && d.dot(camera.getWorldDirection(tmpDir)) > 0.5 && !tick.current) {
      tick.current = window.setTimeout(() => {
        tick.current = 0;
        invalidate();
      }, 100);
    }
    // Hide the glare when a foreground object (the lander) covers the Sun.
    if (occluder && occ.frame++ % 3 === 0) {
      const o = scene.getObjectByName(occluder);
      occ.blocked = 0;
      if (o) {
        occ.ray.set(camera.position, d);
        occ.ray.camera = camera;
        occ.box.setFromObject(o);
        if (occ.ray.ray.intersectsBox(occ.box)) occ.blocked = occ.ray.intersectObject(o, true).length > 0 ? 1 : 0;
      }
    }
    occ.value += (occ.blocked - occ.value) * 0.35;
    glareMat.uniforms.uOpacity.value = (visibility ? visibility() : 1) * (1 - occ.value);
  });
  return (
    <>
      <mesh ref={glare} material={glareMat} renderOrder={50}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </>
  );
}

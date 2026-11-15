import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadStars } from './textures';
import type { Quat } from '../../lib/science/vec';

/** B−V colour index to an approximate linear RGB tint. */
function bvToRgb(bv: number): [number, number, number] {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  const r = t < 0.4 ? 0.61 + 0.11 * t + 0.1 * t * t : 0.83 + 0.17 * Math.min(1, (t - 0.4) / 1.2);
  const g = t < 0.0 ? 0.7 + 0.07 * t + 0.1 * t * t : 0.87 - 0.2 * Math.max(0, t - 0.4) / 1.6;
  const b = t < 0.4 ? 1.0 : Math.max(0.55, 1.0 - 0.42 * (t - 0.4) / 1.6);
  return [r, g, b];
}

const vertex = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float flux = pow(10.0, -0.4 * (aMag - 1.0));
    gl_PointSize = clamp(1.4 + 2.2 * sqrt(flux), 1.2, 5.5) * uPixelRatio;
    vAlpha = clamp(0.18 + 0.9 * sqrt(flux), 0.12, 1.0) * uScale;
    vColor = aColor;
    #include <logdepthbuf_vertex>
  }
`;
const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
  }
`;

/** Yale Bright Star Catalogue (V ≤ 6.5) placed with the SPICE J2000→Moon-fixed rotation. */
export function Stars({ radius, toWorld, rotation, brightness = 1, follow = false }: { radius: number; toWorld: THREE.Matrix4; rotation: () => Quat | null; brightness?: number; follow?: boolean }) {
  const [data, setData] = useState<Float32Array | null>(null);
  useEffect(() => {
    loadStars().then(setData, () => undefined);
  }, []);
  const geometry = useMemo(() => {
    if (!data) return null;
    const n = data.length / 5;
    const pos = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = data[i * 5] * radius;
      pos[i * 3 + 1] = data[i * 5 + 1] * radius;
      pos[i * 3 + 2] = data[i * 5 + 2] * radius;
      mag[i] = data[i * 5 + 3];
      const [r, g, b] = bvToRgb(data[i * 5 + 4]);
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 2);
    return g;
  }, [data, radius]);
  const material = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uPixelRatio: { value: Math.min(2, window.devicePixelRatio) }, uScale: { value: brightness } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    material.uniforms.uScale.value = brightness;
  }, [brightness, material]);
  const ref = useRef<THREE.Points>(null);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(({ camera }) => {
    const p = ref.current;
    const r = rotation();
    if (!p || !r) return;
    q.set(r[0], r[1], r[2], r[3]);
    m.makeRotationFromQuaternion(q);
    p.matrix.multiplyMatrices(toWorld, m);
    if (follow) p.matrix.setPosition(camera.position);
    p.matrixWorldNeedsUpdate = true;
  });
  if (!geometry) return null;
  return <points ref={ref} geometry={geometry} material={material} matrixAutoUpdate={false} renderOrder={-10} frustumCulled={false} />;
}

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useProfile } from '../../lib/perf/quality';
import { markShadows } from './shadowState';

/**
 * Level of detail by size: most of the population is cobbles a few centimetres across, which
 * need a few facets, not hundreds, and are too small to cast a visible shadow.
 */
const LODS = [
  { detail: 0, below: 0.12, cast: false },
  { detail: 1, below: 0.4, cast: true },
  { detail: 3, below: Infinity, cast: true },
] as const;
const SHAPES = [11, 23, 37, 51];

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An irregular, faceted boulder: a noisy icosphere, flattened and chipped. */
function rockGeometry(seed: number, detail = 3) {
  const r = rand(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const planes = Array.from({ length: 7 }, () => ({ n: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), d: 0.55 + r() * 0.35 }));
  const sx = 0.7 + r() * 0.6, sy = 0.45 + r() * 0.35, sz = 0.7 + r() * 0.6;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const bump = 1 + 0.12 * Math.sin(v.x * 5.1 + seed) * Math.sin(v.y * 4.3 + seed * 0.7) * Math.sin(v.z * 6.7);
    v.multiplyScalar(bump);
    // Fracture faces: clamp against random planes.
    for (const pl of planes) {
      const k = v.dot(pl.n);
      if (k > pl.d) v.addScaledVector(pl.n, pl.d - k);
    }
    v.set(v.x * sx, v.y * sy, v.z * sz);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  g.dispose();
  return ng;
}

/**
 * Scattered boulders and cobbles around the lander. LOLA's 20 m posting can't resolve
 * them, so this is illustrative: sizes follow a power-law population (many cobbles,
 * few metre-scale blocks), as measured from LROC NAC boulder counts.
 */
export function Rocks({ ground, radius = 170, seed = 7 }: { ground: (x: number, z: number) => { y: number; normal: THREE.Vector3 }; radius?: number; seed?: number }) {
  const count = useProfile().rocks;
  const variants = useMemo(() => LODS.map((l) => SHAPES.map((s) => rockGeometry(s, l.detail))), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.155, 0.148), roughness: 0.96, metalness: 0, flatShading: false }), []);
  const meshes = useMemo(() => {
    const r = rand(seed);
    const q = new THREE.Quaternion();
    const tilt = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    // The same seeded sequence at every tier: a lower tier shows a subset of the same rocks.
    const buckets = LODS.map(() => SHAPES.map(() => [] as { m: THREE.Matrix4; k: number }[]));
    for (let i = 0; i < count; i++) {
      // Area-uniform placement, kept clear of the lander pad.
      let x = 0, z = 0;
      do {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
        x = Math.cos(a) * d;
        z = Math.sin(a) * d;
      } while (Math.hypot(x, z) < 7);
      const size = Math.min(2.2, 0.04 * Math.pow(1 - r(), -1 / 1.7));
      const gr = ground(x, z);
      tilt.setFromUnitVectors(up, gr.normal);
      q.setFromEuler(new THREE.Euler(r() * 0.5, r() * Math.PI * 2, r() * 0.5)).premultiply(tilt);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, gr.y - size * 0.18, z), q, new THREE.Vector3(size, size, size));
      const k = 0.75 + r() * 0.55;
      const lod = LODS.findIndex((l) => size < l.below);
      buckets[lod][i % SHAPES.length].push({ m, k });
    }
    const col = new THREE.Color();
    const out: THREE.InstancedMesh[] = [];
    buckets.forEach((shapes, li) => shapes.forEach((list, si) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(variants[li][si], material, list.length);
      list.forEach(({ m, k }, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.setRGB(k, k * 0.985, k * 0.96));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = LODS[li].cast;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `rocks-${li}-${si}`;
      out.push(mesh);
    }));
    markShadows();
    return out;
  }, [variants, material, ground, radius, count, seed]);
  useEffect(() => () => {
    meshes.forEach((m) => m.dispose());
  }, [meshes]);
  useEffect(() => () => {
    variants.flat().forEach((g) => g.dispose());
    material.dispose();
  }, [variants, material]);
  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}

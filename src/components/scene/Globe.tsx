import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { createGlobeMaterial } from './globeMaterial';
import { threeToMoon } from './frames';

/**
 * High-resolution cap: a dense, centre-weighted patch of the sphere under the camera, displaced
 * by the same LOLA heights in the vertex shader. Close to the surface it replaces the coarse
 * globe (which is cut away beneath it), so relief and shading keep their detail as you descend.
 */
function buildCap(c: THREE.Vector3, theta: number, geo: THREE.BufferGeometry, K = 150, M = 240) {
  const t1 = new THREE.Vector3(0, 1, 0).cross(c);
  if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
  t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(c, t1);
  const pos = (geo.getAttribute('position') as THREE.BufferAttribute | undefined)?.array as Float32Array | undefined;
  const arr = pos && pos.length === (K + 1) * M * 3 ? pos : new Float32Array((K + 1) * M * 3);
  for (let k = 0; k <= K; k++) {
    const th = theta * Math.pow(k / K, 1.8);
    const ct = Math.cos(th), st = Math.sin(th);
    for (let m = 0; m < M; m++) {
      const ph = (m / M) * Math.PI * 2;
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const i = (k * M + m) * 3;
      arr[i] = c.x * ct + (t1.x * cp + t2.x * sp) * st;
      arr[i + 1] = c.y * ct + (t1.y * cp + t2.y * sp) * st;
      arr[i + 2] = c.z * ct + (t1.z * cp + t2.z * sp) * st;
    }
  }
  if (arr !== pos) {
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const idx: number[] = [];
    for (let k = 0; k < K; k++) for (let m = 0; m < M; m++) {
      const a = k * M + m, b = k * M + ((m + 1) % M), cc = (k + 1) * M + m, d = (k + 1) * M + ((m + 1) % M);
      idx.push(a, cc, b, b, cc, d);
    }
    geo.setIndex(idx);
  } else (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  geo.computeBoundingSphere();
}
import { currentTime, skyAt } from './sim';
import { loadGlobeTextures, loadHighResColor, type GlobeTextures } from './textures';
import { useApp } from '../../state/store';
import { useProfile } from '../../lib/perf/quality';

/** Fewer ray-march steps reach the same distance with a larger step growth. */
export const growFor = (base: number, baseSteps: number, steps: number) => Math.pow(base, baseSteps / Math.max(1, steps));

export function Globe({ onReady, onPointer }: { onReady?: () => void; onPointer?: (e: { point: THREE.Vector3; type: 'move' | 'click' | 'leave' }) => void }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [tex, setTex] = useState<GlobeTextures | null>(null);
  const exag = useApp((s) => s.reliefExaggeration);
  useEffect(() => {
    let alive = true;
    loadGlobeTextures().then((t) => alive && setTex(t), (e) => console.error(e));
    return () => {
      alive = false;
    };
  }, []);
  const material = useMemo(() => (tex ? createGlobeMaterial(tex) : null), [tex]);
  useEffect(() => {
    if (!material) return;
    onReady?.();
    // LOD: upgrade to the 8k mosaic once the first frame is up.
    let alive = true;
    const id = window.setTimeout(() => {
      loadHighResColor(gl.capabilities.maxTextureSize).then((hi) => {
        if (!alive || !hi) return;
        hi.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());
        material.uniforms.uColor.value = hi;
      });
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [material, gl, onReady]);
  useEffect(() => {
    if (material) material.uniforms.uExag.value = exag;
  }, [material, exag]);

  const prof = useProfile();
  const [segW, segH] = prof.globe;
  const geometry = useMemo(() => new THREE.SphereGeometry(1, segW, segH), [segW, segH]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const capMaterial = useMemo(() => (material ? new THREE.ShaderMaterial({ vertexShader: material.vertexShader, fragmentShader: material.fragmentShader, uniforms: { ...material.uniforms, uIsCap: { value: 1 } } }) : null), [material]);
  useEffect(() => {
    if (!material) return;
    const [p, g] = prof.steps;
    // Uniform objects are shared, so the detail cap follows too.
    material.uniforms.uStepsP.value = p;
    material.uniforms.uStepsG.value = g;
    material.uniforms.uGrowP.value = growFor(1.165, 44, p);
    material.uniforms.uGrowG.value = growFor(1.125, 36, g);
    material.uniforms.uDetail.value = prof.detail;
    invalidate();
  }, [material, prof, invalidate]);
  const capGeo = useMemo(() => new THREE.BufferGeometry(), []);
  const cap = useMemo(() => ({ center: new THREE.Vector3(), theta: 0, on: false, tmp: new THREE.Vector3() }), []);
  const capMesh = useMemo(() => ({ visible: false }), []);
  const [capOn, setCapOn] = useState(false);
  useFrame(({ camera }) => {
    if (!material) return;
    // Detail cap under the camera when close to the surface.
    const alt = camera.position.length() - 1;
    const want = alt < 0.22;
    if (want) {
      const c = cap.tmp.copy(camera.position).normalize();
      const theta = THREE.MathUtils.clamp(alt * 6 + 0.004, 0.006, 0.4);
      if (!cap.on || c.angleTo(cap.center) > cap.theta * 0.12 || Math.abs(theta / cap.theta - 1) > 0.3) {
        cap.center.copy(c);
        cap.theta = theta;
        buildCap(c, theta, capGeo);
        const m = threeToMoon(c);
        material.uniforms.uCapDir.value.set(m[0], m[1], m[2]);
        material.uniforms.uCapCos.value = Math.cos(theta * 0.985);
      }
    } else material.uniforms.uCapCos.value = 2; // no cap: nothing is cut away
    if (want !== cap.on) {
      cap.on = want;
      capMesh.visible = want;
      setCapOn(want);
    }
    const sky = skyAt(currentTime());
    if (!sky) return;
    material.uniforms.uSunDir.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
    material.uniforms.uEarthDir.value.set(sky.earthDir[0], sky.earthDir[1], sky.earthDir[2]);
    material.uniforms.uEarthPhase.value = sky.earthPhase;
    const c = threeToMoon(camera.position);
    material.uniforms.uCamMoon.value.set(c[0], c[1], c[2]);
  });

  const hitMaterial = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), []);
  if (!material) return null;
  return (
    <>
    <mesh geometry={geometry} material={material} raycast={() => null} />
    {capOn && capMaterial && <mesh geometry={capGeo} material={capMaterial} raycast={() => null} frustumCulled={false} />}
    <mesh
      material={hitMaterial}
      onPointerMove={(e) => onPointer?.({ point: e.point, type: 'move' })}
      onPointerOut={(e) => onPointer?.({ point: e.point, type: 'leave' })}
      onClick={(e) => {
        if (e.delta > 5) return;
        e.stopPropagation();
        onPointer?.({ point: e.point, type: 'click' });
      }}
    >
      <sphereGeometry args={[1.0, 96, 48]} />
    </mesh>
    </>
  );
}

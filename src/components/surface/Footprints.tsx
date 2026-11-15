import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { astro, forwardOf } from './Astronaut';

type Ground = (x: number, z: number) => { y: number; normal: THREE.Vector3 };

/** Boot sole: a rounded outline with the transverse ribs of an Apollo-style overshoe, as height. */
function soleTextures() {
  const W = 128, H = 256;
  const h = new Float32Array(W * H);
  const inside = (x: number, y: number) => {
    // toe (top) wider than heel (bottom), rounded ends
    const v = y / H;
    const half = (0.36 + 0.08 * Math.sin(Math.PI * Math.min(1, v * 1.4))) * W;
    const dx = Math.abs(x - W / 2);
    const capT = 0.12 * H, capB = 0.1 * H;
    if (y < capT) return Math.hypot(dx / half, (capT - y) / capT) <= 1;
    if (y > H - capB) return Math.hypot(dx / (half * 0.9), (y - (H - capB)) / capB) <= 1;
    return dx <= half;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      // Pressed in by ~1 cm, with raised ribs every ~1.2 cm left by the tread.
      const rib = 0.5 + 0.5 * Math.cos((y / H) * Math.PI * 2 * 26);
      h[y * W + x] = -1 + 0.45 * rib * rib;
    }
  }
  // Soften edges so the print reads as a depression, not a sticker.
  const blur = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const xx = x + i, yy = y + j;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      s += h[yy * W + xx];
      n++;
    }
    blur[y * W + x] = s / n;
  }
  const nrm = new Uint8Array(W * H * 4);
  const alpha = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const dx = (blur[y * W + Math.min(W - 1, x + 1)] - blur[y * W + Math.max(0, x - 1)]) * 2.5;
    const dy = (blur[Math.min(H - 1, y + 1) * W + x] - blur[Math.max(0, y - 1) * W + x]) * 2.5;
    const n = new THREE.Vector3(-dx, dy, 1).normalize();
    nrm.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], i * 4);
    const a = Math.min(1, -blur[i] * 1.6);
    alpha.set([a * 255, a * 255, a * 255, 255], i * 4);
  }
  const mk = (d: Uint8Array) => {
    const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
    t.needsUpdate = true;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    return t;
  };
  return { normal: mk(nrm), alpha: mk(alpha) };
}

const kickVert = /* glsl */ `
  #include <common>
  attribute vec3 aOrigin;
  attribute vec3 aVel;
  attribute float aBorn;
  uniform float uTime;
  uniform float uPx;
  varying float vA;
  #include <logdepthbuf_pars_vertex>
  void main() {
    float age = uTime - aBorn;
    float life = 1.4;
    vec3 p = vec3(0.0, -1e5, 0.0);
    vA = 0.0;
    if (age > 0.0 && age < life) {
      // Ballistic in vacuum under lunar gravity: clean parabolic arcs, no billowing.
      p = aOrigin + aVel * age + vec3(0.0, -0.81 * age * age, 0.0);
      if (p.y < aOrigin.y - 0.05) p.y = -1e5;     // landed
      vA = 1.0 - age / life;
    }
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPx * 0.012 / -mv.z, 1.0, 4.0);
    #include <logdepthbuf_vertex>
  }
`;
const kickFrag = /* glsl */ `
  #include <common>
  uniform vec3 uColor;
  varying float vA;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5 || vA <= 0.0) discard;
    gl_FragColor = vec4(uColor, vA * (1.0 - d * 2.0) * 0.8);
  }
`;

const MAX_PRINTS = 700;
const MAX_GRAINS = 1200;

/**
 * Boot prints pressed into the regolith wherever a boot actually plants (from the animated
 * ankle joints), and the small ballistic sprays the toes throw up on each step.
 * The tread is a normal map, so the low Sun picks out the ribs.
 */
export function Footprints({ ground, sunLight }: { ground: Ground; sunLight: () => number }) {
  const tex = useMemo(soleTextures, []);
  const prints = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.15, 0.32);
    g.rotateX(-Math.PI / 2);
    // Compressed regolith reads darker, and the tread ribs show as alternating dark bands.
    // Darken-only (no lighting of its own), so prints never glow inside terrain shadow.
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex.alpha, transparent: true, opacity: 0.42, depthWrite: false });
    const im = new THREE.InstancedMesh(g, m, MAX_PRINTS);
    im.count = 0;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.renderOrder = 2;
    return im;
  }, [tex]);

  const kicks = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_GRAINS * 3), 3));
    g.setAttribute('aOrigin', new THREE.BufferAttribute(new Float32Array(MAX_GRAINS * 3), 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(MAX_GRAINS * 3), 3));
    const born = new Float32Array(MAX_GRAINS).fill(-1e9);
    g.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: kickVert, fragmentShader: kickFrag, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uPx: { value: 900 }, uColor: { value: new THREE.Color() } } });
    return { g, m };
  }, []);
  useEffect(() => () => {
    prints.geometry.dispose();
    (prints.material as THREE.Material).dispose();
    kicks.g.dispose();
    kicks.m.dispose();
  }, [prints, kicks]);

  const st = useRef({
    next: 0,
    grain: 0,
    lastKick: -1e9,
    feet: { L: { down: false, last: new THREE.Vector3(1e9, 0, 0) }, R: { down: false, last: new THREE.Vector3(1e9, 0, 0) } },
  });
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), qy: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(), f: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1) }), []);
  const { invalidate, size } = useThree();
  const t0 = useMemo(() => performance.now(), []);

  const stamp = (foot: THREE.Vector3, side: 1 | -1) => {
    const f = forwardOf(astro.yaw, tmp.f);
    tmp.p.copy(foot).addScaledVector(f, 0.07);
    const gr = ground(tmp.p.x, tmp.p.z);
    tmp.p.y = gr.y + 0.012;
    // Plane's +Z is the toe end of the sole texture: turn it to the walking direction.
    tmp.qy.setFromAxisAngle(tmp.up, Math.atan2(f.x, f.z) + side * 0.06);
    tmp.q.setFromUnitVectors(tmp.up, gr.normal).multiply(tmp.qy);
    tmp.m.compose(tmp.p, tmp.q, tmp.s);
    const s = st.current;
    prints.setMatrixAt(s.next % MAX_PRINTS, tmp.m);
    s.next++;
    prints.count = Math.min(MAX_PRINTS, s.next);
    prints.instanceMatrix.needsUpdate = true;
  };

  const kick = (foot: THREE.Vector3, now: number) => {
    const s = st.current;
    const f = forwardOf(astro.yaw, tmp.f);
    const o = kicks.g.getAttribute('aOrigin') as THREE.BufferAttribute;
    const v = kicks.g.getAttribute('aVel') as THREE.BufferAttribute;
    const b = kicks.g.getAttribute('aBorn') as THREE.BufferAttribute;
    const gy = ground(foot.x, foot.z).y;
    const n = Math.round(10 + astro.speed * 8);
    const t = (now - t0) / 1000;
    for (let k = 0; k < n; k++) {
      const i = s.grain++ % MAX_GRAINS;
      const sp = 0.4 + Math.random() * 1.1 * (0.6 + astro.speed / 3);
      const lat = (Math.random() - 0.5) * 0.7;
      o.setXYZ(i, foot.x + f.x * 0.12, gy + 0.03, foot.z + f.z * 0.12);
      // Thrown forward and up off the toe, fanning out sideways.
      v.setXYZ(i, f.x * sp - f.z * lat, 0.5 + Math.random() * 1.1, f.z * sp + f.x * lat);
      b.setX(i, t + Math.random() * 0.05);
    }
    o.needsUpdate = v.needsUpdate = b.needsUpdate = true;
    s.lastKick = now;
  };

  useFrame(() => {
    const now = performance.now();
    const s = st.current;
    kicks.m.uniforms.uTime.value = (now - t0) / 1000;
    kicks.m.uniforms.uPx.value = size.height * 1.4;
    const lit = 0.08 + 0.9 * sunLight();
    kicks.m.uniforms.uColor.value.setRGB(0.95 * lit, 0.92 * lit, 0.88 * lit);
    if (now - s.lastKick < 1500) invalidate();
    if (!astro.visible || astro.speed < 0.25) return;
    for (const [key, side] of [['L', 1], ['R', -1]] as const) {
      const foot = astro.feet[key];
      const fs = s.feet[key];
      const h = foot.y - ground(foot.x, foot.z).y;
      if (!fs.down && h < 0.17) {
        // Heel strike: press a print if this boot has moved since its last one.
        fs.down = true;
        if (Math.hypot(foot.x - fs.last.x, foot.z - fs.last.z) > 0.3) {
          stamp(foot, side);
          fs.last.copy(foot);
        }
      } else if (fs.down && h > 0.21) {
        // Toe-off: the boot flicks a little regolith forward.
        fs.down = false;
        kick(foot, now);
      }
    }
  });

  return (
    <>
      <primitive object={prints} />
      <points geometry={kicks.g} material={kicks.m} frustumCulled={false} renderOrder={6} />
    </>
  );
}

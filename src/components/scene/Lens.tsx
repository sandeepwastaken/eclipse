import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, ChromaticAberration, EffectComposer, FXAA, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { useProfile } from '../../lib/perf/quality';
import { BlendFunction, Effect, EffectAttribute, ToneMappingMode } from 'postprocessing';
import { forwardRef, useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * Camera motion blur. A camera that rotates moves every pixel by (almost) the same
 * screen offset, so rotation is a directional blur; moving toward the subject spreads
 * pixels radially from the centre, so dolly is a zoom blur. Both are measured from the
 * real camera motion each frame and applied with a 180° shutter (half the frame's motion).
 */
const blurFrag = /* glsl */ `
  uniform vec2 uVel;
  uniform float uZoom;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float amt = length(uVel) + abs(uZoom);
    if (amt < 0.0004) { outputColor = inputColor; return; }
    vec4 acc = vec4(0.0);
    float w = 0.0;
    for (int i = 0; i < 8; i++) {
      float t = float(i) / 7.0 - 0.5;
      vec2 off = uVel * t + (uv - 0.5) * uZoom * t;
      float k = 1.0 - abs(t);
      acc += texture2D(inputBuffer, uv + off) * k;
      w += k;
    }
    outputColor = acc / w;
  }
`;

class CameraBlurEffect extends Effect {
  constructor() {
    super('CameraBlur', blurFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uVel', new THREE.Uniform(new THREE.Vector2())],
        ['uZoom', new THREE.Uniform(0)],
      ]),
    });
  }
}

const CameraBlur = forwardRef<CameraBlurEffect>(function CameraBlur(_, ref) {
  const effect = useMemo(() => new CameraBlurEffect(), []);
  const prevQ = useRef(new THREE.Quaternion());
  const prevP = useRef(new THREE.Vector3());
  const first = useRef(true);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), inv: new THREE.Quaternion(), dp: new THREE.Vector3(), vel: new THREE.Vector2(), zoom: 0 }), []);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ camera, controls }) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (first.current) {
      first.current = false;
      prevQ.current.copy(cam.quaternion);
      prevP.current.copy(cam.position);
      return;
    }
    const shutter = 0.5;
    // Where the previous view direction lands in the current view (rotation only).
    tmp.inv.copy(cam.quaternion).invert();
    tmp.v.set(0, 0, -1).applyQuaternion(prevQ.current).applyQuaternion(tmp.inv);
    const ty = Math.tan((cam.fov * Math.PI) / 360);
    let vx = 0, vy = 0;
    if (tmp.v.z < -0.1) {
      vx = (tmp.v.x / -tmp.v.z / (ty * cam.aspect)) * 0.5;
      vy = (tmp.v.y / -tmp.v.z / ty) * 0.5;
    }
    // Translation relative to the distance of what the camera is looking at.
    const dist = Math.max(1e-6, (controls as unknown as { distance?: number } | null)?.distance ?? cam.position.length());
    tmp.dp.copy(cam.position).sub(prevP.current).applyQuaternion(tmp.inv);
    vx -= (tmp.dp.x / dist / (ty * cam.aspect)) * 0.5;
    vy -= (tmp.dp.y / dist / ty) * 0.5;
    const zoom = THREE.MathUtils.clamp((-tmp.dp.z / dist) * 1.2, -0.06, 0.06);
    tmp.vel.set(vx, vy).multiplyScalar(shutter);
    if (tmp.vel.length() > 0.035) tmp.vel.setLength(0.035);
    // Ease toward the measured motion so single-frame hitches don't flash a blur.
    const u = effect.uniforms;
    (u.get('uVel')!.value as THREE.Vector2).lerp(tmp.vel, 0.6);
    u.get('uZoom')!.value = THREE.MathUtils.lerp(u.get('uZoom')!.value as number, zoom * shutter, 0.6);
    const amt = (u.get('uVel')!.value as THREE.Vector2).length() + Math.abs(u.get('uZoom')!.value as number);
    if (amt > 0.0004) invalidate(); // settle the blur to zero after the camera stops
    prevQ.current.copy(cam.quaternion);
    prevP.current.copy(cam.position);
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

/**
 * A restrained photographic finish: lens bloom from the HDR Sun, edge-weighted
 * chromatic aberration, ACES tone mapping, a natural vignette and fine sensor grain.
 */
export function Lens() {
  const ca = useMemo(() => new THREE.Vector2(0.00045, 0.0003), []);
  const p = useProfile();
  if (p.post === 'lite') {
    // Balanced: one merged pass (bloom, tone map, vignette) plus FXAA instead of MSAA.
    return (
      <EffectComposer key="lite" multisampling={0} enableNormalPass={false}>
        <Bloom mipmapBlur luminanceThreshold={1.8} luminanceSmoothing={0.2} intensity={0.3} radius={0.55} levels={5} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.32} darkness={0.42} />
        <FXAA />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer key={`full-${p.msaa}`} multisampling={p.msaa} enableNormalPass={false}>
      <CameraBlur />
      <Bloom mipmapBlur luminanceThreshold={1.8} luminanceSmoothing={0.2} intensity={0.32} radius={0.6} />
      <ChromaticAberration offset={ca} radialModulation modulationOffset={0.5} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.32} darkness={0.42} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} />
    </EffectComposer>
  );
}

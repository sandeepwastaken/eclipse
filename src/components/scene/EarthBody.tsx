import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadEarthMaps, type EarthMaps } from './textures';

const vertex = /* glsl */ `
  #include <common>
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vLocal = normalize(position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normalize(position));
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;
// Single-scattering atmosphere over a Lambertian ground, the standard plane-parallel
// approximation (optical depths at 611/549/464 nm). From space the dark ocean is seen
// mostly through Rayleigh airlight, which is why it reads deep blue; the long grazing
// paths at the limb saturate to a bright blue rim.
const ATMO = /* glsl */ `
  const vec3 TAU_R = vec3(0.060, 0.098, 0.190);   // Rayleigh vertical optical depth
  const float TAU_M = 0.06;                        // clean-marine aerosol
  float phaseR(float c) { return 0.75 * (1.0 + c * c); }
  float phaseM(float c) { float g = 0.72; float d = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (d * sqrt(d)); }
`;
const fragment = /* glsl */ `
  #include <common>
  uniform sampler2D uAlbedo;
  uniform sampler2D uClouds;
  uniform sampler2D uLights;
  uniform vec3 uSunDirW;
  uniform float uExposure;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  #include <logdepthbuf_pars_fragment>
  ${ATMO}
  void main() {
    #include <logdepthbuf_fragment>
    // vLocal is in Earth body-fixed axes (IAU_EARTH): X = 0°E, Y = 90°E, Z = north
    float lat = asin(clamp(vLocal.z, -1.0, 1.0));
    float lon = atan(vLocal.y, vLocal.x);
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 + lat / PI);
    vec3 albedo = texture(uAlbedo, uv).rgb;
    float cloud = texture(uClouds, uv).r;
    vec2 lm = texture(uLights, uv).rg;      // r: city lights, g: open-water mask
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = uSunDirW;
    float ndl = dot(N, L);
    float mu0 = max(ndl, 0.0);
    float mu = max(dot(N, V), 0.0);
    float cosT = dot(L, -V);
    cloud = smoothstep(0.1, 0.9, cloud);
    // Ground + ocean glint
    vec3 H = normalize(L + V);
    float glint = pow(max(dot(N, H), 0.0), 420.0) * lm.g * (1.0 - cloud) * 0.7;
    // Air mass, softened near the terminator so twilight fades rather than cuts off
    float m0 = 1.0 / max(mu0 + 0.03, 0.035);
    float m = 1.0 / max(mu + 0.02, 0.03);
    vec3 tau = TAU_R + TAU_M;
    vec3 Tsun = exp(-tau * m0);
    vec3 Tview = exp(-tau * m);
    vec3 ground = albedo * mu0 * Tsun * Tview + vec3(1.0, 0.97, 0.92) * glint * mu0 * Tsun * Tview;
    // Clouds sit high in the column: little attenuation above them.
    vec3 Tc = exp(-tau * 0.3 * (m0 + m));
    vec3 cloudCol = vec3(0.92, 0.93, 0.95) * (0.18 + 0.82 * mu0) * mu0 * Tc;
    ground = mix(ground, vec3(dot(ground, vec3(0.3, 0.55, 0.15))), 0.12); // imagery is slightly oversaturated
    vec3 col = mix(ground, cloudCol, cloud);
    // Single-scattered airlight
    vec3 sc = TAU_R * phaseR(cosT) + TAU_M * phaseM(cosT) * 0.9;
    vec3 air = sc / tau * (1.0 - exp(-tau * (m + m0))) * mu0 / (mu0 + mu + 1e-3) * 0.25 * smoothstep(-0.02, 0.06, ndl + 0.04);
    col += air * (1.0 - 0.6 * cloud);
    // City lights on the night side, dimmed by cloud.
    float night = 1.0 - smoothstep(-0.1, 0.03, ndl);
    col += vec3(1.0, 0.72, 0.42) * pow(lm.r, 1.6) * night * (1.0 - 0.75 * cloud) * 0.02;
    gl_FragColor = vec4(col * uExposure * 2.4, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Thin glowing shell beyond the limb: airlight along rays that miss the ground.
const haloVertex = vertex;
const haloFragment = /* glsl */ `
  #include <common>
  uniform vec3 uSunDirW;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform float uExposure;
  varying vec3 vWorld;
  #include <logdepthbuf_pars_fragment>
  ${ATMO}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 rd = normalize(vWorld - cameraPosition);
    vec3 oc = uCenter - cameraPosition;
    float b = dot(oc, rd);
    vec3 closest = cameraPosition + rd * b;
    float h = length(closest - uCenter) / uRadius - 1.0;    // altitude of closest approach, Earth radii
    if (h < 0.0) discard;
    float dens = exp(-h / 0.0035);                              // ~22 km effective scale height
    vec3 up = normalize(closest - uCenter);
    float lit = smoothstep(-0.25, 0.25, dot(up, uSunDirW));
    float cosT = dot(uSunDirW, rd);
    vec3 sc = TAU_R * phaseR(cosT) * 2.2 + TAU_M * phaseM(cosT) * 0.5;
    vec3 col = sc * dens * lit * 1.6;
    gl_FragColor = vec4(col * uExposure * 2.4, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface EarthPlacement {
  /** World matrix mapping Earth body-fixed unit coordinates into the scene (rotation + translation + scale). */
  matrix: THREE.Matrix4;
  sunDirWorld: THREE.Vector3;
}

/** Earth rendered with NASA Blue Marble (ocean reflectance corrected), clouds and Black Marble lights, oriented with SPICE IAU_EARTH, lit by the real Sun direction. */
export function EarthBody({ place, exposure = 1 }: { place: () => EarthPlacement | null; exposure?: number }) {
  const [map, setMap] = useState<EarthMaps | null>(null);
  useEffect(() => {
    loadEarthMaps().then(setMap, () => undefined);
  }, []);
  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { uAlbedo: { value: null }, uClouds: { value: null }, uLights: { value: null }, uSunDirW: { value: new THREE.Vector3(1, 0, 0) }, uExposure: { value: exposure } } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    material.uniforms.uAlbedo.value = map?.albedo ?? null;
    material.uniforms.uClouds.value = map?.clouds ?? null;
    material.uniforms.uLights.value = map?.lights ?? null;
  }, [map, material]);
  const halo = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: haloVertex, fragmentShader: haloFragment, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, uniforms: { uSunDirW: { value: new THREE.Vector3(1, 0, 0) }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1 }, uExposure: { value: exposure } } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const ref = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => ({ s: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  useFrame(() => {
    const p = place();
    const m = ref.current;
    if (!p || !m) return;
    m.matrix.copy(p.matrix);
    m.matrixWorldNeedsUpdate = true;
    material.uniforms.uSunDirW.value.copy(p.sunDirWorld);
    const h = haloRef.current;
    if (h) {
      h.matrix.copy(p.matrix).scale(new THREE.Vector3(1.035, 1.035, 1.035));
      h.matrixWorldNeedsUpdate = true;
      p.matrix.decompose(halo.uniforms.uCenter.value, tmp.q, tmp.s);
      halo.uniforms.uRadius.value = tmp.s.x;
      halo.uniforms.uSunDirW.value.copy(p.sunDirWorld);
    }
  });
  if (!map) return null;
  return (
    <>
      <mesh ref={ref} material={material} matrixAutoUpdate={false} frustumCulled={false}>
        <sphereGeometry args={[1, 128, 64]} />
      </mesh>
      <mesh ref={haloRef} material={halo} matrixAutoUpdate={false} frustumCulled={false}>
        <sphereGeometry args={[1, 64, 32]} />
      </mesh>
    </>
  );
}

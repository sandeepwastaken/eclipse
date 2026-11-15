import * as THREE from 'three';

/**
 * Lunar regolith surface shader for the local LOLA terrain patch.
 * Direct sunlight uses the lunar-Lambert function; cast shadows are ray-marched
 * toward the real Sun through the same LOLA heights that built the mesh, with a
 * penumbra equal to the Sun's angular radius. Terrain beyond the patch is applied
 * as `uFarVis`, the visible fraction of the solar disk above the far-field horizon.
 * Sub-DEM regolith texture (< 20 m) is procedural and purely illustrative.
 */
const vertex = /* glsl */ `
  #include <common>
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vEN;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vPos = position;
    vNormal = normal;
    vEN = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    #include <logdepthbuf_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <common>
  const float R_M = 1737400.0;
  uniform sampler2D uInner;
  uniform sampler2D uOuter;
  uniform float uInnerHalf;
  uniform float uOuterHalf;
  uniform float uInnerN;
  uniform float uOuterN;
  uniform float uH0;
  uniform vec3 uSunDir;
  uniform vec3 uEarthDir;
  uniform float uSunRad;
  uniform float uFarVis;
  uniform float uEarthPhase;
  uniform vec3 uAlbedo;
  uniform float uExposure;
  uniform float uDetail;
  uniform vec3 uLampPos;
  uniform vec3 uLampDir;
  uniform float uLamp;      // intensity (0 = off)
  uniform float uLampCos;   // cos of the beam half-angle
  uniform int uSteps;       // shadow ray-march steps (quality tier)
  uniform float uGrow;      // step growth, so fewer steps reach as far
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vEN;
  #include <logdepthbuf_pars_fragment>

  float gridH(sampler2D tex, float hs, float n, vec2 en) {
    vec2 k = vec2((en.x + hs) / (2.0 * hs), (hs - en.y) / (2.0 * hs)) * (n - 1.0);
    return textureLod(tex, (k + 0.5) / n, 0.0).r;
  }
  float relH(vec2 en) {
    float m = max(abs(en.x), abs(en.y));
    float o = gridH(uOuter, uOuterHalf, uOuterN, en);
    if (m >= uInnerHalf) return o;
    float i = gridH(uInner, uInnerHalf, uInnerN, en);
    return mix(i, o, smoothstep(uInnerHalf * 0.85, uInnerHalf * 0.98, m));
  }
  float surfY(vec2 en) {
    float d = length(en);
    float s = sin(0.5 * d / R_M);
    float h = relH(en);
    return h * cos(d / R_M) - (R_M + uH0) * 2.0 * s * s;
  }

  // --- illustrative sub-DEM regolith: crater populations below the 20 m LOLA posting
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash1(i), hash1(i + vec2(1, 0)), u.x), mix(hash1(i + vec2(0, 1)), hash1(i + vec2(1, 1)), u.x), u.y);
  }
  // fBm with a rotation per octave so no grid direction survives.
  float fbm(vec2 p) {
    const mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    float a = 0.5, s = 0.0;
    for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = rot * p * 2.07 + 13.7; a *= 0.5; }
    return s;
  }
  // Slope (dh/de, dh/dn) and albedo change from one octave of randomly placed craters.
  // Bowl d/D ~ 0.2 for fresh craters, shallower and rimless as they degrade.
  vec3 craters(vec2 p, float cell, float density) {
    vec2 q = p / cell;
    vec2 i = floor(q), f = fract(q);
    vec2 g = vec2(0.0);
    float alb = 0.0;
    // Domain warp: real craters are never perfect circles.
    vec2 warp = vec2(vnoise(q * 3.1), vnoise(q * 3.1 + 7.7)) - 0.5;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 c = vec2(float(x), float(y));
        vec2 h = hash2(i + c);
        if (hash1(i + c + 3.1) > density) continue;
        float R = 0.06 + 0.42 * h.y * h.y * h.y;
        vec2 o = f - (c + h) + warp * 0.35 * R;   // from crater centre, in cells
        float r = length(o);
        float d = r / R;
        if (d > 1.8 || r < 1e-4) continue;
        float fresh = pow(hash1(i + c + 9.7), 2.2); // most small craters are old and softened
        float depth = mix(0.06, 0.34, fresh);
        // Smooth bowl h = -D(1-d²)² plus a soft raised rim that fades with age.
        float bowl = d < 1.0 ? 4.0 * depth * d * (1.0 - d * d) : 0.0;
        float rimH = depth * 0.3 * fresh * exp(-pow((d - 1.0) / 0.24, 2.0));
        float dh = bowl - 2.0 * (d - 1.0) / 0.0576 * rimH;
        dh *= smoothstep(1.8, 1.3, d);
        g += dh * (o / r);
        alb += fresh * 0.1 * exp(-d * d * 1.6);
      }
    }
    return vec3(g, alb);
  }

  void main() {
    #include <logdepthbuf_fragment>
    // Round patch: from altitude the edge reads as the curve of a horizon, never a square.
    if (length(vEN) > uOuterHalf * 0.985) discard;
    vec3 N = normalize(vNormal);
    float camDist = length(cameraPosition - vPos);
    float detail = uDetail;
    vec3 albedo = uAlbedo;
    if (detail > 0.001) {
      vec2 p = vEN;
      // Ground footprint of this pixel (m). At grazing angles it is far larger than distance alone
      // suggests; detail finer than about a pixel is faded out so the distance doesn't shimmer.
      float fp = max(length(dFdx(vEN)), length(dFdy(vEN)));
      // Large-scale albedo: highland/ejecta patches and faint rays (hundreds of metres).
      float big = fbm(p * 0.0021 + 3.0);
      float mid = fbm(p * 0.017 + 11.0);
      float fine = fbm(p * 0.45 + 5.0);
      float fineFade = (1.0 - smoothstep(20.0, 160.0, camDist)) * (1.0 - smoothstep(0.5, 1.4, fp));
      float midFade = 1.0 - smoothstep(12.0, 35.0, fp);
      albedo *= 0.8 + 0.34 * big + 0.12 * (mid - 0.5) * midFade + 0.08 * (fine - 0.5) * fineFade;
      vec2 slope = vec2(0.0);
      float cell[5] = float[5](0.9, 3.1, 11.0, 38.0, 150.0);
      float dens[5] = float[5](0.34, 0.26, 0.17, 0.11, 0.09);
      for (int k = 0; k < 5; k++) {
        if ((k == 0 && detail < 0.75) || (k == 1 && detail < 0.4)) continue;
        float fade = (1.0 - smoothstep(cell[k] * 10.0, cell[k] * 60.0, camDist)) * (1.0 - smoothstep(cell[k] * 0.16, cell[k] * 0.45, fp));
        if (fade <= 0.0) continue;
        vec3 c = craters(p + float(k) * 71.3, cell[k], dens[k]);
        slope += c.xy * fade;
        albedo *= 1.0 + c.z * fade;
      }
      // Small-scale roughness so grazing light picks out texture.
      float e = 0.25;
      float rough = step(0.75, detail) * (1.0 - smoothstep(6.0, 60.0, camDist)) * (1.0 - smoothstep(0.08, 0.25, fp)) * 0.06;
      if (rough > 0.0) {
        slope.x += (fbm((p + vec2(e, 0.0)) * 3.3) - fbm((p - vec2(e, 0.0)) * 3.3)) * rough / e;
        slope.y += (fbm((p + vec2(0.0, e)) * 3.3) - fbm((p - vec2(0.0, e)) * 3.3)) * rough / e;
      }
      N = normalize(N + vec3(-slope.x, 0.0, slope.y) * 0.9);
    }
    float mu0 = dot(N, uSunDir);
    vec3 V = normalize(cameraPosition - vPos);
    float mu = max(dot(N, V), 0.0);
    float lit = max(mu0, 0.0);
    // Lunar photometry: Lommel-Seeliger/Lambert mix with a strongly backscattering phase function.
    float alpha = acos(clamp(dot(uSunDir, V), -1.0, 1.0));
    float phase = 1.15 * exp(-1.05 * alpha) + 0.06;
    float brdf = (1.25 * lit / max(lit + mu, 1e-3) + 0.35 * lit) * phase;

    float vis = uFarVis * smoothstep(-0.02, 0.02, dot(normalize(vNormal), uSunDir));
    if (vis > 0.0 && lit > 0.0) {
      vec3 P = vPos + normalize(vNormal) * (0.6 + camDist * 0.003);
      float t = length(vPos.xz) < uInnerHalf ? 30.0 : 220.0;
      float occ = -1e6;
      for (int k = 0; k < 64; k++) {
        if (k >= uSteps) break;
        vec3 Q = P + uSunDir * t;
        vec2 en = vec2(Q.x, -Q.z);
        if (max(abs(en.x), abs(en.y)) > uOuterHalf) break;
        float y = surfY(en);
        occ = max(occ, (y - Q.y - 0.0015 * t) / t);
        t *= uGrow;
      }
      float pen = max(uSunRad, 0.0025);
      vis *= 1.0 - smoothstep(-pen, pen, atan(occ));
    }

    vec3 col = albedo * brdf * vis * 1.0;
    float es = max(dot(N, uEarthDir), 0.0) * uEarthPhase;
    col += albedo * es * vec3(0.55, 0.66, 0.85) * 0.03;
    col += albedo * 0.0025; // faint scattered light floor so deep shadow is not pure black
    // Headlamp from the camera: inverse-square falloff, soft-edged beam, lambertian.
    if (uLamp > 0.0) {
      vec3 Ld = uLampPos - vPos;
      float dl = length(Ld);
      Ld /= max(dl, 1e-3);
      float cone = smoothstep(uLampCos, mix(uLampCos, 1.0, 0.55), dot(-Ld, uLampDir));
      col += albedo * uLamp * cone * max(dot(N, Ld), 0.0) / max(dl * dl, 1.0);
    }
    gl_FragColor = vec4(col * uExposure, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createTerrainMaterial(opts: { inner: THREE.Texture; outer: THREE.Texture; innerHalf: number; outerHalf: number; innerN: number; outerN: number; h0: number; albedo: THREE.Color }) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uInner: { value: opts.inner },
      uOuter: { value: opts.outer },
      uInnerHalf: { value: opts.innerHalf },
      uOuterHalf: { value: opts.outerHalf },
      uInnerN: { value: opts.innerN },
      uOuterN: { value: opts.outerN },
      uH0: { value: opts.h0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uEarthDir: { value: new THREE.Vector3(0, 0, -1) },
      uSunRad: { value: 0.00465 },
      uFarVis: { value: 1 },
      uEarthPhase: { value: 0.5 },
      uAlbedo: { value: opts.albedo },
      uExposure: { value: 2.6 },
      uDetail: { value: 1 },
      uLampPos: { value: new THREE.Vector3() },
      uLampDir: { value: new THREE.Vector3(0, 0, -1) },
      uLamp: { value: 0 },
      uLampCos: { value: Math.cos(0.5) },
      uSteps: { value: 34 },
      uGrow: { value: 1.31 },
    },
  });
}

/**
 * Distant-terrain silhouette ring built from the LOLA far-field horizon (terrain
 * beyond the patch), so mountains up to ~400 km away appear exactly where the
 * horizon computation places them.
 */
export function buildSkirt(far: Float32Array, stepDeg: number, distance: number, eyeY: number): THREE.BufferGeometry {
  const n = far.length;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const nor = new Float32Array((n + 1) * 2 * 3);
  for (let k = 0; k <= n; k++) {
    const az = ((k % n) * stepDeg * Math.PI) / 180;
    const el = (far[k % n] * Math.PI) / 180;
    const dx = Math.sin(az), dz = -Math.cos(az);
    const top = eyeY + Math.tan(el) * distance;
    const bottom = eyeY - distance * 0.06;
    const i = k * 6;
    pos.set([dx * distance, bottom, dz * distance, dx * distance, top, dz * distance], i);
    nor.set([-dx, 0.35, -dz, -dx, 0.35, -dz], i);
  }
  const idx: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Shading for the distant-mountain ring: the same lunar photometry and exposure as the near
 * terrain, so far ridges are lit or dark with the real Sun instead of reading as a flat band.
 * Fades out as the camera climbs, since the ring only stands in for the skyline seen from the ground.
 */
export function createSkirtMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uAlbedo: { value: new THREE.Color(0.2, 0.192, 0.182) },
      uExposure: { value: 2.6 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      varying vec3 vN;
      varying vec3 vW;
      varying float vTop;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vN = normalize(normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vTop = position.y;
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform vec3 uSunDir;
      uniform vec3 uAlbedo;
      uniform float uExposure;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vW;
      varying float vTop;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float lit = max(dot(N, uSunDir), 0.0);
        float mu = max(dot(N, V), 0.0);
        float alpha = acos(clamp(dot(uSunDir, V), -1.0, 1.0));
        float phase = 1.15 * exp(-1.05 * alpha) + 0.06;
        float brdf = (1.25 * lit / max(lit + mu, 1e-3) + 0.35 * lit) * phase;
        // Sun below the horizon: the far ridges go dark too.
        brdf *= smoothstep(-0.01, 0.01, uSunDir.y);
        vec3 col = uAlbedo * brdf + uAlbedo * 0.0025;
        gl_FragColor = vec4(col * uExposure, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

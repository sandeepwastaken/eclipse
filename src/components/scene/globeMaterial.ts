import * as THREE from 'three';
import type { GlobeTextures } from './textures';

/**
 * Physically motivated Moon surface shader.
 *  - Geometry: unit sphere displaced by LOLA heights (true scale × uExag).
 *  - Albedo: LROC WAC colour mosaic (NASA SVS CGI Moon Kit); LOLA-derived polar grid poleward of 76°S.
 *  - Shading: lunar-Lambert photometric function with LOLA normals, lit by the DE440 Sun vector.
 *  - Cast shadows: per-pixel ray march through LOLA heights toward the Sun, with a penumbra
 *    of the Sun's true angular radius. Earthshine on the night side scales with Earth's phase.
 */
const common = /* glsl */ `
  #include <common>
  const float R_M = 1737400.0;
  uniform sampler2D uHeight;
  uniform float uHMin;
  uniform float uHRange;
  uniform sampler2D uPolarHeight;
  uniform float uPolarScale;
  uniform float uPolarOffset;
  uniform float uPolarN;
  uniform float uExag;

  vec3 toMoon(vec3 p) { return vec3(p.x, -p.z, p.y); }

  vec2 polarXY(float lat, float lon) {
    float r = 2.0 * R_M * tan((PI * 0.5 - abs(lat)) * 0.5);
    return vec2(r * sin(lon), r * cos(lon));
  }
  vec2 polarUVfromXY(vec2 xy) {
    float i = xy.x / uPolarScale + uPolarOffset;
    float j = -xy.y / uPolarScale + uPolarOffset;
    return vec2((i + 0.5) / uPolarN, (j + 0.5) / uPolarN);
  }
  float polarHeightXY(vec2 xy) { return textureLod(uPolarHeight, polarUVfromXY(xy), 0.0).r; }
  vec2 equiUV(float lat, float lon) { return vec2(lon / (2.0 * PI) + 0.5, 0.5 + lat / PI); }
  float globalHeight(float lat, float lon) { return uHMin + textureLod(uHeight, equiUV(lat, lon), 0.0).r * uHRange; }
  float polarWeight(float lat) { return smoothstep(-75.7, -76.7, degrees(lat)); }
  float heightAt(float lat, float lon) {
    float w = polarWeight(lat);
    float g = globalHeight(lat, lon);
    if (w <= 0.0) return g;
    return mix(g, polarHeightXY(polarXY(lat, lon)), w);
  }
`;

const vertex = /* glsl */ `
  ${common}
  varying vec3 vMoon;
  varying vec3 vWorld;
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec3 p = normalize(position);
    vMoon = toMoon(p);
    float lat = asin(clamp(vMoon.z, -1.0, 1.0));
    float lon = atan(vMoon.y, vMoon.x);
    float h = heightAt(lat, lon);
    vec3 displaced = p * (1.0 + uExag * h / R_M);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const fragment = /* glsl */ `
  ${common}
  uniform sampler2D uColor;
  uniform sampler2D uNormal;
  uniform sampler2D uPolarColor;
  uniform vec3 uSunDir;      // Moon-fixed unit vector to the Sun
  uniform vec3 uEarthDir;    // Moon-fixed unit vector to Earth
  uniform float uEarthPhase; // illuminated fraction of Earth
  uniform float uSunRad;     // Sun angular radius, rad
  uniform float uNormalStrength;
  uniform float uExposure;
  uniform vec3 uCamMoon;     // camera position, Moon-fixed, lunar radii
  uniform float uShadows;
  uniform vec3 uCapDir;      // Moon-fixed centre of the high-resolution detail cap
  uniform float uCapCos;     // cos of its angular radius (2: no cap, as no cosine exceeds 1)
  uniform float uIsCap;
  uniform int uStepsP;       // shadow ray-march steps (quality tier)
  uniform int uStepsG;
  uniform float uGrowP;      // step growth chosen so fewer steps still reach as far
  uniform float uGrowG;
  uniform float uDetail;     // 0–1 procedural crater detail
  varying vec3 vMoon;
  varying vec3 vWorld;
  #include <logdepthbuf_pars_fragment>

  // Sub-kilometre crater populations (illustrative, below the DEM resolution), shared idea with the surface view.
  float gh1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
  vec2 gh2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  vec3 gCraters(vec2 p, float cell, float density) {
    vec2 q = p / cell;
    vec2 i = floor(q), f = fract(q);
    vec2 g = vec2(0.0);
    float alb = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = vec2(float(x), float(y));
      if (gh1(i + c + 3.1) > density) continue;
      vec2 h = gh2(i + c);
      float R = 0.08 + 0.4 * h.y * h.y * h.y;
      vec2 o = f - (c + h);
      float r = length(o);
      float d = r / R;
      if (d > 1.8 || r < 1e-4) continue;
      float fresh = pow(gh1(i + c + 9.7), 2.2);
      float depth = mix(0.06, 0.34, fresh);
      float bowl = d < 1.0 ? 4.0 * depth * d * (1.0 - d * d) : 0.0;
      float rimH = depth * 0.3 * fresh * exp(-pow((d - 1.0) / 0.24, 2.0));
      float dh = (bowl - 2.0 * (d - 1.0) / 0.0576 * rimH) * smoothstep(1.8, 1.3, d);
      g += dh * (o / r);
      alb += fresh * 0.1 * exp(-d * d * 1.6);
    }
    return vec3(g, alb);
  }

  vec3 sampleEqui(sampler2D tex, float lat, float lon) {
    float u1 = fract(lon / (2.0 * PI) + 0.5);
    float u2 = fract(lon / (2.0 * PI)) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2 + 1.0;
    return texture(tex, vec2(u, 0.5 + lat / PI)).rgb;
  }

  float shadowPolar(vec2 xy0, float h0, vec2 dirXY, float tanE) {
    float occ = -1e6;
    float s = 260.0;
    for (int k = 0; k < 64; k++) {
      if (k >= uStepsP) break;
      float h = polarHeightXY(xy0 + dirXY * s) * uExag;
      float rayH = h0 + s * tanE - s * s / (2.0 * R_M);
      occ = max(occ, (h - rayH) / s);
      s *= uGrowP;
    }
    return occ;
  }

  float shadowGlobal(float lat, float lon, float h0, vec2 dirEN, float tanE) {
    float occ = -1e6;
    float s = 2600.0;
    float cl = max(cos(lat), 0.05);
    for (int k = 0; k < 64; k++) {
      if (k >= uStepsG) break;
      float la = lat + dirEN.y * s / R_M;
      float lo = lon + dirEN.x * s / (R_M * cl);
      float h = globalHeight(la, lo) * uExag;
      float rayH = h0 + s * tanE - s * s / (2.0 * R_M);
      occ = max(occ, (h - rayH) / s);
      s *= uGrowG;
    }
    return occ;
  }

  void main() {
    #include <logdepthbuf_fragment>
    // The coarse globe steps aside where the detail cap covers the surface.
    if (uIsCap < 0.5 && dot(normalize(vMoon), uCapDir) > uCapCos) discard;
    vec3 up = normalize(vMoon);
    float lat = asin(clamp(up.z, -1.0, 1.0));
    float lon = atan(up.y, up.x);
    vec3 east = normalize(vec3(-sin(lon), cos(lon), 0.0));
    vec3 north = cross(up, east);
    float wP = polarWeight(lat);

    // --- albedo
    vec3 albedo = sampleEqui(uColor, lat, lon);
    vec2 pxy = vec2(0.0);
    if (wP > 0.0) {
      pxy = polarXY(lat, lon);
      albedo = mix(albedo, texture(uPolarColor, polarUVfromXY(pxy)).rgb, wP);
    }

    // --- normal
    vec3 nt = sampleEqui(uNormal, lat, lon) * 2.0 - 1.0;
    nt.xy *= uNormalStrength * uExag;
    vec3 N = normalize(nt.x * east + nt.y * north + nt.z * up);
    if (wP > 0.0) {
      float d = uPolarScale;
      float hx1 = polarHeightXY(pxy + vec2(d, 0.0)), hx0 = polarHeightXY(pxy - vec2(d, 0.0));
      float hy1 = polarHeightXY(pxy + vec2(0.0, d)), hy0 = polarHeightXY(pxy - vec2(0.0, d));
      vec2 g = vec2(hx1 - hx0, hy1 - hy0) / (2.0 * d) * uExag * uNormalStrength;
      vec2 eP = vec2(cos(lon), -sin(lon));
      vec2 nP = vec2(sin(lon), cos(lon));
      float dE = dot(g, eP), dN = dot(g, nP);
      vec3 NP = normalize(up - dE * east - dN * north);
      N = normalize(mix(N, NP, wP));
    }

    // --- close-range detail: crater fields finer than the LOLA grids, fading in with proximity
    float camDistM = length(uCamMoon - vMoon) * R_M;
    if (camDistM < 120000.0 && uDetail > 0.0) {
      vec2 pm = wP > 0.5 ? pxy : vec2(lon * R_M * cos(lat), lat * R_M);
      vec2 slope = vec2(0.0);
      float cells[3] = float[3](140.0, 520.0, 1900.0);
      float dens[3] = float[3](0.3, 0.2, 0.12);
      for (int k = 0; k < 3; k++) {
        if (k == 0 && uDetail < 0.75) continue;
        float fade = 1.0 - smoothstep(cells[k] * 8.0, cells[k] * 45.0, camDistM);
        if (fade <= 0.0) continue;
        vec3 c = gCraters(pm + float(k) * 913.0, cells[k], dens[k]);
        slope += c.xy * fade;
        albedo *= 1.0 + c.z * fade;
      }
      // Unit 3D directions of the detail coordinates' x and y axes (polar stereographic or east/north).
      vec3 tE = wP > 0.5 ? (east * cos(lon) + north * sin(lon)) : east;
      vec3 tN = wP > 0.5 ? (north * cos(lon) - east * sin(lon)) : north;
      N = normalize(N - (slope.x * tE + slope.y * tN) * 0.8);
    }

    // --- direct sunlight
    float sinE = dot(up, uSunDir);
    float mu0 = max(dot(N, uSunDir), 0.0);
    vec3 V = normalize(uCamMoon - vMoon);
    float mu = max(dot(N, V), 0.0);
    float lommel = mu0 / max(mu0 + mu, 1e-3);
    float brdf = 1.25 * lommel + 0.35 * mu0;
    float vis = smoothstep(-0.012, 0.006, sinE);
    if (uShadows > 0.5 && sinE > -0.012 && sinE < 0.42 && mu0 > 0.0) {
      vec2 sunEN = vec2(dot(uSunDir, east), dot(uSunDir, north));
      float hl = length(sunEN);
      vec2 dirEN = sunEN / max(hl, 1e-5);
      float tanE = sinE / max(hl, 1e-4);
      float h0 = heightAt(lat, lon) * uExag;
      float occ;
      if (wP > 0.5) {
        vec2 dirXY = dirEN.x * vec2(cos(lon), -sin(lon)) + dirEN.y * vec2(sin(lon), cos(lon));
        occ = shadowPolar(pxy, h0, dirXY, tanE);
      } else {
        occ = shadowGlobal(lat, lon, h0, dirEN, tanE);
      }
      float pen = max(uSunRad, 0.0035);
      vis *= 1.0 - smoothstep(-pen, pen, atan(occ));
    }
    vec3 sun = albedo * brdf * vis;

    // --- earthshine (night side), scaled by Earth's illuminated fraction
    float es = max(dot(N, uEarthDir), 0.0) * uEarthPhase;
    vec3 earthshine = albedo * es * vec3(0.55, 0.66, 0.85) * 0.035 * (1.0 - smoothstep(-0.05, 0.1, sinE));

    vec3 col = (sun + earthshine) * uExposure;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createGlobeMaterial(tex: GlobeTextures): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uHeight: { value: tex.height },
      uHMin: { value: -9200 },
      uHRange: { value: 20000 },
      uPolarHeight: { value: tex.polarHeight },
      uPolarScale: { value: tex.polarScale },
      uPolarOffset: { value: tex.polarOffset },
      uPolarN: { value: tex.polarN },
      uExag: { value: 1 },
      uColor: { value: tex.color },
      uNormal: { value: tex.normal },
      uPolarColor: { value: tex.polarColor },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uEarthDir: { value: new THREE.Vector3(1, 0, 0) },
      uEarthPhase: { value: 0.5 },
      uSunRad: { value: 0.00465 },
      uNormalStrength: { value: 1.0 },
      uExposure: { value: 1.55 },
      uCamMoon: { value: new THREE.Vector3(3, 0, 0) },
      uShadows: { value: 1 },
      uCapDir: { value: new THREE.Vector3(0, 0, -1) },
      uCapCos: { value: 2 },
      uIsCap: { value: 0 },
      uStepsP: { value: 44 },
      uStepsG: { value: 36 },
      uGrowP: { value: 1.165 },
      uGrowG: { value: 1.125 },
      uDetail: { value: 1 },
    },
  });
}

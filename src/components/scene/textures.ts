import * as THREE from 'three';
import { loadPolarGrid } from '../../lib/terrain/sources';

const base = () => import.meta.env.BASE_URL;
const loader = new THREE.TextureLoader();

function load(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 8;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

export interface GlobeTextures {
  color: THREE.Texture;
  normal: THREE.Texture;
  height: THREE.Texture;
  polarColor: THREE.Texture;
  polarHeight: THREE.DataTexture;
  polarScale: number;
  polarOffset: number;
  polarN: number;
}

let basePromise: Promise<GlobeTextures> | null = null;

/** First paint: 2k colour, 4k LOLA normals, LOLA relief and the 480 m polar grid. */
export function loadGlobeTextures(): Promise<GlobeTextures> {
  basePromise ??= (async () => {
    const [color, normal, height, polarColor, polar] = await Promise.all([
      load(`${base()}assets/moon-color-2k.webp`, true),
      load(`${base()}assets/moon-normal-4k.webp`, false),
      load(`${base()}data/terrain/moon-height-2k.png`, false),
      load(`${base()}assets/south-polar-color.webp`, true),
      loadPolarGrid(),
    ]);
    polarColor.wrapS = THREE.ClampToEdgeWrapping;
    polarColor.flipY = false;
    polarColor.needsUpdate = true;
    const half = new Uint16Array(polar.grid.data.length);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(polar.grid.data[i]);
    const polarHeight = new THREE.DataTexture(half, polar.grid.width, polar.grid.height, THREE.RedFormat, THREE.HalfFloatType);
    polarHeight.minFilter = THREE.LinearFilter;
    polarHeight.magFilter = THREE.LinearFilter;
    polarHeight.wrapS = polarHeight.wrapT = THREE.ClampToEdgeWrapping;
    polarHeight.needsUpdate = true;
    return { color, normal, height, polarColor, polarHeight, polarScale: polar.scaleM, polarOffset: polar.offsetPx, polarN: polar.grid.width };
  })();
  return basePromise;
}

/** Level-of-detail upgrade: the 8k LROC mosaic replaces the 2k one when the GPU supports it. */
export function loadHighResColor(maxTextureSize: number): Promise<THREE.Texture | null> {
  if (maxTextureSize < 8192) return Promise.resolve(null);
  return load(`${base()}assets/moon-color-8k.webp`, true).catch(() => null);
}

export interface EarthMaps { albedo: THREE.Texture; clouds: THREE.Texture; lights: THREE.Texture }
let earthMaps: Promise<EarthMaps> | null = null;
/** Blue/Black Marble maps with ocean reflectance corrected to measured values (alpha = water mask). */
export function loadEarthMaps(): Promise<EarthMaps> {
  earthMaps ??= Promise.all([
    load(`${base()}assets/earth/albedo-2k.webp`, true),
    load(`${base()}assets/earth/clouds-4k.webp`, false),
    load(`${base()}assets/earth/lights-2k.webp`, false),
  ]).then(([albedo, clouds, lights]) => ({ albedo, clouds, lights }));
  return earthMaps;
}

let starsPromise: Promise<Float32Array> | null = null;
export function loadStars(): Promise<Float32Array> {
  starsPromise ??= fetch(`${base()}data/stars.bin`).then((r) => r.arrayBuffer()).then((b) => new Float32Array(b));
  return starsPromise;
}

/** Decoding of Eclipse's 16-bit-in-RGB height grids (see scripts/build_terrain.py). */

export interface HeightGrid {
  width: number;
  height: number;
  /** Row-major, row 0 = top (north / image top). Units: metres. */
  data: Float32Array;
}

async function loadPixels(url: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bitmap.width, bitmap.height) : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  const { width, height } = bitmap;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  bitmap.close();
  return { width, height, rgba: data };
}

/** value = (R << 8 | G); metres = (value - offset) * scale */
export async function loadPackedHeights(url: string, offset = 32768, scale = 0.5): Promise<HeightGrid> {
  const { width, height, rgba } = await loadPixels(url);
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = (((rgba[p] << 8) | rgba[p + 1]) - offset) * scale;
  return { width, height, data };
}

/** 8-bit grey heights mapped linearly to [min, max] metres. */
export async function loadByteHeights(url: string, min: number, max: number): Promise<HeightGrid> {
  const { width, height, rgba } = await loadPixels(url);
  const data = new Float32Array(width * height);
  const k = (max - min) / 255;
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = min + rgba[p] * k;
  return { width, height, data };
}

/** Bilinear sample at fractional pixel (x, y); NaN outside the grid. */
export function sampleGrid(g: HeightGrid, x: number, y: number, wrapX = false): number {
  if (!(y >= 0 && y <= g.height - 1)) return NaN;
  if (wrapX) x = ((x % g.width) + g.width) % g.width;
  else if (!(x >= 0 && x <= g.width - 1)) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = wrapX ? (x0 + 1) % g.width : Math.min(x0 + 1, g.width - 1);
  const y1 = Math.min(y0 + 1, g.height - 1);
  const fx = x - x0, fy = y - y0;
  const d = g.data, w = g.width;
  const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

/** Minimal allocation-light 3-vector helpers. Moon-fixed vectors: X → 0°E equator, Y → 90°E, Z → north. */
export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const sub = (a: V3, b: V3, out: V3 = [0, 0, 0]): V3 => {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
};
export const scale = (a: V3, s: number, out: V3 = [0, 0, 0]): V3 => {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
};
export const cross = (a: V3, b: V3, out: V3 = [0, 0, 0]): V3 => {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
};
export const normalize = (a: V3, out: V3 = [0, 0, 0]): V3 => {
  const l = len(a) || 1;
  return scale(a, 1 / l, out);
};
export const angleBetween = (a: V3, b: V3): number => {
  const c = dot(a, b) / ((len(a) * len(b)) || 1);
  return Math.acos(Math.min(1, Math.max(-1, c)));
};

/** Spherical linear interpolation of unit quaternions (x, y, z, w). */
export function slerp(a: Quat, b: Quat, t: number, out: Quat = [0, 0, 0, 1]): Quat {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let k0: number, k1: number;
  if (cos > 0.9999) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const sin = Math.sqrt(1 - cos * cos);
    const angle = Math.atan2(sin, cos);
    k0 = Math.sin((1 - t) * angle) / sin;
    k1 = Math.sin(t * angle) / sin;
  }
  out[0] = a[0] * k0 + bx * k1;
  out[1] = a[1] * k0 + by * k1;
  out[2] = a[2] * k0 + bz * k1;
  out[3] = a[3] * k0 + bw * k1;
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= n; out[1] /= n; out[2] /= n; out[3] /= n;
  return out;
}

/** Rotates v by unit quaternion q. */
export function rotate(q: Quat, v: V3, out: V3 = [0, 0, 0]): V3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

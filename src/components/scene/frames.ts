import * as THREE from 'three';
import type { Quat, V3 } from '../../lib/science/vec';
import type { SiteFrame } from '../../lib/science/topocentric';

/**
 * Orbit view: one scene unit = one lunar radius, axes are the Moon-fixed frame
 * remapped to Three.js Y-up:  three = (X, Z, −Y). Handedness is preserved.
 */
export const moonToThree = (v: V3, out = new THREE.Vector3()) => out.set(v[0], v[2], -v[1]);
export const threeToMoon = (v: THREE.Vector3): V3 => [v.x, -v.z, v.y];

/** Matrix mapping Moon-fixed coordinates into orbit-view world coordinates. */
export const MOON_TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);

/**
 * Surface view: metres in the site's local frame, three = (east, up, −north).
 */
export function enuToThree(e: number, n: number, u: number, out = new THREE.Vector3()) {
  return out.set(e, u, -n);
}

/** Matrix mapping Moon-fixed directions into the surface scene (rotation only). */
export function moonToSurfaceMatrix(frame: SiteFrame, out = new THREE.Matrix4()) {
  const { east: E, north: N, up: U } = frame;
  // rows: three.x = E·v, three.y = U·v, three.z = −N·v
  return out.set(E[0], E[1], E[2], 0, U[0], U[1], U[2], 0, -N[0], -N[1], -N[2], 0, 0, 0, 0, 1);
}

export const quatToMatrix = (q: Quat, out = new THREE.Matrix4()) => out.makeRotationFromQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]));

export function latLonToThree(latDeg: number, lonDeg: number, radius = 1, out = new THREE.Vector3()) {
  const p = (latDeg * Math.PI) / 180, l = (lonDeg * Math.PI) / 180;
  return moonToThree([Math.cos(p) * Math.cos(l) * radius, Math.cos(p) * Math.sin(l) * radius, Math.sin(p) * radius], out);
}

export function threeToLatLon(v: THREE.Vector3): [number, number] {
  const m = threeToMoon(v.clone().normalize());
  return [(Math.asin(Math.max(-1, Math.min(1, m[2]))) * 180) / Math.PI, (Math.atan2(m[1], m[0]) * 180) / Math.PI];
}

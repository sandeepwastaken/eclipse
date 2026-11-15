import * as THREE from 'three';

/**
 * Screen-space labels for 3D anchors. The DOM elements live in one overlay layer
 * outside the canvas (plain React); scene components project anchor points every
 * rendered frame and write transforms directly, with no per-label React roots.
 */
export const labelEls = new Map<string, HTMLElement>();

export const registerLabel = (id: string) => (el: HTMLElement | null) => {
  if (el) labelEls.set(id, el);
  else labelEls.delete(id);
};

const v = new THREE.Vector3();

export function placeLabel(id: string, world: THREE.Vector3 | readonly [number, number, number], camera: THREE.Camera, size: { width: number; height: number }, opacity = 1) {
  const el = labelEls.get(id);
  if (!el) return;
  if (Array.isArray(world)) v.set(world[0], world[1], world[2]);
  else v.copy(world as THREE.Vector3);
  v.project(camera);
  if (v.z > 1 || v.z < -1) {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    return;
  }
  // Always track the anchor, even while faded, so a fading label never drifts off its point.
  const x = (v.x * 0.5 + 0.5) * size.width;
  const y = (-v.y * 0.5 + 0.5) * size.height;
  el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  if (opacity <= 0.001) {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    return;
  }
  el.style.opacity = opacity.toFixed(3);
  el.style.pointerEvents = opacity > 0.4 ? 'auto' : 'none';
}

export function hideLabel(id: string) {
  const el = labelEls.get(id);
  if (el) {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
  }
}

/** Scene → overlay flags. */
export const labelState = { orbitHidden: false };

/** Label projectors run after the camera controls have moved the camera this frame. */
export const LABEL_PRIORITY = 2;

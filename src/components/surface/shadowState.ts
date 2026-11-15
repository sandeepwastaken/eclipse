/**
 * The surface shadow map is redrawn only when something that casts or shapes a shadow has
 * moved: the Sun, the lander, the astronaut. A still scene reuses the last map, which saves a
 * full extra render of every caster each frame.
 */
export const shadowState = { dirty: true };
export const markShadows = () => {
  shadowState.dirty = true;
};

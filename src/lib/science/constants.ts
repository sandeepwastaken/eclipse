/** Physical constants used by the geometry engine. Units are noted per constant. */

/** LOLA / IAU mean lunar reference sphere radius, km. Heights in all DEMs are relative to this sphere. */
export const MOON_RADIUS_KM = 1737.4;
/** IAU 2015 nominal solar radius, km. */
export const SUN_RADIUS_KM = 695_700;
/** Earth mean radius, km (used only for apparent disk size). */
export const EARTH_RADIUS_KM = 6371.0;
/** IAU astronomical unit, km. */
export const AU_KM = 149_597_870.7;
/** Total solar irradiance at 1 AU, W/m² (Kopp & Lean 2011). */
export const SOLAR_CONSTANT_W_M2 = 1361;
/** Speed of light, km/s. */
export const LIGHT_SPEED_KM_S = 299_792.458;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
/** Mean synodic month (one full lunar day/night cycle), ms. */
export const SYNODIC_MONTH_MS = 29.530589 * DAY_MS;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Height of the notional observer (solar array, antenna, camera) above local terrain, m. */
export const OBSERVER_HEIGHT_M = 2;

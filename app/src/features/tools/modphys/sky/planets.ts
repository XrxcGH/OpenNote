// The planets from the JPL approximate Keplerian elements (Standish, "Approximate Positions of the Planets", Table 1,
// valid 1800 to 2050). Each element is its J2000 value plus a rate per Julian century. Kepler's equation gives the
// heliocentric ecliptic position, and the geocentric J2000 equatorial place is corrected for light time.
import { J2000, atan2d, cosd, sind, wrap } from './astro';
import type { Equatorial } from './astro';

export type PlanetName = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

/** a (au), e, I, L, long. perihelion ϖ, long. node Ω (degrees): values at J2000 and rates per century. */
type Elements = readonly [number, number, number, number, number, number];

const TABLE: Record<PlanetName | 'earth', readonly [Elements, Elements]> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  ],
  // The Earth-Moon barycentre stands in for the Earth; the Earth is at most 0.00003 au from it.
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  ],
};

export const PLANETS: readonly PlanetName[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

/** The J2000 obliquity of the ecliptic used by the JPL tables (degrees). */
const OBLIQUITY = 23.43928;
/** The speed of light in au per day. */
const LIGHT = 173.1446327;

export interface Orbit {
  /** Mean anomaly M and eccentric anomaly E (degrees), and the distance from the Sun r (au). */
  m: number;
  e: number;
  r: number;
  /** Heliocentric J2000 ecliptic coordinates (au). */
  xyz: readonly [number, number, number];
}

/** Solves Kepler's equation M = E − e sin E (degrees) by Newton's method. */
export function keplerE(mDeg: number, ecc: number): number {
  const m = ((wrap(mDeg + 180) - 180) * Math.PI) / 180;
  let e = m + ecc * Math.sin(m);
  for (let k = 0; k < 30; k += 1) {
    const step = (e - ecc * Math.sin(e) - m) / (1 - ecc * Math.cos(e));
    e -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return (e * 180) / Math.PI;
}

/** A body's heliocentric J2000 ecliptic position at a Julian Date. */
export function orbit(name: PlanetName | 'earth', jd: number): Orbit {
  const [base, rate] = TABLE[name];
  const t = (jd - J2000) / 36525;
  const [a, ecc, inc, l, peri, node] = base.map((v, k) => v + rate[k]! * t) as unknown as Elements;
  const w = peri - node;
  const m = wrap(l - peri + 180) - 180;
  const e = keplerE(m, ecc);
  const xp = a * (cosd(e) - ecc);
  const yp = a * Math.sqrt(1 - ecc * ecc) * sind(e);
  const x =
    (cosd(w) * cosd(node) - sind(w) * sind(node) * cosd(inc)) * xp +
    (-sind(w) * cosd(node) - cosd(w) * sind(node) * cosd(inc)) * yp;
  const y =
    (cosd(w) * sind(node) + sind(w) * cosd(node) * cosd(inc)) * xp +
    (-sind(w) * sind(node) + cosd(w) * cosd(node) * cosd(inc)) * yp;
  const z = sind(w) * sind(inc) * xp + cosd(w) * sind(inc) * yp;
  return { m, e, r: Math.hypot(xp, yp), xyz: [x, y, z] };
}

export interface PlanetPlace extends Equatorial {
  /** Geocentric distance Δ and heliocentric distance r (au), geocentric ecliptic longitude, and elongation (°). */
  delta: number;
  r: number;
  lambda: number;
  elongation: number;
  orbit: Orbit;
}

const minus = (p: readonly number[], q: readonly number[]) => [p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!] as const;

/** A planet's geocentric J2000 place, with the planet taken at the time its light left. */
export function planet(name: PlanetName, jd: number): PlanetPlace {
  const earth = orbit('earth', jd).xyz;
  let body = orbit(name, jd);
  let g = minus(body.xyz, earth);
  for (let k = 0; k < 2; k += 1) {
    body = orbit(name, jd - Math.hypot(...g) / LIGHT);
    g = minus(body.xyz, earth);
  }
  const delta = Math.hypot(...g);
  const [x, y, z] = g;
  const ye = Math.cos((OBLIQUITY * Math.PI) / 180) * y - Math.sin((OBLIQUITY * Math.PI) / 180) * z;
  const ze = Math.sin((OBLIQUITY * Math.PI) / 180) * y + Math.cos((OBLIQUITY * Math.PI) / 180) * z;
  const sunDir = minus([0, 0, 0], earth);
  const cosElong = (g[0] * sunDir[0] + g[1] * sunDir[1] + g[2] * sunDir[2]) / (delta * Math.hypot(...sunDir));
  return {
    ra: wrap(atan2d(ye, x)) / 15,
    dec: (Math.asin(ze / delta) * 180) / Math.PI,
    delta,
    r: body.r,
    lambda: wrap(atan2d(y, x)),
    elongation: (Math.acos(Math.max(-1, Math.min(1, cosElong))) * 180) / Math.PI,
    orbit: body,
  };
}

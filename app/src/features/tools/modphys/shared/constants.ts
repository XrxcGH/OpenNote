// Physical constants and astronomical reference values for the modern physics tools, in SI units. The physical
// constants come from the CODATA 2022 table the constants picker already holds, so every tool uses the same digits;
// the solar, planetary, and length values are the IAU 2015 nominal values and IAU 2012 definitions.
import { codataById, codataValue } from '../../science/codata';

function codata(id: string): number {
  const one = codataById(id);
  if (!one) throw new Error(`No CODATA constant "${id}"`);
  return codataValue(one);
}

export const C = {
  c: codata('c'),
  h: codata('h'),
  hbar: codata('hbar'),
  e: codata('e'),
  me: codata('me'),
  mp: codata('mp'),
  mn: codata('mn'),
  u: codata('u'),
  kB: codata('kB'),
  eps0: codata('eps0'),
  mu0: codata('mu0'),
  G: codata('G'),
  sigma: codata('sigma'),
  a0: codata('a0'),
  alpha: codata('alpha'),
  Rinf: codata('Rinf'),
  NA: codata('NA'),
  muB: codata('muB'),
} as const;

/** The Rydberg energy R∞hc in electronvolts. */
export const RY_EV = (C.Rinf * C.h * C.c) / C.e;

/** IAU 2015 Resolution B3 nominal values, and the IAU 2012 astronomical unit. */
export const ASTRO = {
  au: 1.495978707e11,
  pc: (648000 / Math.PI) * 1.495978707e11,
  ly: C.c * 365.25 * 86400,
  rSun: 6.957e8,
  lSun: 3.828e26,
  tSun: 5772,
  gmSun: 1.3271244e20,
  rEarth: 6.3781e6,
  gmEarth: 3.986004e14,
  rJupiter: 7.1492e7,
  gmJupiter: 1.2668653e17,
  /** Seconds in a Julian year. */
  year: 365.25 * 86400,
} as const;

export const MASS_SUN = ASTRO.gmSun / C.G;
export const MASS_EARTH = ASTRO.gmEarth / C.G;
export const MASS_JUPITER = ASTRO.gmJupiter / C.G;

export const CONSTANT_SOURCES = [
  'CODATA 2022 recommended values (NIST, public domain).',
  'IAU 2015 Resolution B3 nominal solar and planetary values; IAU 2012 Resolution B2 astronomical unit.',
] as const;

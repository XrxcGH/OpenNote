// Physical constants for the physics tools, read from the CODATA 2022 table the constants tool shows (NIST, public
// domain), so the two never disagree. Exact SI values (c, e, h) come out exact.
import { codataById, codataValue } from '../../science/codata';

const value = (id: string): number => {
  const one = codataById(id);
  if (!one) throw new Error(`No CODATA constant ${id}`);
  return codataValue(one);
};

/** Speed of light in vacuum, m/s. */
export const C = value('c');
/** Elementary charge, C. */
export const E_CHARGE = value('e');
/** Planck constant, J s. */
export const PLANCK = value('h');
/** Vacuum electric permittivity, F/m. */
export const EPS0 = value('eps0');
/** Vacuum magnetic permeability, N/A². */
export const MU0 = value('mu0');
/** Coulomb constant 1 / (4 pi eps0), N m²/C². */
export const K_E = 1 / (4 * Math.PI * EPS0);
/** Stefan-Boltzmann constant, W/(m² K⁴). */
export const SIGMA = value('sigma');
/** Standard acceleration of gravity, m/s². */
export const G0 = value('g');
/** Boltzmann constant, J/K. */
export const K_B = value('kB');
/** Atomic mass constant, kg. */
export const U_KG = value('u');
/** Electron, proton, and neutron masses, kg. */
export const M_E = value('me');
export const M_P = value('mp');
export const M_N = value('mn');
/** One MeV in joules. */
export const MEV = 1e6 * E_CHARGE;
/** The atomic mass constant as an energy, MeV (931.494...). */
export const U_MEV = (U_KG * C * C) / MEV;

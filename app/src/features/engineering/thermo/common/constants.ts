// Physical constants for the thermodynamics kit: the exact SI defining constants (CODATA 2018 and the 2019 SI).

/** Boltzmann constant, J/K (exact). */
export const K_B = 1.380649e-23;
/** Planck constant, J s (exact). */
export const H_PLANCK = 6.62607015e-34;
/** Speed of light, m/s (exact). */
export const C_LIGHT = 299792458;
/** Avogadro constant, 1/mol (exact). */
export const N_A = 6.02214076e23;
/** Elementary charge, C (exact), which is also J per eV. */
export const E_CHARGE = 1.602176634e-19;
/** Molar gas constant, J/(mol K) = N_A k. */
export const R_MOLAR = N_A * K_B;
/** Second radiation constant h c / k in cm K, for rotational and vibrational temperatures from wavenumbers. */
export const C2_CM_K = ((H_PLANCK * C_LIGHT) / K_B) * 100;
/** Standard pressure for tabulated entropies, kPa. */
export const P_STANDARD = 100;

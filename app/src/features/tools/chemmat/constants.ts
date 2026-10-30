// Constants the tools use, in SI units. Values are the 2022 CODATA recommended values (NIST, public domain); the
// tests compare each with the constants table of the Science tools.
export const R = 8.314462618; // J/(mol K). Exact: N_A times k_B.
export const F = 96485.33212; // C/mol. Exact: N_A e.
export const KB = 1.380649e-23; // J/K. Exact.
export const H = 6.62607015e-34; // J s. Exact.
export const C = 299792458; // m/s. Exact.
export const E_CHARGE = 1.602176634e-19; // C. Exact.
export const NA = 6.02214076e23; // 1/mol. Exact.
export const ME = 9.1093837139e-31; // kg
export const MP = 1.67262192595e-27; // kg
export const R_INF = 10973731.568157; // 1/m. The Rydberg constant.
/** The Rydberg constant for hydrogen, with the nucleus's finite mass: R_inf / (1 + m_e / m_p). */
export const R_H = R_INF / (1 + ME / MP);
export const T_STD = 298.15; // K
/** R in L bar / (mol K), for pressure-to-concentration conversions. */
export const R_LBAR = R / 100;
export const EV = E_CHARGE; // J per eV

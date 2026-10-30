// Critical constants and acentric factors for the real-gas tool. They are facts, shown in the form as starting
// values the student can overwrite to match a textbook's table. Molar masses come from standard atomic weights.
import { molarMass } from '../data/nasa';
import { molarMassOf } from '../idealgas/gas';

export const CRITICAL_SOURCE =
  'critical constants as listed in the NIST Chemistry WebBook; acentric factors from the same reference equations ' +
  'of state (overwrite either to match your table)';

export type CriticalId =
  'CO2' | 'N2' | 'O2' | 'air' | 'Ar' | 'CH4' | 'C2H6' | 'C3H8' | 'C4H10' | 'H2O' | 'NH3' | 'CO' | 'H2' | 'He';

export interface Critical {
  /** Critical temperature, K. */
  Tc: number;
  /** Critical pressure, kPa. */
  pc: number;
  /** Acentric factor. */
  omega: number;
  /** Molar mass, g/mol. */
  M: number;
}

const c = (formula: string, Tc: number, pcMPa: number, omega: number): Critical => ({
  Tc,
  pc: pcMPa * 1000,
  omega,
  M: molarMass(formula),
});

export const CRITICAL: Record<CriticalId, Critical> = {
  CO2: c('CO2', 304.13, 7.3773, 0.22394),
  N2: c('N2', 126.192, 3.3958, 0.0372),
  O2: c('O2', 154.581, 5.043, 0.0222),
  // Air is a mixture: these are its maxcondentherm values, the pseudo-critical point charts use.
  air: { Tc: 132.6312, pc: 3785.02, omega: 0.0335, M: molarMassOf('air') },
  Ar: c('Ar', 150.687, 4.863, -0.00219),
  CH4: c('CH4', 190.564, 4.5992, 0.01142),
  C2H6: c('C2H6', 305.322, 4.8722, 0.0995),
  C3H8: c('C3H8', 369.89, 4.2512, 0.1521),
  C4H10: c('C4H10', 425.125, 3.796, 0.201),
  H2O: c('H2O', 647.096, 22.064, 0.3443),
  NH3: c('NH3', 405.4, 11.333, 0.25601),
  CO: c('CO', 132.86, 3.494, 0.0497),
  H2: c('H2', 33.145, 1.2964, -0.219),
  He: c('He', 5.1953, 0.22832, -0.3836),
};

export const CRITICAL_IDS = Object.keys(CRITICAL) as CriticalId[];

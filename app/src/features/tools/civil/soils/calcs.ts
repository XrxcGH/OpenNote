// The soil properties, consolidation, and strength tool's calculations. The methods are in ./engine.
import type { Calc } from '../core/types';
import { aashtoCalc, gradationCalc, hydrometerCalc, limitsCalc, phasesCalc, uscsCalc } from './classify';
import { cvCalc, preconCalc, secondaryCalc, settlementCalc, shearCalc, skemptonCalc, timeFactorCalc } from './strength';
import { compactionCalc, effectiveCalc, loadsCalc, permeabilityCalc, quickCalc } from './stress';

export const CALCS: readonly Calc[] = [
  phasesCalc,
  gradationCalc,
  hydrometerCalc,
  limitsCalc,
  uscsCalc,
  aashtoCalc,
  compactionCalc,
  permeabilityCalc,
  effectiveCalc,
  quickCalc,
  loadsCalc,
  timeFactorCalc,
  settlementCalc,
  secondaryCalc,
  cvCalc,
  preconCalc,
  shearCalc,
  skemptonCalc,
];

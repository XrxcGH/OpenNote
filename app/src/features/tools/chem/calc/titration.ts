// Titration of a monoprotic acid or base by a strong titrant: the equivalence volume, an unknown concentration, and
// the pH curve. The pH at each volume solves the charge balance exactly, so it is right before, at, and after the
// equivalence point for strong and weak analytes alike.
import { KW } from './solution';
import { sig } from './stoich';

export type Analyte = 'strongAcid' | 'weakAcid' | 'strongBase' | 'weakBase';

export interface Titration {
  analyte: Analyte;
  /** Concentration (M) and volume (any one unit, such as mL) of the analyte. */
  concentration: number;
  volume: number;
  /** Ka of a weak acid or Kb of a weak base. */
  k?: number;
  /** Concentration of the strong titrant (M). */
  titrantConcentration: number;
}

/** Equivalence volume (same unit as the analyte volume) for a 1:1 reaction. */
export const equivalenceVolume = (t: Titration, ratio = 1) =>
  (t.concentration * t.volume * ratio) / t.titrantConcentration;

/** Unknown analyte concentration from the titrant used: Ca = Ct·Vt ÷ (Va × ratio), where ratio is analyte moles per titrant mole inverted. */
export function unknownConcentration(titrantC: number, titrantV: number, analyteV: number, molesTitrantPerAnalyte = 1) {
  const c = (titrantC * titrantV) / (analyteV * molesTitrantPerAnalyte);
  return {
    c,
    steps: [
      `Moles of titrant = ${sig(titrantC)} M × ${sig(titrantV)} = ${sig(titrantC * titrantV)} (mmol when volume is in mL)`,
      `Moles of analyte = ${sig(titrantC * titrantV)} ÷ ${molesTitrantPerAnalyte} = ${sig((titrantC * titrantV) / molesTitrantPerAnalyte)}`,
      `Concentration = ${sig((titrantC * titrantV) / molesTitrantPerAnalyte)} ÷ ${sig(analyteV)} = ${sig(c)} M`,
    ],
  };
}

/** pH after adding `added` of titrant (same volume unit as t.volume). */
export function phAt(t: Titration, added: number): number {
  const total = t.volume + added;
  const ca = (t.concentration * t.volume) / total;
  const ct = (t.titrantConcentration * added) / total;
  const acidAnalyte = t.analyte === 'strongAcid' || t.analyte === 'weakAcid';
  const weak = t.analyte === 'weakAcid' || t.analyte === 'weakBase';
  // Ka of the weak acid, or of the conjugate acid of the weak base.
  const ka = weak ? (acidAnalyte ? (t.k ?? 1e-5) : KW / (t.k ?? 1e-5)) : Infinity;
  // Charge balance f(h) = 0, increasing in h reversed: solve by bisection on log10(h).
  const f = (h: number): number => {
    const oh = KW / h;
    if (acidAnalyte) {
      const anion = weak ? (ca * ka) / (ka + h) : ca;
      return ct + h - oh - anion;
    }
    const cation = weak ? (ca * h) / (ka + h) : 0;
    // A base analyte titrated by a strong acid: the cation (BH+ or the metal ion) and H+ balance OH- and the anion.
    const metal = t.analyte === 'strongBase' ? ca : 0;
    return h + cation + metal - oh - ct;
  };
  let lo = -15;
  let hi = 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    // For the acid case f is increasing in h; for the base case too (h + cation(h) increases, −KW/h increases).
    if (f(10 ** mid) > 0) hi = mid;
    else lo = mid;
  }
  return -(lo + hi) / 2;
}

/** The curve as (volume added, pH) points, denser around the equivalence point. */
export function curve(t: Titration, points = 60): { v: number; ph: number }[] {
  const eq = equivalenceVolume(t);
  const out: { v: number; ph: number }[] = [];
  const end = eq * 2;
  for (let i = 0; i <= points; i += 1) {
    const s = i / points;
    // Bend the spacing toward the equivalence point.
    const x = 0.5 + Math.sign(s - 0.5) * Math.pow(Math.abs(2 * s - 1), 2) * 0.5;
    out.push({ v: x * end, ph: phAt(t, x * end) });
  }
  return out;
}

/** Steps for the equivalence point and the pH there. */
export function summary(t: Titration): { equivalence: number; phEquivalence: number; steps: string[] } {
  const equivalence = equivalenceVolume(t);
  const phEq = phAt(t, equivalence);
  return {
    equivalence,
    phEquivalence: phEq,
    steps: [
      `Equivalence: ${sig(t.concentration)} M × ${sig(t.volume)} = ${sig(t.titrantConcentration)} M × V, so V = ${sig(equivalence)}`,
      `pH at the equivalence point = ${phEq.toFixed(2)}`,
      ...(t.analyte === 'weakAcid'
        ? [`Half-equivalence (${sig(equivalence / 2)}): pH = pKa = ${phAt(t, equivalence / 2).toFixed(2)}`]
        : []),
    ],
  };
}

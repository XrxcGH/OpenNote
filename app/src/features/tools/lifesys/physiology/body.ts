// Body fluids, metabolism, growth, and plant water. Fluids: calculated osmolarity with the osmolar gap, compartment
// shifts after an infusion, and Starling filtration. Energy: the Mifflin-St Jeor BMR with daily energy, macronutrient
// energy, METs, RER, and Karvonen heart-rate zones. Also the LMS growth z-score and plant water potential.
import { LsError, nonNegative, positive, within } from '../num/errors';
import { normalCdf, normalQuantile } from '../num/special';
import type { CalcResult, ResultRow, Step } from '../types';

export function osmolarityResult(na: number, glucose: number, bun: number, measured: number | null): CalcResult {
  positive(na, 'Na⁺');
  nonNegative(glucose, 'glucose');
  nonNegative(bun, 'BUN');
  const calc = 2 * na + glucose / 18 + bun / 2.8;
  const rows: ResultRow[] = [{ label: 'physiology.r.osmCalc', value: calc, unit: 'mOsm/kg' }];
  const latex = 'Osm = 2[Na^+] + \\frac{glucose}{18} + \\frac{BUN}{2.8}';
  const steps: Step[] = [{ key: 'physiology.s.osm', vars: { na, g: glucose, b: bun, o: calc }, math: latex }];
  if (measured !== null) {
    const gap = positive(measured, 'Osm') - calc;
    rows.push({ label: 'physiology.r.osmGap', value: gap, unit: 'mOsm/kg' });
    steps.push({ key: 'physiology.s.osmGap', vars: { m: measured, c: calc, g: gap } });
  }
  return { rows, steps, latex };
}

export interface FluidShift {
  icf: number;
  ecf: number;
  osm: number;
}

/** Infuses `volume` L of a fluid at `fluidOsm` mOsm/L whose solute stays in the ECF; water moves until osmolarity is equal. */
export function infuse(weight: number, water: number, osm: number, volume: number, fluidOsm: number) {
  const tbw = weight * water;
  const before: FluidShift = { icf: (2 / 3) * tbw, ecf: tbw / 3, osm };
  const solute = tbw * osm + volume * fluidOsm;
  const newOsm = solute / (tbw + volume);
  const icf = (before.icf * osm) / newOsm;
  return { before, after: { icf, ecf: tbw + volume - icf, osm: newOsm } as FluidShift };
}

export function fluidResult(weight: number, water: number, osm: number, volume: number, fluidOsm: number): CalcResult {
  positive(weight, 'weight');
  within(water, 'TBW', 0.3, 0.8);
  positive(osm, 'Osm');
  nonNegative(volume, 'V');
  nonNegative(fluidOsm, 'Osm');
  const { before, after } = infuse(weight, water, osm, volume, fluidOsm);
  return {
    rows: [
      { label: 'physiology.r.icfAfter', value: after.icf, unit: 'L' },
      { label: 'physiology.r.ecfAfter', value: after.ecf, unit: 'L' },
      { label: 'physiology.r.osmAfter', value: after.osm, unit: 'mOsm/L' },
      { label: 'physiology.r.icfChange', value: after.icf - before.icf, unit: 'L' },
      { label: 'physiology.r.ecfChange', value: after.ecf - before.ecf, unit: 'L' },
    ],
    steps: [
      { key: 'physiology.s.tbw', vars: { w: weight, f: water, t: weight * water, i: before.icf, e: before.ecf } },
      { key: 'physiology.s.solute', vars: { t: weight * water, o: osm, v: volume, f: fluidOsm, n: after.osm } },
      { key: 'physiology.s.shift', vars: { i: after.icf, e: after.ecf } },
    ],
    table: {
      header: [{ key: 'physiology.t.compartment' }, { key: 'physiology.t.before' }, { key: 'physiology.t.after' }],
      rows: [
        [{ key: 'physiology.t.icf' }, before.icf, after.icf],
        [{ key: 'physiology.t.ecf' }, before.ecf, after.ecf],
        [{ key: 'physiology.t.osm' }, before.osm, after.osm],
      ],
    },
    notes: [{ key: 'physiology.n.darrow' }],
  };
}

export function starlingResult(pc: number, pi: number, oc: number, oi: number, sigma: number, kf: number): CalcResult {
  within(sigma, 'σ', 0, 1);
  nonNegative(kf, 'Kf');
  const net = pc - pi - sigma * (oc - oi);
  const jv = kf * net;
  const latex = 'J_v = K_f\\left[(P_c - P_i) - \\sigma(\\pi_c - \\pi_i)\\right]';
  return {
    rows: [
      { label: 'physiology.r.netPressure', value: net, unit: 'mmHg' },
      { label: 'physiology.r.jv', value: jv },
      {
        label: 'physiology.r.direction',
        value: '',
        word: net > 0 ? 'physiology.o.filtration' : net < 0 ? 'physiology.o.absorption' : 'physiology.o.balance',
      },
    ],
    steps: [{ key: 'physiology.s.starling', vars: { pc, pi, oc, oi, s: sigma, n: net, k: kf, j: jv }, math: latex }],
    latex,
  };
}

export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 } as const;
export type Activity = keyof typeof ACTIVITY;

/** Mifflin-St Jeor (1990): 10 W + 6.25 H − 5 A + 5 (male) or − 161 (female), in kcal/day. */
export const mifflin = (sex: 'male' | 'female', kg: number, cm: number, age: number): number =>
  10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);

export function bmrResult(sex: 'male' | 'female', kg: number, cm: number, age: number, activity: Activity): CalcResult {
  positive(kg, 'weight');
  positive(cm, 'height');
  within(age, 'age', 1, 120);
  const bmr = mifflin(sex, kg, cm, age);
  if (!(bmr > 0)) throw new LsError('physiology.e.bmr');
  const factor = ACTIVITY[activity];
  return {
    rows: [
      { label: 'physiology.r.bmr', value: bmr, unit: 'kcal/day' },
      { label: 'physiology.r.tdee', value: bmr * factor, unit: 'kcal/day' },
    ],
    steps: [
      {
        key: `physiology.s.mifflin.${sex}`,
        vars: { w: kg, h: cm, a: age, b: bmr },
        math: 'BMR = 10W + 6.25H - 5A + s',
      },
      { key: 'physiology.s.tdee', vars: { b: bmr, f: factor, t: bmr * factor } },
    ],
    latex: 'BMR = 10W + 6.25H - 5A + s',
    source: 'physiology.src.mifflin',
  };
}

export function macroResult(carb: number, protein: number, fat: number, alcohol: number): CalcResult {
  [carb, protein, fat, alcohol].forEach((g) => nonNegative(g, 'g'));
  const kcal = [carb * 4, protein * 4, fat * 9, alcohol * 7];
  const total = kcal.reduce((s, v) => s + v, 0);
  if (!(total > 0)) throw new LsError('physiology.e.noFood');
  const share = (v: number) => (100 * v) / total;
  return {
    rows: [
      { label: 'physiology.r.energy', value: total, unit: 'kcal' },
      { label: 'physiology.r.carbShare', value: share(kcal[0]), unit: '%' },
      { label: 'physiology.r.proteinShare', value: share(kcal[1]), unit: '%' },
      { label: 'physiology.r.fatShare', value: share(kcal[2]), unit: '%' },
      ...(alcohol > 0 ? [{ label: 'physiology.r.alcoholShare' as const, value: share(kcal[3]), unit: '%' }] : []),
    ],
    steps: [{ key: 'physiology.s.macros', vars: { c: carb, p: protein, f: fat, a: alcohol, t: total } }],
    notes: [{ key: 'physiology.n.atwater' }],
  };
}

export function exerciseResult(
  vo2: number | null,
  vco2: number | null,
  age: number | null,
  rest: number | null,
  intensity: number | null,
): CalcResult {
  const rows: ResultRow[] = [];
  const steps: Step[] = [];
  if (vo2 !== null) {
    positive(vo2, 'VO₂');
    rows.push({ label: 'physiology.r.mets', value: vo2 / 3.5 });
    steps.push({ key: 'physiology.s.mets', vars: { v: vo2, m: vo2 / 3.5 } });
    if (vco2 !== null) {
      const rer = nonNegative(vco2, 'VCO₂') / vo2;
      rows.push({ label: 'physiology.r.rer', value: rer });
      steps.push({ key: rer > 1 ? 'physiology.s.rerHigh' : 'physiology.s.rer', vars: { c: vco2, v: vo2, r: rer } });
    }
  }
  if (age !== null || rest !== null || intensity !== null) {
    if (age === null || rest === null || intensity === null) throw new LsError('physiology.e.karvonen');
    within(age, 'age', 1, 120);
    positive(rest, 'HR_rest');
    within(intensity, '%', 0, 100);
    const max = 220 - age;
    if (!(max > rest)) throw new LsError('physiology.e.heartRate');
    const target = (max - rest) * (intensity / 100) + rest;
    rows.push(
      { label: 'physiology.r.hrMax', value: max, unit: 'bpm' },
      { label: 'physiology.r.target', vars: { p: intensity }, value: target, unit: 'bpm' },
    );
    steps.push({
      key: 'physiology.s.karvonen',
      vars: { age, max, r: rest, p: intensity, t: target },
      math: 'HR = (HR_{max} - HR_{rest}) \\times p + HR_{rest}',
    });
  }
  if (rows.length === 0) throw new LsError('physiology.e.exerciseEmpty');
  return { rows, steps };
}

/** The LMS z-score ((X/M)^L − 1)/(L S), or ln(X/M)/S when L = 0 (Cole 1990, used by the CDC 2000 charts). */
export function lmsZ(x: number, l: number, m: number, s: number): number {
  positive(x, 'X');
  positive(m, 'M');
  positive(s, 'S');
  return Math.abs(l) < 1e-12 ? Math.log(x / m) / s : ((x / m) ** l - 1) / (l * s);
}

/** The measurement at a z-score: M (1 + L S z)^(1/L), or M e^(S z) when L = 0. */
export function lmsX(z: number, l: number, m: number, s: number): number {
  if (Math.abs(l) < 1e-12) return m * Math.exp(s * z);
  const base = 1 + l * s * z;
  if (!(base > 0)) throw new LsError('physiology.e.lmsRange');
  return m * base ** (1 / l);
}

export function lmsResult(x: number, l: number, m: number, s: number, percentile: number | null): CalcResult {
  const z = lmsZ(x, l, m, s);
  const rows: ResultRow[] = [
    { label: 'physiology.r.z', value: z },
    { label: 'physiology.r.percentile', value: 100 * normalCdf(z), digits: 4 },
  ];
  const latex = 'z = \\frac{(X/M)^L - 1}{L S}';
  const steps: Step[] = [
    { key: 'physiology.s.lms', vars: { x, l, m, s, z }, math: latex },
    { key: 'physiology.s.percentile', vars: { z, p: 100 * normalCdf(z) } },
  ];
  if (percentile !== null) {
    within(percentile, 'percentile', 0.1, 99.9);
    const zp = normalQuantile(percentile / 100);
    const at = lmsX(zp, l, m, s);
    rows.push({ label: 'physiology.r.atPercentile', vars: { p: percentile }, value: at });
    steps.push({ key: 'physiology.s.lmsInverse', vars: { p: percentile, z: zp, x: at } });
  }
  return { rows, steps, latex, notes: [{ key: 'physiology.n.lms' }], source: 'physiology.src.cdc' };
}

/** Solute potential Ψs = −i C R T in MPa, with C in mol/L and T in °C. */
export const soluteMpa = (i: number, molar: number, celsius: number): number =>
  -i * molar * 0.008314462618 * (celsius + 273.15);

export function waterPotentialResult(i: number, molar: number, celsius: number, pressure: number): CalcResult {
  positive(i, 'i');
  nonNegative(molar, 'C');
  if (!(celsius + 273.15 > 0)) throw new LsError('neuron.e.kelvin');
  const psiS = soluteMpa(i, molar, celsius);
  const psi = psiS + pressure;
  return {
    rows: [
      { label: 'physiology.r.psiS', value: psiS, unit: 'MPa' },
      { label: 'physiology.r.psi', value: psi, unit: 'MPa' },
    ],
    steps: [
      {
        key: 'physiology.s.psiS',
        vars: { i, c: molar, T: celsius + 273.15, p: psiS },
        math: '\\Psi_s = -iCRT',
      },
      { key: 'physiology.s.psi', vars: { s: psiS, p: pressure, t: psi }, math: '\\Psi = \\Psi_s + \\Psi_p' },
    ],
    latex: '\\Psi = \\Psi_s + \\Psi_p = -iCRT + \\Psi_p',
    notes: [{ key: 'physiology.n.water' }],
  };
}

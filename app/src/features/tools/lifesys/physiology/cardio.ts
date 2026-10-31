// Cardiovascular physiology: cardiac output by heart rate and stroke volume or by the Fick principle, mean arterial
// pressure, ejection fraction, vascular resistance (from pressure and flow, in series and parallel, and by
// Poiseuille), and Laplace wall tension with compliance. Pressures in mmHg, flows in mL/min, volumes in mL.
import { LsError, nonNegative, positive, within } from '../num/errors';
import type { CalcResult, ResultRow, Step } from '../types';

type Point = [number, number];

export function cardiacOutputResult(
  mode: 'hrsv' | 'fick',
  hr: number,
  sv: number,
  vo2: number,
  ca: number,
  cv: number,
): CalcResult {
  if (mode === 'hrsv') {
    positive(hr, 'HR');
    positive(sv, 'SV');
    const co = (hr * sv) / 1000;
    return {
      rows: [{ label: 'physiology.r.co', value: co, unit: 'L/min' }],
      steps: [{ key: 'physiology.s.coHrSv', vars: { hr, sv, co }, math: 'CO = HR \\times SV' }],
      latex: 'CO = HR \\times SV',
    };
  }
  positive(vo2, 'VO₂');
  positive(ca, 'CaO₂');
  nonNegative(cv, 'CvO₂');
  if (!(ca > cv)) throw new LsError('physiology.e.avDiff');
  // Contents are mL O₂ per dL of blood: 10 dL per L.
  const co = vo2 / ((ca - cv) * 10);
  return {
    rows: [
      { label: 'physiology.r.co', value: co, unit: 'L/min' },
      { label: 'physiology.r.avDiff', value: ca - cv, unit: 'mL/dL' },
      { label: 'physiology.r.extraction', value: (100 * (ca - cv)) / ca, unit: '%' },
    ],
    steps: [
      {
        key: 'physiology.s.fick',
        vars: { vo2, ca, cv, d: ca - cv, co },
        math: 'CO = \\frac{\\dot V_{O_2}}{C_aO_2 - C_vO_2}',
      },
    ],
    latex: 'CO = \\frac{\\dot V_{O_2}}{C_aO_2 - C_vO_2}',
  };
}

export const meanArterial = (sys: number, dia: number): number => dia + (sys - dia) / 3;

export function pressureResult(sys: number, dia: number, cvp: number | null, co: number | null): CalcResult {
  positive(sys, 'SBP');
  positive(dia, 'DBP');
  if (!(sys >= dia)) throw new LsError('physiology.e.systolic');
  const map = meanArterial(sys, dia);
  const rows: ResultRow[] = [
    { label: 'physiology.r.map', value: map, unit: 'mmHg' },
    { label: 'physiology.r.pulse', value: sys - dia, unit: 'mmHg' },
  ];
  const steps: Step[] = [
    { key: 'physiology.s.map', vars: { d: dia, s: sys, map }, math: 'MAP = DBP + \\frac{SBP - DBP}{3}' },
  ];
  if (co !== null) {
    positive(co, 'CO');
    const ra = cvp ?? 0;
    const svr = (map - ra) / co;
    rows.push(
      { label: 'physiology.r.svrWood', value: svr, unit: 'mmHg·min/L' },
      { label: 'physiology.r.svrDyn', value: svr * 80, unit: 'dyn·s/cm⁵' },
    );
    steps.push({ key: 'physiology.s.svr', vars: { map, ra, co, r: svr, dyn: svr * 80 } });
  }
  return { rows, steps, latex: 'MAP = DBP + \\frac{SBP - DBP}{3}' };
}

export function ejectionResult(edv: number, esv: number, hr: number | null): CalcResult {
  positive(edv, 'EDV');
  nonNegative(esv, 'ESV');
  if (!(edv > esv)) throw new LsError('physiology.e.esv');
  const sv = edv - esv;
  const ef = sv / edv;
  const rows: ResultRow[] = [
    { label: 'physiology.r.sv', value: sv, unit: 'mL' },
    { label: 'physiology.r.ef', value: 100 * ef, unit: '%' },
  ];
  const steps: Step[] = [
    { key: 'physiology.s.ef', vars: { edv, esv, sv, ef: 100 * ef }, math: 'EF = \\frac{EDV - ESV}{EDV}' },
  ];
  if (hr !== null) {
    rows.push({ label: 'physiology.r.co', value: (positive(hr, 'HR') * sv) / 1000, unit: 'L/min' });
    steps.push({ key: 'physiology.s.coHrSv', vars: { hr, sv, co: (hr * sv) / 1000 } });
  }
  return { rows, steps, latex: 'EF = \\frac{EDV - ESV}{EDV}' };
}

/** Poiseuille resistance 8ηL/(πr⁴) in mmHg·min/mL, from η (cP), L (cm), and r (cm). */
export function poiseuille(etaCp: number, lengthCm: number, radiusCm: number): number {
  // 1 cP = 0.01 dyn·s/cm²; dyn·s/cm⁵ to mmHg·min/mL: divide by 1333.22 × 60.
  const dyn = (8 * etaCp * 0.01 * lengthCm) / (Math.PI * radiusCm ** 4);
  return dyn / (1333.224 * 60);
}

export function resistanceResult(
  mode: 'flow' | 'series' | 'parallel' | 'poiseuille',
  values: { dp: number; q: number; list: readonly number[]; eta: number; length: number; radius: number },
): CalcResult {
  if (mode === 'flow') {
    positive(values.q, 'Q');
    const r = values.dp / values.q;
    return {
      rows: [{ label: 'physiology.r.resistance', value: r, unit: 'mmHg·min/mL' }],
      steps: [{ key: 'physiology.s.ohm', vars: { dp: values.dp, q: values.q, r }, math: 'R = \\frac{\\Delta P}{Q}' }],
      latex: 'R = \\frac{\\Delta P}{Q}',
    };
  }
  if (mode === 'series' || mode === 'parallel') {
    if (values.list.length < 2) throw new LsError('errors.points', { min: 2 });
    values.list.forEach((r) => positive(r, 'R'));
    const total =
      mode === 'series' ? values.list.reduce((s, r) => s + r, 0) : 1 / values.list.reduce((s, r) => s + 1 / r, 0);
    return {
      rows: [{ label: 'physiology.r.total', value: total }],
      steps: [{ key: `physiology.s.${mode}`, vars: { n: values.list.length, r: total } }],
      latex: mode === 'series' ? 'R = R_1 + R_2 + \\cdots' : '\\frac{1}{R} = \\frac{1}{R_1} + \\frac{1}{R_2} + \\cdots',
    };
  }
  positive(values.eta, 'η');
  positive(values.length, 'L');
  positive(values.radius, 'r');
  const r = poiseuille(values.eta, values.length, values.radius);
  const half = poiseuille(values.eta, values.length, values.radius / 2);
  const rows: ResultRow[] = [{ label: 'physiology.r.resistance', value: r, unit: 'mmHg·min/mL' }];
  const steps: Step[] = [
    {
      key: 'physiology.s.poiseuille',
      vars: { eta: values.eta, L: values.length, r: values.radius, R: r, x: half / r },
      math: 'R = \\frac{8 \\eta L}{\\pi r^4}',
    },
  ];
  if (values.dp > 0) {
    rows.push({ label: 'physiology.r.flow', value: values.dp / r, unit: 'mL/min' });
    steps.push({ key: 'physiology.s.flow', vars: { dp: values.dp, R: r, q: values.dp / r } });
  }
  return {
    rows,
    steps,
    latex: 'R = \\frac{8 \\eta L}{\\pi r^4}',
    plots: [
      {
        title: 'physiology.p.poiseuille',
        x: { label: 'physiology.p.radius' },
        y: { label: 'physiology.p.relativeFlow' },
        series: [
          {
            name: 'physiology.p.flowSeries',
            points: Array.from({ length: 81 }, (_, i) => [(2 * values.radius * i) / 80, ((2 * i) / 80) ** 4] as Point),
          },
        ],
      },
    ],
  };
}

export function laplaceResult(
  shape: 'sphere' | 'cylinder',
  p: number,
  radiusCm: number,
  wallCm: number | null,
  dv: number | null,
  dp: number | null,
): CalcResult {
  positive(p, 'P');
  positive(radiusCm, 'r');
  const pDyn = p * 1333.224;
  const tension = shape === 'sphere' ? (pDyn * radiusCm) / 2 : pDyn * radiusCm;
  const rows: ResultRow[] = [{ label: 'physiology.r.tension', value: tension, unit: 'dyn/cm' }];
  const steps: Step[] = [
    {
      key: `physiology.s.laplace.${shape}`,
      vars: { p, r: radiusCm, T: tension },
      math: shape === 'sphere' ? 'T = \\frac{P r}{2}' : 'T = P r',
    },
  ];
  if (wallCm !== null) {
    const stress = tension / positive(wallCm, 'h');
    rows.push({ label: 'physiology.r.stress', value: stress, unit: 'dyn/cm²' });
    steps.push({ key: 'physiology.s.stress', vars: { T: tension, h: wallCm, s: stress } });
  }
  if (dv !== null || dp !== null) {
    if (dv === null || dp === null) throw new LsError('physiology.e.compliancePair');
    within(dp, 'ΔP', 1e-12, Infinity);
    rows.push({ label: 'physiology.r.compliance', value: dv / dp, unit: 'mL/mmHg' });
    steps.push({
      key: 'physiology.s.compliance',
      vars: { dv, dp, c: dv / dp },
      math: 'C = \\frac{\\Delta V}{\\Delta P}',
    });
  }
  return { rows, steps, latex: shape === 'sphere' ? 'T = \\frac{P r}{2}' : 'T = P r' };
}

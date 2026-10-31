// Respiratory physiology: the alveolar gas equation and A-a gradient, oxygen content and delivery, the hemoglobin
// dissociation curve by Severinghaus's 1979 equation with shifts for pH, PCO₂, and temperature, ventilation, Bohr
// dead space, and compliance. Pressures in mmHg, volumes in mL, hemoglobin in g/dL.
import { LsError, nonNegative, positive, within } from '../num/errors';
import { brent } from '../num/roots';
import type { CalcResult, ResultRow, Step } from '../types';

type Point = [number, number];

export const alveolarO2 = (fio2: number, patm: number, ph2o: number, paco2: number, r: number): number =>
  fio2 * (patm - ph2o) - paco2 / r;

export function alveolarResult(
  fio2: number,
  patm: number,
  ph2o: number,
  paco2: number,
  r: number,
  pao2: number | null,
  age: number | null,
): CalcResult {
  within(fio2, 'FiO₂', 0, 1);
  positive(patm, 'Patm');
  nonNegative(ph2o, 'PH₂O');
  if (!(patm > ph2o)) throw new LsError('physiology.e.patm');
  nonNegative(paco2, 'PaCO₂');
  positive(r, 'R');
  const pA = alveolarO2(fio2, patm, ph2o, paco2, r);
  const rows: ResultRow[] = [{ label: 'physiology.r.pAO2', value: pA, unit: 'mmHg' }];
  const latex = 'P_AO_2 = F_iO_2 (P_{atm} - P_{H_2O}) - \\frac{P_aCO_2}{R}';
  const steps: Step[] = [
    { key: 'physiology.s.alveolar', vars: { f: fio2, p: patm, w: ph2o, c: paco2, r, a: pA }, math: latex },
  ];
  if (pao2 !== null) {
    const gradient = pA - nonNegative(pao2, 'PaO₂');
    rows.push({ label: 'physiology.r.aaGradient', value: gradient, unit: 'mmHg' });
    steps.push({ key: 'physiology.s.aa', vars: { A: pA, a: pao2, g: gradient } });
    if (age !== null) {
      const expected = positive(age, 'age') / 4 + 4;
      rows.push({ label: 'physiology.r.aaExpected', value: expected, unit: 'mmHg' });
      steps.push({ key: 'physiology.s.aaExpected', vars: { age, e: expected } });
    }
  }
  return { rows, steps, latex };
}

/** Severinghaus (1979): S = 1 / (23400 / (P³ + 150 P) + 1), with P in mmHg. */
export const severinghaus = (p: number): number => (p <= 0 ? 0 : 1 / (23400 / (p ** 3 + 150 * p) + 1));

/** The standard-condition PO₂ that gives the same saturation (Severinghaus 1979). */
export const virtualPo2 = (p: number, ph: number, pco2: number, celsius: number): number =>
  p * 10 ** (0.024 * (37 - celsius) + 0.4 * (ph - 7.4) + 0.06 * Math.log10(40 / pco2));

export function contentResult(hb: number, sao2: number, pao2: number, co: number | null): CalcResult {
  nonNegative(hb, 'Hb');
  within(sao2, 'SaO₂', 0, 1);
  nonNegative(pao2, 'PaO₂');
  const bound = 1.34 * hb * sao2;
  const dissolved = 0.003 * pao2;
  const content = bound + dissolved;
  const rows: ResultRow[] = [
    { label: 'physiology.r.cao2', value: content, unit: 'mL/dL' },
    { label: 'physiology.r.bound', value: bound, unit: 'mL/dL' },
    { label: 'physiology.r.dissolved', value: dissolved, unit: 'mL/dL' },
  ];
  const latex = 'C_aO_2 = 1.34\\,Hb\\,S_aO_2 + 0.003\\,P_aO_2';
  const steps: Step[] = [
    { key: 'physiology.s.content', vars: { hb, s: sao2, p: pao2, b: bound, d: dissolved, c: content }, math: latex },
  ];
  if (co !== null) {
    const delivery = positive(co, 'CO') * content * 10;
    rows.push({ label: 'physiology.r.do2', value: delivery, unit: 'mL/min' });
    steps.push({ key: 'physiology.s.delivery', vars: { co, c: content, d: delivery } });
  }
  return { rows, steps, latex };
}

export function dissociationResult(po2: number, ph: number, pco2: number, celsius: number): CalcResult {
  nonNegative(po2, 'PO₂');
  within(ph, 'pH', 6.5, 8);
  positive(pco2, 'PCO₂');
  within(celsius, 'T', 20, 45);
  const virtual = virtualPo2(po2, ph, pco2, celsius);
  const s = severinghaus(virtual);
  const shift = virtualPo2(1, ph, pco2, celsius);
  // P50 at standard conditions solves S = 0.5; the shifted P50 divides it by the same factor.
  const p50std = brent((p) => severinghaus(p) - 0.5, 1, 100);
  const p50 = p50std / shift;
  const shifted = ph !== 7.4 || pco2 !== 40 || celsius !== 37;
  const xs = Array.from({ length: 121 }, (_, i) => (120 * i) / 120);
  return {
    rows: [
      { label: 'physiology.r.saturation', vars: { p: po2 }, value: 100 * s, unit: '%' },
      { label: 'physiology.r.p50', value: p50, unit: 'mmHg' },
      { label: 'physiology.r.virtual', value: virtual, unit: 'mmHg' },
    ],
    steps: [
      {
        key: 'physiology.s.virtual',
        vars: { p: po2, ph, c: pco2, t: celsius, v: virtual },
        math: 'P_{virtual} = P \\cdot 10^{0.024(37 - T) + 0.40(pH - 7.40) + 0.06\\log_{10}(40/P_{CO_2})}',
      },
      {
        key: 'physiology.s.severinghaus',
        vars: { v: virtual, s: 100 * s },
        math: 'S = \\frac{1}{23400 / (P^3 + 150P) + 1}',
      },
      { key: 'physiology.s.p50', vars: { p: p50, std: p50std } },
    ],
    latex: 'S = \\frac{1}{23400 / (P^3 + 150P) + 1}',
    notes: [{ key: shifted ? (p50 > p50std ? 'physiology.n.right' : 'physiology.n.left') : 'physiology.n.standard' }],
    source: 'physiology.src.severinghaus',
    plots: [
      {
        title: 'physiology.p.dissociation',
        x: { label: 'physiology.p.po2' },
        y: { label: 'physiology.p.sat', min: 0, max: 100 },
        series: [
          { name: 'physiology.p.standard', points: xs.map((p) => [p, 100 * severinghaus(p)] as Point) },
          ...(shifted
            ? [
                {
                  name: 'physiology.p.shifted' as const,
                  style: 'dashed' as const,
                  points: xs.map((p) => [p, 100 * severinghaus(p * shift)] as Point),
                },
              ]
            : []),
        ],
      },
    ],
  };
}

export function ventilationResult(
  vt: number,
  rr: number,
  vd: number | null,
  paco2: number | null,
  peco2: number | null,
): CalcResult {
  positive(vt, 'VT');
  positive(rr, 'RR');
  const ve = (vt * rr) / 1000;
  const rows: ResultRow[] = [{ label: 'physiology.r.ve', value: ve, unit: 'L/min' }];
  const steps: Step[] = [{ key: 'physiology.s.ve', vars: { vt, rr, ve } }];
  let dead = vd;
  if (paco2 !== null || peco2 !== null) {
    if (paco2 === null || peco2 === null) throw new LsError('physiology.e.bohrPair');
    positive(paco2, 'PaCO₂');
    nonNegative(peco2, 'PECO₂');
    if (!(peco2 < paco2)) throw new LsError('physiology.e.bohr');
    const ratio = (paco2 - peco2) / paco2;
    dead = ratio * vt;
    rows.push({ label: 'physiology.r.vdvt', value: ratio });
    steps.push({
      key: 'physiology.s.bohr',
      vars: { a: paco2, e: peco2, r: ratio, vd: dead },
      math: '\\frac{V_D}{V_T} = \\frac{P_aCO_2 - P_ECO_2}{P_aCO_2}',
    });
  }
  if (dead !== null) {
    nonNegative(dead, 'VD');
    if (!(dead < vt)) throw new LsError('physiology.e.deadSpace');
    const va = ((vt - dead) * rr) / 1000;
    rows.push({ label: 'physiology.r.va', value: va, unit: 'L/min' });
    steps.push({ key: 'physiology.s.va', vars: { vt, vd: dead, rr, va } });
  }
  return { rows, steps, latex: '\\dot V_A = (V_T - V_D) \\times RR' };
}

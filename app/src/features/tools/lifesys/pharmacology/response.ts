// Release kinetics from a dosage form, and drug response: the sigmoid Emax model, receptor occupancy, the
// therapeutic index, and the effect over time through an effect compartment.
import { LsError, nonNegative, positive, within } from '../num/errors';
import { levenberg } from '../num/fit';
import { dopri } from '../num/ode';
import type { CalcResult, Step } from '../types';
import { type Point, curve, COURSEWORK } from './shared';

type Release = 'zero' | 'first' | 'higuchi' | 'peppas';
const RELEASE_FORMULA: Record<Release, string> = {
  zero: 'Q = k t',
  first: 'Q = 1 − e^(−k t)',
  higuchi: 'Q = k √t',
  peppas: 'Q = k tⁿ',
};

/** Fits zero-order, first-order, Higuchi, and Korsmeyer-Peppas models to the fraction released over time. */
export function releaseResult(rows: readonly (readonly number[])[]): CalcResult {
  if (rows.some((r) => r.length < 2)) throw new LsError('pharmacology.e.columns');
  const data = rows.filter(([t]) => t > 0);
  if (data.length < 3) throw new LsError('errors.points', { min: 3 });
  data.forEach(([, q]) => within(q, 'Q', 0, 1));
  const last = data[data.length - 1];
  const models: Record<Release, { f: (x: readonly number[], p: readonly number[]) => number; p0: number[] }> = {
    zero: { f: ([t], [k]) => k * t, p0: [last[1] / last[0]] },
    first: { f: ([t], [k]) => 1 - Math.exp(-k * t), p0: [1 / last[0]] },
    higuchi: { f: ([t], [k]) => k * Math.sqrt(t), p0: [last[1] / Math.sqrt(last[0])] },
    peppas: { f: ([t], [k, n]) => k * t ** n, p0: [Math.max(data[0][1], 1e-3) / Math.sqrt(data[0][0]), 0.5] },
  };
  // The Korsmeyer-Peppas law holds for the first 60% released, so it is fitted there when 3 points allow.
  const early = data.filter(([, q]) => q <= 0.6);
  const fits = (Object.keys(models) as Release[]).map((name) => {
    const use = name === 'peppas' && early.length >= 3 ? early : data;
    const y = use.map((r) => r[1]);
    const fit = levenberg(
      models[name].f,
      use.map((r) => [r[0]]),
      y,
      models[name].p0,
    );
    const mean = y.reduce((s, v) => s + v, 0) / y.length;
    const sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
    return { name, fit, r2: sst > 0 ? 1 - fit.sse / sst : 1 };
  });
  const peppas = fits.find((f) => f.name === 'peppas')!;
  const n = peppas.fit.params[1];
  const mechanism = n <= 0.55 ? 'fickian' : n < 0.95 ? 'anomalous' : 'caseII';
  const best = fits.slice(0, 3).reduce((a, b) => (b.r2 > a.r2 ? b : a));
  const tEnd = Math.max(...data.map((r) => r[0]));
  return {
    rows: [
      { label: 'pharmacology.r.peppasN', value: n },
      { label: 'pharmacology.r.peppasK', value: peppas.fit.params[0] },
      { label: 'pharmacology.r.best', value: '', word: `pharmacology.o.${best.name}` },
    ],
    steps: [
      { key: 'pharmacology.s.release', vars: { n: data.length } },
      { key: 'pharmacology.s.peppas', vars: { n, m: peppas.fit.dof + 2 }, math: '\\frac{M_t}{M_\\infty} = k t^n' },
    ],
    notes: [{ key: `pharmacology.n.${mechanism}` }, { key: 'pharmacology.n.slab' }],
    latex: '\\frac{M_t}{M_\\infty} = k t^n',
    table: {
      header: [
        { key: 'pharmacology.t.model' },
        { key: 'pharmacology.t.k' },
        { key: 'pharmacology.t.r2' },
        { key: 'pharmacology.t.aic' },
      ],
      rows: fits.map((f) => [RELEASE_FORMULA[f.name], f.fit.params[0], f.r2, f.fit.aic]),
    },
    plots: [
      {
        title: 'pharmacology.p.release',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.fraction', min: 0 },
        series: [
          { name: 'pharmacology.p.data', points: data.map((r) => [r[0], r[1]] as Point), style: 'points' },
          ...fits.map((f) => ({
            name: `pharmacology.o.${f.name}` as const,
            points: curve(tEnd, (t) => models[f.name].f([t], f.fit.params), 80),
          })),
        ],
      },
    ],
  };
}

/** The sigmoid Emax model E = E0 + Emax Cⁿ / (EC50ⁿ + Cⁿ); n = 1 is the plain Emax model. */
export const emax = (c: number, e0: number, em: number, ec50: number, n = 1): number =>
  e0 + (em * c ** n) / (ec50 ** n + c ** n);

export function pdResult(
  c: number,
  e0: number,
  em: number,
  ec50: number,
  n: number,
  kd: number | null,
  td50: number | null,
  ed50: number | null,
): CalcResult {
  nonNegative(c, 'C');
  positive(ec50, 'EC50');
  positive(n, 'n');
  const effect = emax(c, e0, em, ec50, n);
  const latex = 'E = E_0 + \\frac{E_{max} C^n}{EC_{50}^n + C^n}';
  const rows: CalcResult['rows'] = [
    { label: 'pharmacology.r.effect', value: effect },
    { label: 'pharmacology.r.fractionMax', value: (100 * (effect - e0)) / em, unit: '%' },
  ];
  if (em === 0) rows.pop();
  const steps: Step[] = [{ key: 'pharmacology.s.emax', vars: { c, e0, em, ec: ec50, n, E: effect }, math: latex }];
  if (kd !== null) {
    const occupancy = c / (c + positive(kd, 'Kd'));
    rows.push({ label: 'pharmacology.r.occupancy', value: 100 * occupancy, unit: '%' });
    steps.push({ key: 'pharmacology.s.occupancy', vars: { c, kd, f: occupancy }, math: 'f = \\frac{C}{C + K_d}' });
  }
  if (td50 !== null || ed50 !== null) {
    if (td50 === null || ed50 === null) throw new LsError('pharmacology.e.tiPair');
    const ti = positive(td50, 'TD50') / positive(ed50, 'ED50');
    rows.push({ label: 'pharmacology.r.ti', value: ti });
    steps.push({ key: 'pharmacology.s.ti', vars: { t: td50, e: ed50, ti }, math: 'TI = \\frac{TD_{50}}{ED_{50}}' });
  }
  const top = Math.max(c, ec50) * 100;
  const low = ec50 / 100;
  return {
    rows,
    steps,
    notes: [COURSEWORK],
    latex,
    plots: [
      {
        title: 'pharmacology.p.emax',
        x: { label: 'pharmacology.p.c', log: true },
        y: { label: 'pharmacology.p.effect' },
        series: [
          {
            name: 'pharmacology.p.effectSeries',
            points: Array.from({ length: 101 }, (_, i) => {
              const x = low * (top / low) ** (i / 100);
              return [x, emax(x, e0, em, ec50, n)] as Point;
            }),
          },
        ],
      },
    ],
  };
}

export interface PkPd {
  dose: number;
  V: number;
  k: number;
  ke0: number;
  e0: number;
  em: number;
  ec50: number;
  n: number;
  t: number;
}

/** Effect over time after an IV bolus, through an effect compartment with rate ke0 (hysteresis). */
export function pkpdResult(p: PkPd): CalcResult {
  positive(p.dose, 'D');
  positive(p.V, 'V');
  positive(p.k, 'k');
  positive(p.ke0, 'ke0');
  positive(p.ec50, 'EC50');
  positive(p.n, 'n');
  positive(p.t, 't');
  const cp = (t: number) => (p.dose / p.V) * Math.exp(-p.k * t);
  const sol = dopri((tt, [ce]) => [p.ke0 * (cp(tt) - ce)], [0], 0, p.t, { maxStep: p.t / 300 });
  const effect = sol.y.map((y) => emax(Math.max(y[0], 0), p.e0, p.em, p.ec50, p.n));
  const peak = effect.indexOf(p.em >= 0 ? Math.max(...effect) : Math.min(...effect));
  const latex = '\\frac{dC_e}{dt} = k_{e0}(C_p - C_e)';
  return {
    rows: [
      { label: 'pharmacology.r.peakEffect', value: effect[peak] },
      { label: 'pharmacology.r.peakTime', value: sol.t[peak], unit: 'h' },
      { label: 'pharmacology.r.ceMax', value: sol.y[peak][0], unit: 'mg/L' },
    ],
    steps: [
      { key: 'pharmacology.s.plasma', vars: { D: p.dose, V: p.V, k: p.k }, math: 'C_p = \\frac{D}{V} e^{-kt}' },
      { key: 'pharmacology.s.ke0', vars: { k: p.ke0 }, math: latex },
      { key: 'pharmacology.s.pkpdPeak', vars: { t: sol.t[peak], E: effect[peak] } },
    ],
    notes: [{ key: 'pharmacology.n.hysteresis' }, COURSEWORK],
    latex,
    plots: [
      {
        title: 'pharmacology.p.pkpd',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.effect' },
        series: [{ name: 'pharmacology.p.effectSeries', points: sol.t.map((tt, i) => [tt, effect[i]] as Point) }],
      },
      {
        title: 'pharmacology.p.hysteresis',
        x: { label: 'pharmacology.p.cp' },
        y: { label: 'pharmacology.p.effect' },
        series: [{ name: 'pharmacology.p.loop', points: sol.t.map((tt, i) => [cp(tt), effect[i]] as Point) }],
      },
    ],
  };
}

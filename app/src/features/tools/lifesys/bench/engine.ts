// Bench calculations: solutions and dilutions, buffer recipes by Henderson-Hasselbalch, centrifuge force, cell
// counts and seeding, plate counts, multiplicity of infection, growth rates, qPCR, microscopy, and calibration
// curves. Units arrive in the base units of ../units.ts: mL for volumes, mol/L for concentrations.
import { LsError, nonNegative, positive, whole, within } from '../num/errors';
import { lineFit } from '../num/fit';
import { solveLinear } from '../num/linalg';
import type { CalcResult } from '../types';

/** Grams of solute for c mol/L in v mL of a compound of molar mass mm g/mol. */
export const massFor = (c: number, vMl: number, mm: number): number => c * (vMl / 1000) * mm;

export function massResult(c: number, vMl: number, mm: number): CalcResult {
  positive(c, 'c');
  positive(vMl, 'V');
  positive(mm, 'M');
  const g = massFor(c, vMl, mm);
  return {
    rows: [
      { label: 'bench.r.mass', value: g, unit: 'g' },
      { label: 'bench.r.moles', value: c * (vMl / 1000) * 1000, unit: 'mmol' },
    ],
    steps: [
      { key: 'bench.s.moles', vars: { c, V: vMl / 1000, n: c * (vMl / 1000) }, math: 'n = cV' },
      { key: 'bench.s.mass', vars: { n: c * (vMl / 1000), M: mm, m: g }, math: 'm = nM' },
    ],
    latex: 'm = c\\,V\\,M',
  };
}

export type Percent = 'wv' | 'vv' | 'ppm' | 'ppb';

/** The amount of solute for a percent or parts-per concentration in v mL (aqueous, mass per volume for ppm). */
export function percentResult(kind: Percent, value: number, vMl: number): CalcResult {
  positive(value, 'x');
  positive(vMl, 'V');
  if ((kind === 'wv' || kind === 'vv') && value > 100) throw new LsError('bench.e.percent');
  const amount = {
    wv: (value * vMl) / 100,
    vv: (value * vMl) / 100,
    ppm: value * (vMl / 1000),
    ppb: value * (vMl / 1000),
  }[kind];
  const unit = { wv: 'g', vv: 'mL', ppm: 'mg', ppb: 'µg' }[kind];
  return {
    rows: [{ label: `bench.r.pct.${kind}`, value: amount, unit }],
    steps: [{ key: `bench.s.pct.${kind}`, vars: { x: value, V: vMl, a: amount } }],
  };
}

/** Converts a concentration between mol/L, g/L, % w/v, ppm, and (with the solution's density) molality. */
export function convertResult(cMolar: number, mm: number, density: number): CalcResult {
  positive(cMolar, 'c');
  positive(mm, 'M');
  positive(density, 'ρ');
  const gPerL = cMolar * mm;
  const solventKgPerL = density - gPerL / 1000;
  if (solventKgPerL <= 0) throw new LsError('bench.e.density');
  return {
    rows: [
      { label: 'bench.r.molar', value: cMolar, unit: 'mol/L' },
      { label: 'bench.r.gPerL', value: gPerL, unit: 'g/L' },
      { label: 'bench.r.percentWv', value: gPerL / 10, unit: '% w/v' },
      { label: 'bench.r.ppm', value: gPerL * 1000, unit: 'mg/L' },
      { label: 'bench.r.molality', value: cMolar / solventKgPerL, unit: 'mol/kg' },
    ],
    steps: [
      { key: 'bench.s.gPerL', vars: { c: cMolar, M: mm, g: gPerL } },
      { key: 'bench.s.molality', vars: { rho: density, g: gPerL, kg: solventKgPerL, b: cMolar / solventKgPerL } },
    ],
    notes: [{ key: 'bench.n.ppm' }],
  };
}

/** C1 V1 = C2 V2 with exactly one value missing (null). Volumes in mL; concentrations in any one unit. */
export function dilution(c1: number | null, v1: number | null, c2: number | null, v2: number | null): CalcResult {
  const known = [c1, v1, c2, v2].filter((v) => v !== null);
  if (known.length !== 3) throw new LsError('bench.e.oneBlank');
  known.forEach((v) => positive(v as number, 'C, V'));
  const C1 = c1 ?? ((c2 as number) * (v2 as number)) / (v1 as number);
  const V1 = v1 ?? ((c2 as number) * (v2 as number)) / (c1 as number);
  const C2 = c2 ?? ((c1 as number) * (v1 as number)) / (v2 as number);
  const V2 = v2 ?? ((c1 as number) * (v1 as number)) / (c2 as number);
  if (C2 > C1 * (1 + 1e-12)) throw new LsError('bench.e.concentrate');
  return {
    rows: [
      { label: 'bench.r.c1', value: C1 },
      { label: 'bench.r.v1', value: V1, unit: 'mL' },
      { label: 'bench.r.c2', value: C2 },
      { label: 'bench.r.v2', value: V2, unit: 'mL' },
      { label: 'bench.r.diluent', value: V2 - V1, unit: 'mL' },
    ],
    steps: [
      { key: 'bench.s.dilution', vars: { c1: C1, v1: V1, c2: C2, v2: V2 }, math: 'C_1 V_1 = C_2 V_2' },
      { key: 'bench.s.diluent', vars: { v1: V1, v2: V2, d: V2 - V1 } },
    ],
    latex: 'C_1 V_1 = C_2 V_2',
  };
}

/** A serial dilution: n tubes, each diluted by `factor` into a final volume of vMl. */
export function serialResult(c0: number, factor: number, steps: number, vMl: number): CalcResult {
  positive(c0, 'C₀');
  if (!(factor > 1)) throw new LsError('bench.e.factor');
  whole(steps, 'n', 1);
  if (steps > 30) throw new LsError('errors.range', { name: 'n', low: 1, high: 30 });
  positive(vMl, 'V');
  const transfer = vMl / factor;
  const rows = Array.from({ length: steps }, (_, i) => {
    const k = i + 1;
    return [k, `1:${factor ** k}`, c0 / factor ** k, transfer, vMl - transfer];
  });
  return {
    rows: [
      { label: 'bench.r.transfer', value: transfer, unit: 'mL' },
      { label: 'bench.r.diluentEach', value: vMl - transfer, unit: 'mL' },
      { label: 'bench.r.lastConc', value: c0 / factor ** steps },
    ],
    steps: [
      { key: 'bench.s.transfer', vars: { V: vMl, f: factor, t: transfer, d: vMl - transfer } },
      { key: 'bench.s.serialConc', vars: { c0, f: factor } },
    ],
    table: {
      header: [
        { key: 'bench.t.tube' },
        { key: 'bench.t.dilution' },
        { key: 'bench.t.conc' },
        { key: 'bench.t.transfer' },
        { key: 'bench.t.diluent' },
      ],
      rows,
    },
  };
}

/** A master mix: each component's volume per reaction, times reactions plus overage. */
export function masterMixResult(
  labels: readonly string[],
  perReaction: readonly number[],
  n: number,
  overage: number,
): CalcResult {
  whole(n, 'n', 1);
  within(overage, '%', 0, 100);
  perReaction.forEach((v) => nonNegative(v, 'V'));
  const scale = n * (1 + overage / 100);
  const totals = perReaction.map((v) => v * scale);
  const sum = totals.reduce((s, v) => s + v, 0);
  return {
    rows: [
      { label: 'bench.r.scale', value: scale },
      { label: 'bench.r.mixTotal', value: sum, unit: 'µL' },
    ],
    steps: [{ key: 'bench.s.mix', vars: { n, o: overage, s: scale } }],
    table: {
      header: [{ key: 'bench.t.component' }, { key: 'bench.t.perReaction' }, { key: 'bench.t.total' }],
      rows: totals.map((t, i) => [labels[i] || String(i + 1), perReaction[i], t]),
    },
  };
}

/** A buffer by Henderson-Hasselbalch: acid and base forms for a target pH, total concentration, and volume. */
export function bufferResult(
  pH: number,
  pKa: number,
  cTotal: number,
  vMl: number,
  acidStock: number | null,
  baseStock: number | null,
): CalcResult {
  within(pH, 'pH', 0, 14);
  within(pKa, 'pKa', -2, 16);
  positive(cTotal, 'c');
  positive(vMl, 'V');
  const ratio = 10 ** (pH - pKa);
  const acidFraction = 1 / (1 + ratio);
  const total = cTotal * vMl; // mmol
  const acid = total * acidFraction;
  const base = total - acid;
  const rows: CalcResult['rows'] = [
    { label: 'bench.r.ratio', value: ratio },
    { label: 'bench.r.acidFraction', value: acidFraction },
    { label: 'bench.r.acid', value: acid, unit: 'mmol' },
    { label: 'bench.r.base', value: base, unit: 'mmol' },
  ];
  const steps: CalcResult['steps'] = [
    {
      key: 'bench.s.hh',
      vars: { pH, pKa, r: ratio },
      math: '\\frac{[A^-]}{[HA]} = 10^{\\mathrm{pH} - \\mathrm{p}K_a}',
    },
    { key: 'bench.s.split', vars: { n: total, f: acidFraction, a: acid, b: base } },
  ];
  if (acidStock !== null && baseStock !== null) {
    positive(acidStock, 'acid');
    positive(baseStock, 'base');
    const va = acid / acidStock;
    const vb = base / baseStock;
    if (va + vb > vMl) throw new LsError('bench.e.stocks');
    rows.push(
      { label: 'bench.r.acidVolume', value: va, unit: 'mL' },
      { label: 'bench.r.baseVolume', value: vb, unit: 'mL' },
      { label: 'bench.r.water', value: vMl - va - vb, unit: 'mL' },
    );
    steps.push({
      key: 'bench.s.stocks',
      vars: { a: acid, ca: acidStock, va, b: base, cb: baseStock, vb, w: vMl - va - vb },
    });
  }
  return {
    rows,
    steps,
    latex: '\\mathrm{pH} = \\mathrm{p}K_a + \\log_{10}\\frac{[A^-]}{[HA]}',
    notes: [{ key: 'bench.n.buffer' }],
  };
}

/** Relative centrifugal force from rpm and radius in cm, and back. */
export const rcf = (rpm: number, rCm: number): number => 1.118e-5 * rCm * rpm * rpm;
export const rpmFor = (g: number, rCm: number): number => Math.sqrt(g / (1.118e-5 * rCm));

export function centrifugeResult(mode: 'rcf' | 'rpm', value: number, rCm: number): CalcResult {
  positive(value, mode === 'rcf' ? 'rpm' : 'g');
  positive(rCm, 'r');
  const out = mode === 'rcf' ? rcf(value, rCm) : rpmFor(value, rCm);
  return {
    rows: [
      mode === 'rcf'
        ? { label: 'bench.r.rcf', value: out, unit: '× g' }
        : { label: 'bench.r.rpm', value: out, unit: 'rpm' },
    ],
    steps: [
      {
        key: mode === 'rcf' ? 'bench.s.rcf' : 'bench.s.rpm',
        vars: { v: value, r: rCm, out },
        math: '\\mathrm{RCF} = 1.118 \\times 10^{-5}\\, r\\, N^2',
      },
    ],
    latex: '\\mathrm{RCF} = 1.118 \\times 10^{-5}\\, r\\, N^2',
  };
}

/** Cells per mL from a hemocytometer: mean count per large square × dilution × 10⁴. */
export function hemocytometerResult(
  live: number,
  dead: number,
  squares: number,
  dilution: number,
  volumeMl: number | null,
): CalcResult {
  nonNegative(live, 'live');
  nonNegative(dead, 'dead');
  whole(squares, 'squares', 1);
  if (!(dilution >= 1)) throw new LsError('bench.e.dilutionFactor');
  const perMl = (live / squares) * dilution * 1e4;
  const viability = live + dead > 0 ? (100 * live) / (live + dead) : NaN;
  const rows: CalcResult['rows'] = [
    { label: 'bench.r.cellsPerMl', value: perMl, unit: 'cells/mL' },
    { label: 'bench.r.viability', value: viability, unit: '%' },
  ];
  if (volumeMl !== null) rows.push({ label: 'bench.r.cellsTotal', value: perMl * positive(volumeMl, 'V') });
  return {
    rows,
    steps: [
      {
        key: 'bench.s.hemo',
        vars: { n: live, q: squares, d: dilution, c: perMl },
        math: 'c = \\frac{n}{q}\\, d \\times 10^4',
      },
      { key: 'bench.s.viability', vars: { l: live, d: dead, v: viability } },
    ],
    notes: [{ key: 'bench.n.hemo' }],
  };
}

/** Cells to seed: density per cm² × area per well × wells, and the suspension volume at a cell concentration. */
export function seedingResult(
  density: number,
  areaCm2: number,
  wells: number,
  perMl: number,
  extra: number,
): CalcResult {
  positive(density, 'density');
  positive(areaCm2, 'A');
  whole(wells, 'wells', 1);
  positive(perMl, 'c');
  within(extra, '%', 0, 100);
  const cells = density * areaCm2 * wells * (1 + extra / 100);
  return {
    rows: [
      { label: 'bench.r.cellsNeeded', value: cells },
      { label: 'bench.r.suspension', value: cells / perMl, unit: 'mL' },
      { label: 'bench.r.perWell', value: density * areaCm2 },
    ],
    steps: [
      {
        key: 'bench.s.seed',
        vars: { D: density, A: areaCm2, w: wells, e: extra, n: cells, c: perMl, v: cells / perMl },
      },
    ],
  };
}

/** Colony- or plaque-forming units per mL: colonies / (volume plated × dilution). */
export function platesResult(colonies: number, platedMl: number, dilution: number, kind: 'cfu' | 'pfu'): CalcResult {
  nonNegative(colonies, 'colonies');
  positive(platedMl, 'V');
  positive(dilution, 'dilution');
  if (dilution > 1) throw new LsError('bench.e.dilutionFraction');
  const titer = colonies / (platedMl * dilution);
  const countable = kind === 'cfu' ? colonies >= 30 && colonies <= 300 : colonies >= 10 && colonies <= 100;
  return {
    rows: [
      {
        label: kind === 'cfu' ? 'bench.r.cfu' : 'bench.r.pfu',
        value: titer,
        unit: kind === 'cfu' ? 'CFU/mL' : 'PFU/mL',
      },
    ],
    steps: [
      {
        key: 'bench.s.plate',
        vars: { n: colonies, v: platedMl, d: dilution, t: titer },
        math: '\\frac{\\text{colonies}}{V \\times \\text{dilution}}',
      },
    ],
    notes: [
      { key: countable ? 'bench.n.countable' : kind === 'cfu' ? 'bench.n.notCountable' : 'bench.n.notCountablePfu' },
    ],
  };
}

/** Poisson fractions for a multiplicity of infection. */
export function moi(m: number) {
  nonNegative(m, 'MOI');
  const none = Math.exp(-m);
  return { none, infected: 1 - none, single: m * none, multiple: 1 - none - m * none };
}

export function moiResult(
  m: number | null,
  cells: number | null,
  titer: number | null,
  volumeMl: number | null,
): CalcResult {
  let value = m;
  const steps: CalcResult['steps'] = [];
  if (value === null) {
    if (cells === null || titer === null || volumeMl === null) throw new LsError('bench.e.moi');
    value = (positive(titer, 'titer') * positive(volumeMl, 'V')) / positive(cells, 'cells');
    steps.push({ key: 'bench.s.moiFrom', vars: { t: titer, v: volumeMl, c: cells, m: value } });
  }
  const f = moi(value);
  steps.push({ key: 'bench.s.poisson', vars: { m: value, p0: f.none, p: f.infected }, math: 'P(0) = e^{-m}' });
  return {
    rows: [
      { label: 'bench.r.moi', value },
      { label: 'bench.r.uninfected', value: f.none },
      { label: 'bench.r.infected', value: f.infected },
      { label: 'bench.r.single', value: f.single },
      { label: 'bench.r.multiple', value: f.multiple },
    ],
    steps,
    latex: 'P(k) = \\frac{m^k e^{-m}}{k!}',
  };
}

/** Growth rate and doubling time from a log-linear fit of counts or OD over time. */
export function growth(times: readonly number[], values: readonly number[]) {
  if (times.length < 2) throw new LsError('errors.points', { min: 2 });
  values.forEach((v) => positive(v, 'N'));
  const fit = lineFit(times, values.map(Math.log));
  if (!(fit.slope > 0)) throw new LsError('bench.e.noGrowth');
  return { mu: fit.slope, doubling: Math.LN2 / fit.slope, r2: fit.r2, se: fit.seSlope, intercept: fit.intercept };
}

export function growthResult(
  rows: readonly (readonly number[])[],
  from: number | null,
  to: number | null,
  unit: string,
): CalcResult {
  const used = rows.filter(([t]) => (from === null || t >= from) && (to === null || t <= to));
  const g = growth(
    used.map((r) => r[0]),
    used.map((r) => r[1]),
  );
  const fitted = used.map(([t]) => [t, Math.exp(g.intercept + g.mu * t)] as [number, number]);
  return {
    rows: [
      { label: 'bench.r.mu', value: g.mu, unit: `/${unit}` },
      { label: 'bench.r.doubling', value: g.doubling, unit },
      { label: 'bench.r.r2', value: g.r2 },
    ],
    steps: [
      { key: 'bench.s.logFit', vars: { n: used.length, mu: g.mu, se: g.se }, math: '\\ln N = \\ln N_0 + \\mu t' },
      { key: 'bench.s.doubling', vars: { mu: g.mu, td: g.doubling }, math: 't_d = \\ln 2 / \\mu' },
    ],
    latex: 't_d = \\frac{\\ln 2}{\\mu}',
    plots: [
      {
        title: 'bench.p.growth',
        x: { label: 'bench.p.time', vars: { unit } },
        y: { label: 'bench.p.amount', log: true },
        series: [
          { name: 'bench.p.data', points: rows.map(([t, n]) => [t, n] as [number, number]), style: 'points' },
          { name: 'bench.p.fit', points: fitted },
        ],
      },
    ],
  };
}

/** The 2^-ΔΔCt fold change, and Pfaffl's efficiency-corrected ratio. */
export function ddct(targetTreated: number, refTreated: number, targetControl: number, refControl: number) {
  const dTreated = targetTreated - refTreated;
  const dControl = targetControl - refControl;
  const dd = dTreated - dControl;
  return { dTreated, dControl, dd, fold: 2 ** -dd };
}

export function ddctResult(tt: number, rt: number, tc: number, rc: number): CalcResult {
  const r = ddct(tt, rt, tc, rc);
  return {
    rows: [
      { label: 'bench.r.ddct', value: r.dd },
      { label: 'bench.r.fold', value: r.fold },
    ],
    steps: [
      { key: 'bench.s.dct', vars: { tt, rt, d1: r.dTreated, tc, rc, d0: r.dControl } },
      { key: 'bench.s.ddct', vars: { dd: r.dd, f: r.fold }, math: '\\text{fold} = 2^{-\\Delta\\Delta C_t}' },
    ],
    latex: '\\text{fold} = 2^{-\\Delta\\Delta C_t}',
    notes: [{ key: 'bench.n.ddct' }],
  };
}

export function pfafflResult(eTarget: number, eRef: number, dTarget: number, dRef: number): CalcResult {
  within(eTarget, 'E', 1, 2.5);
  within(eRef, 'E', 1, 2.5);
  const ratio = eTarget ** dTarget / eRef ** dRef;
  return {
    rows: [{ label: 'bench.r.pfaffl', value: ratio }],
    steps: [
      {
        key: 'bench.s.pfaffl',
        vars: { et: eTarget, dt: dTarget, er: eRef, dr: dRef, r: ratio },
        math: '\\text{ratio} = \\frac{E_{t}^{\\Delta C_t(t)}}{E_{r}^{\\Delta C_t(r)}}',
      },
    ],
    latex: '\\text{ratio} = \\frac{E_{target}^{\\Delta C_{t,target}}}{E_{ref}^{\\Delta C_{t,ref}}}',
  };
}

/** Amplification efficiency from a standard-curve slope (Ct against log10 quantity). */
export const efficiency = (slope: number): number => 10 ** (-1 / slope) - 1;

export function standardCurveResult(rows: readonly (readonly number[])[], unknownCt: number | null): CalcResult {
  const xs = rows.map((r) => r[0]);
  const ys = rows.map((r) => r[1]);
  const fit = lineFit(xs, ys);
  if (!(fit.slope < 0)) throw new LsError('bench.e.slope');
  const e = efficiency(fit.slope);
  const out: CalcResult['rows'] = [
    { label: 'bench.r.slope', value: fit.slope },
    { label: 'bench.r.intercept', value: fit.intercept },
    { label: 'bench.r.r2', value: fit.r2 },
    { label: 'bench.r.efficiency', value: 100 * e, unit: '%' },
  ];
  const steps: CalcResult['steps'] = [
    { key: 'bench.s.ctFit', vars: { s: fit.slope, b: fit.intercept, r2: fit.r2 } },
    { key: 'bench.s.efficiency', vars: { s: fit.slope, e: 100 * e }, math: 'E = 10^{-1/\\text{slope}} - 1' },
  ];
  if (unknownCt !== null) {
    const log = (unknownCt - fit.intercept) / fit.slope;
    out.push({ label: 'bench.r.copies', value: 10 ** log });
    steps.push({ key: 'bench.s.copies', vars: { ct: unknownCt, l: log, q: 10 ** log } });
  }
  return {
    rows: out,
    steps,
    latex: 'E = 10^{-1/\\text{slope}} - 1',
    plots: [
      {
        title: 'bench.p.standard',
        x: { label: 'bench.p.logQuantity' },
        y: { label: 'bench.p.ct' },
        series: [
          { name: 'bench.p.data', points: rows.map(([x, y]) => [x, y] as [number, number]), style: 'points' },
          {
            name: 'bench.p.fit',
            points: [Math.min(...xs), Math.max(...xs)].map(
              (x) => [x, fit.intercept + fit.slope * x] as [number, number],
            ),
          },
        ],
      },
    ],
  };
}

/** Total magnification, field of view, and Abbe's resolution limit d = λ/(2 NA). */
export function microscopeResult(
  objective: number,
  eyepiece: number,
  fieldNumber: number | null,
  lambdaNm: number,
  na: number,
): CalcResult {
  positive(objective, 'objective');
  positive(eyepiece, 'eyepiece');
  positive(lambdaNm, 'λ');
  within(na, 'NA', 0.01, 1.7);
  const d = lambdaNm / (2 * na);
  const rows: CalcResult['rows'] = [
    { label: 'bench.r.magnification', value: objective * eyepiece, unit: '×' },
    { label: 'bench.r.abbe', value: d, unit: 'nm' },
  ];
  const steps: CalcResult['steps'] = [
    { key: 'bench.s.magnification', vars: { o: objective, e: eyepiece, m: objective * eyepiece } },
    { key: 'bench.s.abbe', vars: { l: lambdaNm, na, d }, math: 'd = \\frac{\\lambda}{2\\,\\mathrm{NA}}' },
  ];
  if (fieldNumber !== null) {
    const fov = (positive(fieldNumber, 'FN') / objective) * 1000;
    rows.push({ label: 'bench.r.fov', value: fov, unit: 'µm' });
    steps.push({ key: 'bench.s.fov', vars: { fn: fieldNumber, o: objective, f: fov } });
  }
  return { rows, steps, latex: 'd = \\frac{\\lambda}{2\\,\\mathrm{NA}}' };
}

/** Calibrates an eyepiece reticle against a stage micrometer: µm per division, and a scale bar length. */
export function reticleResult(stageUm: number, divisions: number, bar: number | null): CalcResult {
  positive(stageUm, 'stage');
  positive(divisions, 'divisions');
  const perDivision = stageUm / divisions;
  const rows: CalcResult['rows'] = [{ label: 'bench.r.perDivision', value: perDivision, unit: 'µm' }];
  if (bar !== null) rows.push({ label: 'bench.r.barDivisions', value: positive(bar, 'bar') / perDivision });
  return { rows, steps: [{ key: 'bench.s.reticle', vars: { s: stageUm, n: divisions, p: perDivision } }] };
}

/** A linear or quadratic calibration curve, unknowns read back, and LOD = 3.3σ/slope, LOQ = 10σ/slope. */
export function calibrationResult(
  rows: readonly (readonly number[])[],
  degree: 1 | 2,
  unknowns: readonly number[],
  sigma: number | null,
): CalcResult {
  const xs = rows.map((r) => r[0]);
  const ys = rows.map((r) => r[1]);
  let coef: number[];
  let r2: number;
  if (degree === 1) {
    const fit = lineFit(xs, ys);
    coef = [fit.intercept, fit.slope];
    r2 = fit.r2;
  } else {
    if (xs.length < 3) throw new LsError('errors.points', { min: 3 });
    const powers = [0, 1, 2];
    const ata = powers.map((i) => powers.map((j) => xs.reduce((s, x) => s + x ** (i + j), 0)));
    const atb = powers.map((i) => xs.reduce((s, x, k) => s + x ** i * ys[k], 0));
    coef = solveLinear(ata, atb);
    const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
    const sse = xs.reduce((s, x, k) => s + (ys[k] - (coef[0] + coef[1] * x + coef[2] * x * x)) ** 2, 0);
    const sst = ys.reduce((s, y) => s + (y - mean) ** 2, 0);
    r2 = sst === 0 ? 1 : 1 - sse / sst;
  }
  const predict = (x: number) => coef[0] + coef[1] * x + (coef[2] ?? 0) * x * x;
  const invert = (y: number): number => {
    if (degree === 1) return (y - coef[0]) / coef[1];
    const [c, b, a] = coef;
    const disc = b * b - 4 * a * (c - y);
    if (disc < 0) return NaN;
    const roots = [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
    const low = Math.min(...xs);
    const high = Math.max(...xs);
    const span = high - low;
    return roots.find((x) => x >= low - span && x <= high + span) ?? NaN;
  };
  const out: CalcResult['rows'] = [
    { label: 'bench.r.slope', value: coef[1] },
    { label: 'bench.r.intercept', value: coef[0] },
    ...(degree === 2 ? [{ label: 'bench.r.quadratic' as const, value: coef[2] }] : []),
    { label: 'bench.r.r2', value: r2 },
  ];
  const steps: CalcResult['steps'] = [
    { key: degree === 1 ? 'bench.s.calLine' : 'bench.s.calQuad', vars: { n: xs.length, r2 } },
  ];
  if (sigma !== null) {
    positive(sigma, 'σ');
    const slope = Math.abs(coef[1]);
    out.push(
      { label: 'bench.r.lod', value: (3.3 * sigma) / slope },
      { label: 'bench.r.loq', value: (10 * sigma) / slope },
    );
    steps.push({
      key: 'bench.s.lod',
      vars: { s: sigma, m: slope, lod: (3.3 * sigma) / slope, loq: (10 * sigma) / slope },
      math: '\\mathrm{LOD} = \\frac{3.3\\,\\sigma}{S}',
    });
  }
  const unknownRows = unknowns.map((y) => [y, invert(y)]);
  const low = Math.min(...xs);
  const high = Math.max(...xs);
  const curve = Array.from({ length: 41 }, (_, i) => {
    const x = low + ((high - low) * i) / 40;
    return [x, predict(x)] as [number, number];
  });
  return {
    rows: out,
    steps,
    latex: degree === 1 ? 'y = a + bx' : 'y = a + bx + cx^2',
    table: unknownRows.length
      ? { header: [{ key: 'bench.t.signal' }, { key: 'bench.t.estimate' }], rows: unknownRows }
      : undefined,
    plots: [
      {
        title: 'bench.p.calibration',
        x: { label: 'bench.p.concentration' },
        y: { label: 'bench.p.signal' },
        series: [
          { name: 'bench.p.standards', points: rows.map(([x, y]) => [x, y] as [number, number]), style: 'points' },
          { name: 'bench.p.fit', points: curve },
        ],
      },
    ],
  };
}

// Acids, bases, and buffers solved exactly. Every case is one charge balance on [H+]:
//   [H+] + (strong base cation) = [OH-] + C * sum over i of (i * alpha_i)
// for a weak acid H_n A of total concentration C with constants Ka1..Kan. A weak base B is its conjugate acid BH+ with
// Ka = Kw / Kb and a strong base equal to C; a salt of a weak acid is the acid with a strong base equal to C. The
// charge balance has one root, found on the pH scale with Brent's method, so no small-x guess is made.
import { latexNumber, plain } from '../chemText';
import { bracketScan } from '../num';
import { fail } from '../types';
import type { KitStep, Outcome, PlotData, Row } from '../types';

/** The ion product of water at 25 C. */
export const KW = 1e-14;

/** Fractions alpha_0..alpha_n of the species H_n A ... A^n- at hydrogen ion concentration h. */
export function fractions(h: number, ka: readonly number[]): number[] {
  const t: number[] = [1];
  for (let i = 0; i < ka.length; i++) t.push((t[i] * ka[i]) / h);
  const d = t.reduce((s, v) => s + v, 0);
  return t.map((v) => v / d);
}

/** The charge balance residual; it rises with h and is zero at the solution. */
function balance(h: number, ka: readonly number[], C: number, strong: number): number {
  const a = fractions(h, ka);
  const charge = a.reduce((s, v, i) => s + i * v, 0);
  return h + strong - KW / h - C * charge;
}

/** The pH of the solution, or null when it lies outside -3 to 17. */
export function solvePh(ka: readonly number[], C: number, strong: number): number | null {
  const g = (pH: number) => balance(Math.pow(10, -pH), ka, C, strong);
  const roots = bracketScan(g, -3, 17, 4000);
  return roots.length > 0 ? roots[0] : null;
}

/** Names of the species of an acid with n protons: H3A, H2A-, HA2-, A3-. */
export function speciesNames(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= n; i++) {
    const protons = n - i;
    const h = protons === 0 ? '' : protons === 1 ? 'H' : `H${protons}`;
    const charge = i === 0 ? '' : i === 1 ? '-' : `${i}-`;
    out.push(`${h}A${charge}`);
  }
  return out;
}

export interface Constants {
  /** Ka values in order, or Kb values for a base. */
  values: number[];
}

/** Reads "1.8e-5" or "7.1e-3, 6.3e-8, 4.5e-13" (or pKa values when `asP`); null when something is not a number. */
export function parseConstants(text: string, asP: boolean): number[] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(p)) return null;
    const v = Number(p);
    out.push(asP ? Math.pow(10, -v) : v);
  }
  return out;
}

const pHrow = (key: Row['key'], value: number): Row => ({ key, value, digits: 5 });

export interface SolutionInput {
  kind: 'acid' | 'base';
  /** Total concentration of the weak acid or base, mol/L. */
  C: number;
  /** Ka (acid) values in order, or the single Kb of a base. */
  constants: number[];
  /** Strong base added, mol/L (its cation stays in solution). */
  strongBase: number;
  /** Strong acid added, mol/L. */
  strongAcid: number;
}

export function solution(input: SolutionInput): Outcome {
  const { kind, C, strongBase, strongAcid } = input;
  if (!(C >= 0) || !Number.isFinite(C)) return fail('kitChemMat.ab.err.conc');
  if (!(strongBase >= 0) || !(strongAcid >= 0) || !Number.isFinite(strongBase + strongAcid))
    return fail('kitChemMat.ab.err.conc');
  if (input.constants.some((k) => !(k > 0) || !Number.isFinite(k))) return fail('kitChemMat.ab.err.constants');
  if (kind === 'base' && input.constants.length !== 1) return fail('kitChemMat.ab.err.oneKb');
  if (kind === 'acid' && input.constants.length > 3) return fail('kitChemMat.ab.err.tooMany');
  if (C > 0 && input.constants.length === 0) return fail('kitChemMat.ab.err.constants');
  if (C === 0 && strongBase === 0 && strongAcid === 0) return fail('kitChemMat.ab.err.empty');
  const ka = kind === 'base' ? [KW / input.constants[0]] : [...input.constants].sort((a, b) => b - a);
  const strong = (kind === 'base' ? C : 0) + strongBase - strongAcid;
  const n = ka.length;
  const pH = solvePh(ka, C, strong);
  if (pH === null) return fail('kitChemMat.ab.err.range');
  const h = Math.pow(10, -pH);
  const alphas = fractions(h, ka);
  const names = kind === 'base' ? ['BH+', 'B'] : speciesNames(n);
  const ordered = kind === 'base' ? [alphas[0], alphas[1]] : alphas;
  const rows: Row[] = [
    pHrow('kitChemMat.ab.row.pH', pH),
    { key: 'kitChemMat.ab.row.h', value: h, unit: 'mol/L', digits: 5 },
    { key: 'kitChemMat.ab.row.oh', value: KW / h, unit: 'mol/L', digits: 5 },
    pHrow('kitChemMat.ab.row.pOH', 14 - pH),
  ];
  if (C > 0)
    names.forEach((name, i) =>
      rows.push({
        key: 'kitChemMat.ab.row.species',
        keyVars: { name },
        value: C * ordered[i],
        unit: 'mol/L',
        digits: 5,
      }),
    );
  const label = kind === 'base' ? 'B' : 'HA';
  const steps: KitStep[] = [];
  if (C > 0) {
    steps.push({
      key: kind === 'base' ? 'kitChemMat.ab.step.baseEq' : 'kitChemMat.ab.step.acidEq',
      math:
        kind === 'base'
          ? `\\mathrm{B}+\\mathrm{H_2O}\\rightleftharpoons\\mathrm{BH^+}+\\mathrm{OH^-},\\quad K_b=${latexNumber(input.constants[0], 4)}`
          : n === 1
            ? `\\mathrm{HA}\\rightleftharpoons\\mathrm{H^+}+\\mathrm{A^-},\\quad K_a=${latexNumber(ka[0], 4)}`
            : ka.map((k, i) => `K_{a${i + 1}}=${latexNumber(k, 4)}`).join(',\\ '),
    });
  }
  steps.push({
    key: 'kitChemMat.ab.step.balance',
    math: `[\\mathrm{H^+}]+[\\mathrm{cation}]=[\\mathrm{OH^-}]+\\sum_i i\\,[\\mathrm{${label}}_i]`,
  });
  steps.push({
    key: 'kitChemMat.ab.step.root',
    math: `[\\mathrm{H^+}]=${latexNumber(h, 5)}\\ \\mathrm{mol/L},\\quad \\mathrm{pH}=-\\log_{10}[\\mathrm{H^+}]=${plain(pH, 5)}`,
  });
  // The small-x shortcut for a lone weak acid or base, shown for comparison.
  const notes: Solved['notes'] = [{ key: 'kitChemMat.ab.note.ideal' }, { key: 'kitChemMat.ab.note.kw' }];
  if (C > 0 && strong === 0 && n === 1) {
    const kEff = ka[0];
    const x = kind === 'base' ? Math.sqrt((KW / kEff) * C) : Math.sqrt(kEff * C);
    const pHapprox = kind === 'base' ? 14 + Math.log10(x) : -Math.log10(x);
    rows.push({ key: 'kitChemMat.ab.row.approx', value: pHapprox, digits: 5 });
    steps.push({ key: 'kitChemMat.ab.step.approx', vars: { pH: plain(pHapprox, 5) } });
  }
  const plot = C > 0 && kind === 'acid' ? alphaPlot(ka) : undefined;
  return {
    ok: true,
    rows,
    steps,
    notes,
    plot,
    equation: '\\mathrm{pH}=-\\log_{10}[\\mathrm{H^+}]',
  };
}

type Solved = Extract<Outcome, { ok: true }>;

/** The species fractions against pH from 0 to 14. */
export function alphaPlot(ka: readonly number[]): PlotData {
  const names = speciesNames(ka.length);
  const series = names.map((name, i) => ({
    label: 'kitChemMat.ab.plot.series' as const,
    labelVars: { name },
    points: Array.from({ length: 141 }, (_, k) => [k / 10, fractions(Math.pow(10, -k / 10), ka)[i]] as const),
  }));
  return { xLabel: 'kitChemMat.ab.plot.x', yLabel: 'kitChemMat.ab.plot.y', series, alt: 'kitChemMat.ab.plot.alt' };
}

export interface FractionInput {
  constants: number[];
  pH: number;
}

export function speciesAtPh(input: FractionInput): Outcome {
  if (input.constants.length === 0 || input.constants.some((k) => !(k > 0))) return fail('kitChemMat.ab.err.constants');
  if (input.constants.length > 3) return fail('kitChemMat.ab.err.tooMany');
  if (!Number.isFinite(input.pH) || input.pH < -3 || input.pH > 17) return fail('kitChemMat.ab.err.phRange');
  const ka = [...input.constants].sort((a, b) => b - a);
  const h = Math.pow(10, -input.pH);
  const a = fractions(h, ka);
  const names = speciesNames(ka.length);
  const nameOf = (i: number) => names[i];
  return {
    ok: true,
    rows: a.map((v, i): Row => ({ key: 'kitChemMat.ab.row.alpha', keyVars: { name: nameOf(i) }, value: v, digits: 5 })),
    steps: [
      {
        key: 'kitChemMat.ab.step.alphaDef',
        math: [
          '\\alpha_i=\\frac{\\prod_{j\\le i}K_{aj}\\,[\\mathrm{H^+}]^{n-i}}',
          '{[\\mathrm{H^+}]^{n}+K_{a1}[\\mathrm{H^+}]^{n-1}+\\cdots+K_{a1}\\cdots K_{an}}',
        ].join(''),
      },
      {
        key: 'kitChemMat.ab.step.alphaSum',
        math: `\\sum_i\\alpha_i=${plain(
          a.reduce((s, v) => s + v, 0),
          8,
        )}`,
      },
    ],
    notes: [{ key: 'kitChemMat.ab.note.ideal' }],
    plot: alphaPlot(ka),
    equation: '\\alpha_i=\\frac{[\\mathrm{H}_{n-i}\\mathrm{A}^{i-}]}{C}',
  };
}

export interface BufferInput {
  /** pKa-form constant as Ka. */
  Ka: number;
  /** Weak acid form, mol/L. */
  Ca: number;
  /** Conjugate base form, mol/L. */
  Cb: number;
  /** Strong base added to the buffer, mol/L of the buffer solution. */
  addBase: number;
  /** Strong acid added, mol/L. */
  addAcid: number;
}

export function buffer(input: BufferInput): Outcome {
  const { Ka, Ca, Cb, addBase, addAcid } = input;
  if (!(Ka > 0) || !Number.isFinite(Ka)) return fail('kitChemMat.ab.err.constants');
  if (!(Ca >= 0) || !(Cb >= 0) || !(addBase >= 0) || !(addAcid >= 0)) return fail('kitChemMat.ab.err.conc');
  const acid = Ca - addBase + addAcid;
  const base = Cb + addBase - addAcid;
  if (Ca + Cb <= 0) return fail('kitChemMat.ab.err.empty');
  if (acid < 0 || base < 0) return fail('kitChemMat.ab.err.exhausted');
  const C = Ca + Cb;
  const strong = Cb + addBase - addAcid;
  // The strong acid or base consumes the buffer pair first; what is left over is the pair plus any excess.
  const pH = solvePh([Ka], C, strong);
  if (pH === null) return fail('kitChemMat.ab.err.range');
  const h = Math.pow(10, -pH);
  const pKa = -Math.log10(Ka);
  const hh = pKa + Math.log10(base / acid);
  const beta = Math.LN10 * (h + KW / h + (C * Ka * h) / Math.pow(Ka + h, 2));
  return {
    ok: true,
    rows: [
      pHrow('kitChemMat.ab.row.pH', pH),
      { key: 'kitChemMat.ab.row.hh', value: acid === 0 || base === 0 ? '' : hh, digits: 5 },
      { key: 'kitChemMat.ab.row.hhError', value: acid === 0 || base === 0 ? '' : pH - hh, digits: 3 },
      { key: 'kitChemMat.ab.row.capacity', value: beta, unit: 'mol/L per pH', digits: 4 },
      { key: 'kitChemMat.ab.row.ratio', value: acid === 0 ? '' : base / acid, digits: 4 },
    ],
    steps: [
      {
        key: 'kitChemMat.ab.step.hh',
        math: [
          '\\mathrm{pH}=\\mathrm{p}K_a+\\log_{10}\\frac{[\\mathrm{A^-}]}{[\\mathrm{HA}]}',
          `=${plain(pKa, 5)}+\\log_{10}\\frac{${plain(base)}}{${plain(acid)}}`,
          `=${acid === 0 || base === 0 ? '\\text{n/a}' : plain(hh, 5)}`,
        ].join(''),
      },
      { key: 'kitChemMat.ab.step.exact', math: `\\mathrm{pH}_{\\text{exact}}=${plain(pH, 5)}` },
      {
        key: 'kitChemMat.ab.step.capacity',
        math: '\\beta=\\ln 10\\left([\\mathrm{H^+}]+[\\mathrm{OH^-}]+\\frac{C\\,K_a[\\mathrm{H^+}]}{(K_a+[\\mathrm{H^+}])^2}\\right)',
      },
    ],
    notes: [{ key: 'kitChemMat.ab.note.ideal' }, { key: 'kitChemMat.ab.note.dilution' }],
    equation: '\\mathrm{pH}=\\mathrm{p}K_a+\\log_{10}\\frac{[\\mathrm{A^-}]}{[\\mathrm{HA}]}',
  };
}

export interface TitrationInput {
  constants: number[];
  /** Acid concentration, mol/L. */
  C0: number;
  /** Acid volume, L. */
  V0: number;
  /** Strong base titrant concentration, mol/L. */
  Ct: number;
}

/** pH of the acid after `v` liters of strong base: the amounts are diluted into V0 + v. */
export function titrationPh(ka: readonly number[], C0: number, V0: number, Ct: number, v: number): number | null {
  const total = V0 + v;
  return solvePh(ka, (C0 * V0) / total, (Ct * v) / total);
}

export function titration(input: TitrationInput): Outcome {
  const { C0, V0, Ct } = input;
  if (!(C0 > 0) || !(V0 > 0) || !(Ct > 0)) return fail('kitChemMat.ab.err.titrationInputs');
  if (input.constants.length === 0 || input.constants.length > 3 || input.constants.some((k) => !(k > 0)))
    return fail('kitChemMat.ab.err.constants');
  const ka = [...input.constants].sort((a, b) => b - a);
  const n = ka.length;
  const vEq = (C0 * V0) / Ct;
  const rows: Row[] = [];
  const points: [number, number][] = [];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.ab.step.titration',
      math: [
        `V_{\\mathrm{eq},1}=\\frac{C_0V_0}{C_t}=\\frac{(${plain(C0)})(${plain(V0 * 1000)}\\ \\mathrm{mL})}{${plain(Ct)}}`,
        `=${plain(vEq * 1000, 5)}\\ \\mathrm{mL}`,
      ].join(''),
    },
  ];
  const last = n * vEq * 1.25;
  for (let k = 0; k <= 200; k++) {
    const v = (last * k) / 200;
    const pH = titrationPh(ka, C0, V0, Ct, v);
    if (pH !== null) points.push([v * 1000, pH]);
  }
  const start = titrationPh(ka, C0, V0, Ct, 0);
  if (start !== null) rows.push({ key: 'kitChemMat.ab.row.pHstart', value: start, digits: 4 });
  for (let i = 1; i <= n; i++) {
    const half = titrationPh(ka, C0, V0, Ct, (i - 0.5) * vEq);
    const eq = titrationPh(ka, C0, V0, Ct, i * vEq);
    rows.push({ key: 'kitChemMat.ab.row.vEq', keyVars: { i: String(i) }, value: i * vEq, dim: 'volume', digits: 5 });
    if (half !== null)
      rows.push({ key: 'kitChemMat.ab.row.pHhalf', keyVars: { i: String(i) }, value: half, digits: 4 });
    if (eq !== null) rows.push({ key: 'kitChemMat.ab.row.pHeq', keyVars: { i: String(i) }, value: eq, digits: 4 });
  }
  steps.push({ key: 'kitChemMat.ab.step.titrationPoints' });
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.ab.note.ideal' }, { key: 'kitChemMat.ab.note.dilution' }],
    plot: {
      xLabel: 'kitChemMat.ab.plot.volume',
      yLabel: 'kitChemMat.ab.plot.pH',
      series: [{ label: 'kitChemMat.ab.plot.curve', points }],
      alt: 'kitChemMat.ab.plot.titrationAlt',
    },
  };
}

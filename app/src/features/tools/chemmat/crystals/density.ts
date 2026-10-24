// Linear and planar atomic density in simple, body-centered and face-centered cubic crystals, and the conversion between
// three-index and four-index (Miller-Bravais) directions and planes of a hexagonal crystal.
import { latexNumber, plain } from '../chemText';
import { fail } from '../types';
import type { Outcome } from '../types';
import { CELL, parseIndices } from './engine';

export type CubicStructure = 'sc' | 'bcc' | 'fcc';

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const reduce = (v: readonly number[]) => {
  const g = v.reduce((x, y) => gcd(x, y), 0);
  return v.map((x) => x / g);
};
const isCubic = (s: string): s is CubicStructure => s === 'sc' || s === 'bcc' || s === 'fcc';

export interface DensityInput {
  kind: string;
  structure: string;
  /** 'a' or 'R': what the length is. */
  known: string;
  /** Meters. */
  length: number;
  /** [uvw] or (hkl), as typed. */
  indices: string;
}

/**
 * The distance between neighboring lattice points along the primitive direction d (in units of a). A point lies at
 * k d / 2 when its coordinates are all whole (k even) or, for body-centered, all half-odd; for face-centered it needs
 * an even coordinate sum in units of a/2.
 */
export function directionRepeat(structure: CubicStructure, d: readonly number[]): number {
  const length = Math.hypot(d[0], d[1], d[2]);
  if (structure === 'sc') return length;
  if (structure === 'bcc') return d.every((x) => Math.abs(x) % 2 === 1) ? length / 2 : length;
  return (d[0] + d[1] + d[2]) % 2 === 0 ? length / 2 : length;
}

/** The spacing between adjacent lattice planes of the family (hkl), in units of a, for primitive indices. */
export function planeSpacing(structure: CubicStructure, p: readonly number[]): number {
  const base = 1 / Math.hypot(p[0], p[1], p[2]);
  const odd = p.filter((x) => Math.abs(x) % 2 === 1).length;
  if (structure === 'bcc') return (p[0] + p[1] + p[2]) % 2 === 0 ? base : base / 2;
  if (structure === 'fcc') return odd === 0 || odd === 3 ? base : base / 2;
  return base;
}

export function density(input: DensityInput): Outcome {
  if (!isCubic(input.structure)) return fail('kitChemMat.cx.err.densityStructure');
  if (!(input.length > 0) || !Number.isFinite(input.length)) return fail('kitChemMat.cx.err.length');
  const idx = parseIndices(input.indices);
  if (idx === null || idx.length !== 3 || idx.every((x) => x === 0)) return fail('kitChemMat.cx.err.indices');
  const s = input.structure;
  const contact = CELL[s].contact;
  const a = input.known === 'R' ? input.length / contact : input.length;
  const R = a * contact;
  const prim = reduce(idx);
  const label = prim.join('');
  const perNm = 1e-9;
  if (input.kind === 'linear') {
    const repeat = directionRepeat(s, prim) * a;
    const ld = 1 / repeat;
    return {
      ok: true,
      rows: [
        { key: 'kitChemMat.cx.row.repeat', value: repeat, dim: 'length', digits: 5 },
        { key: 'kitChemMat.cx.row.linearDensity', value: ld * perNm, unit: 'atoms/nm', digits: 5 },
        { key: 'kitChemMat.cx.row.linearPerR', value: ld * R, unit: 'atoms/R', digits: 5 },
      ],
      steps: [
        {
          key: 'kitChemMat.cx.step.linear',
          math:
            `\\text{LD}_{[${label}]}=\\frac{1}{\\text{repeat}}=\\frac{1}{${latexNumber(repeat * 1e9, 5)}\\ \\mathrm{nm}}` +
            `=${latexNumber(ld * perNm, 5)}\\ \\mathrm{nm^{-1}}`,
        },
      ],
      notes: [{ key: 'kitChemMat.cx.note.density' }],
      equation: '\\text{LD}=\\frac{\\text{atoms centered on the line}}{\\text{length of the line}}',
    };
  }
  const d = planeSpacing(s, prim) * a;
  const atomsPerVolume = CELL[s].atoms / a ** 3;
  const pd = atomsPerVolume * d;
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.cx.row.planeSpacing', value: d, dim: 'length', digits: 5 },
      { key: 'kitChemMat.cx.row.planarDensity', value: pd * perNm * perNm, unit: 'atoms/nm²', digits: 5 },
      { key: 'kitChemMat.cx.row.planarPerR', value: pd * R * R, unit: 'atoms/R²', digits: 5 },
    ],
    steps: [
      {
        key: 'kitChemMat.cx.step.planar',
        math:
          `\\text{PD}_{(${label})}=\\frac{n}{a^3}\\,d=\\frac{${CELL[s].atoms}}{(${plain(a * 1e9, 5)}\\ \\mathrm{nm})^3}` +
          `\\times${latexNumber(d * 1e9, 5)}\\ \\mathrm{nm}=${latexNumber(pd * perNm * perNm, 5)}\\ \\mathrm{nm^{-2}}`,
      },
    ],
    notes: [{ key: 'kitChemMat.cx.note.density' }],
    equation: '\\text{PD}=\\frac{\\text{atoms centered on the plane}}{\\text{area of the plane}}',
  };
}

// ---------- Miller-Bravais ----------

export interface MillerBravaisInput {
  /** 'toFour' turns [uvw] into [UVTW]; 'toThree' turns [UVTW] into [uvw]. */
  direction: string;
  indices: string;
}

/** The smallest whole-number multiple of the vector (the entries are thirds). */
function wholeNumbers(v: readonly number[]): number[] {
  const scaled = v.map((x) => Math.round(x * 3));
  const g = scaled.reduce((x, y) => gcd(x, y), 0);
  return g === 0 ? scaled : scaled.map((x) => x / g);
}

export function millerBravais(input: MillerBravaisInput): Outcome {
  const idx = parseIndices(input.indices);
  if (input.direction === 'toThree') {
    if (idx === null || idx.length !== 4 || idx.every((x) => x === 0)) return fail('kitChemMat.cx.err.four');
    const [U, V, T, W] = idx;
    if (U + V + T !== 0) return fail('kitChemMat.cx.err.sumFour');
    const out = wholeNumbers([U - T, V - T, W]);
    return {
      ok: true,
      rows: [{ key: 'kitChemMat.cx.row.three', value: `[${out.join(' ')}]` }],
      steps: [
        {
          key: 'kitChemMat.cx.step.toThree',
          math: `u=U-T,\\ v=V-T,\\ w=W\\ \\Rightarrow\\ [${out.join('\\ ')}]`,
        },
      ],
      notes: [{ key: 'kitChemMat.cx.note.millerBravais' }],
      equation: 'u=U-T,\\quad v=V-T,\\quad w=W',
    };
  }
  if (idx === null || idx.length !== 3 || idx.every((x) => x === 0)) return fail('kitChemMat.cx.err.indices');
  const [u, v, w] = idx;
  const out = wholeNumbers([(2 * u - v) / 3, (2 * v - u) / 3, -(u + v) / 3, w]);
  return {
    ok: true,
    rows: [{ key: 'kitChemMat.cx.row.four', value: `[${out.join(' ')}]` }],
    steps: [
      {
        key: 'kitChemMat.cx.step.toFour',
        math: `U=\\frac{2u-v}{3},\\ V=\\frac{2v-u}{3},\\ T=-(U+V),\\ W=w\\ \\Rightarrow\\ [${out.join('\\ ')}]`,
      },
    ],
    notes: [{ key: 'kitChemMat.cx.note.millerBravais' }],
    equation: 'U=\\frac{2u-v}{3},\\ V=\\frac{2v-u}{3},\\ T=-(U+V),\\ W=w',
  };
}

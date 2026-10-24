// Crystal structures and diffraction: unit cell facts and density, spacing of planes, angles, Bragg angles, the
// allowed reflections of cubic and hexagonal crystals, indexing a powder pattern, and the Scherrer crystallite size.
// Lengths are in meters inside; the window shows them in the unit the student picks.
import { latexNumber, plain } from '../chemText';
import { NA } from '../constants';
import type { MessageKey } from '../../../../strings/t';
import { fail } from '../types';
import type { Failed, KitStep, Outcome, Row } from '../types';

export type Structure = 'sc' | 'bcc' | 'fcc' | 'hcp' | 'diamond' | 'nacl' | 'cscl';
export const STRUCTURES: readonly Structure[] = ['sc', 'bcc', 'fcc', 'hcp', 'diamond', 'nacl', 'cscl'];

/** Atoms (or formula units) per conventional cell, coordination number, and the closest-contact distance over a. */
const CELL = {
  sc: { atoms: 1, coordination: '6', contact: 0.5 },
  bcc: { atoms: 2, coordination: '8', contact: Math.sqrt(3) / 4 },
  fcc: { atoms: 4, coordination: '12', contact: Math.sqrt(2) / 4 },
  hcp: { atoms: 6, coordination: '12', contact: 0.5 },
  diamond: { atoms: 8, coordination: '4', contact: Math.sqrt(3) / 8 },
  nacl: { atoms: 4, coordination: '6:6', contact: 0.5 },
  cscl: { atoms: 1, coordination: '8:8', contact: Math.sqrt(3) / 2 },
} as const;

/** The ideal hexagonal close-packed ratio c/a = sqrt(8/3). */
export const IDEAL_CA = Math.sqrt(8 / 3);

/** The atomic packing factor of an element with atoms touching along the closest direction; c/a only for hcp. */
export function packingFactor(structure: 'sc' | 'bcc' | 'fcc' | 'hcp' | 'diamond', ca = IDEAL_CA): number {
  switch (structure) {
    case 'sc':
      return Math.PI / 6;
    case 'bcc':
      return (Math.PI * Math.sqrt(3)) / 8;
    case 'fcc':
      return Math.PI / (3 * Math.sqrt(2));
    case 'diamond':
      return (Math.PI * Math.sqrt(3)) / 16;
    default:
      return (2 * Math.PI) / (3 * Math.sqrt(3) * ca);
  }
}

/** Volume of the conventional cell. */
export function cellVolume(structure: Structure, a: number, ca = IDEAL_CA): number {
  return structure === 'hcp' ? ((3 * Math.sqrt(3)) / 2) * a * a * (a * ca) : a * a * a;
}

export interface CellInput {
  structure: Structure;
  /** What the length is: the lattice parameter or the atomic radius. */
  known: string;
  /** Meters. */
  length: number;
  /** Molar mass of an atom (or of a formula unit for NaCl and CsCl), g/mol. NaN to skip the density. */
  M: number;
  ca: number;
  /** Radii of the two ions for the NaCl and CsCl packing factor, meters; NaN to skip. */
  rc: number;
  ra: number;
}

export function cell(input: CellInput): Outcome {
  const s = input.structure;
  if (!(input.length > 0) || !Number.isFinite(input.length)) return fail('kitChemMat.cx.err.length');
  if (s === 'hcp' && (!(input.ca > 0) || !Number.isFinite(input.ca))) return fail('kitChemMat.cx.err.ca');
  if (!Number.isNaN(input.M) && !(input.M > 0)) return fail('kitChemMat.cx.err.mass');
  const ca = s === 'hcp' ? input.ca : IDEAL_CA;
  const info = CELL[s];
  const compound = s === 'nacl' || s === 'cscl';
  // From the radius: the closest contact is 2R for an element, so a = 2R / contact (hcp: a = 2R).
  let a = input.length;
  if (input.known === 'R') {
    if (compound) return fail('kitChemMat.cx.err.compoundRadius');
    a = input.length / info.contact;
  }
  if (s === 'hcp' && ca < 1 && input.known === 'R') return fail('kitChemMat.cx.err.caSmall');
  const V = cellVolume(s, a, ca);
  const rows: Row[] = [
    { key: 'kitChemMat.cx.row.atoms', value: String(info.atoms) },
    { key: 'kitChemMat.cx.row.coordination', value: info.coordination },
    { key: 'kitChemMat.cx.row.a', value: a, dim: 'length', digits: 5 },
  ];
  const steps: KitStep[] = [];
  const notes: { key: MessageKey }[] = [];
  if (s === 'hcp') rows.push({ key: 'kitChemMat.cx.row.c', value: a * ca, dim: 'length', digits: 5 });
  if (input.known === 'R') {
    steps.push({
      key: 'kitChemMat.cx.step.fromRadius',
      math: `a=${latexNumber(a * 1e9, 5)}\\ \\mathrm{nm}`,
    });
  }
  if (!compound) {
    const apf = packingFactor(s, ca);
    rows.push({ key: 'kitChemMat.cx.row.apf', value: apf, digits: 5 });
    steps.push({
      key: 'kitChemMat.cx.step.apf',
      math: `\\mathrm{APF}=\\frac{N\\,\\tfrac{4}{3}\\pi R^3}{V_{\\text{cell}}}=${latexNumber(apf, 5)}`,
    });
    if (s === 'hcp' && ca < 1) notes.push({ key: 'kitChemMat.cx.note.caSmall' });
  } else if (!Number.isNaN(input.rc) && !Number.isNaN(input.ra)) {
    if (!(input.rc > 0) || !(input.ra > 0)) return fail('kitChemMat.cx.err.ions');
    const n = info.atoms;
    const apf = (n * (4 / 3) * Math.PI * (input.rc ** 3 + input.ra ** 3)) / V;
    rows.push({ key: 'kitChemMat.cx.row.apf', value: apf, digits: 5 });
    steps.push({
      key: 'kitChemMat.cx.step.apfIons',
      math: `\\mathrm{APF}=\\frac{${n}\\cdot\\tfrac{4}{3}\\pi\\,(r_+^3+r_-^3)}{a^3}=${latexNumber(apf, 5)}`,
    });
    if (input.rc + input.ra > a * info.contact * (1 + 1e-9)) notes.push({ key: 'kitChemMat.cx.note.overlap' });
  }
  rows.push({ key: 'kitChemMat.cx.row.volume', value: V * 1e27, unit: 'nm³', digits: 5 });
  if (!Number.isNaN(input.M)) {
    // rho = n M / (V NA) with V in cm3: m3 -> cm3 multiplies by 1e6.
    const rho = (info.atoms * input.M) / (V * 1e6 * NA);
    rows.push({ key: 'kitChemMat.cx.row.density', value: rho, unit: 'g/cm³', digits: 5 });
    steps.push({
      key: 'kitChemMat.cx.step.density',
      math:
        `\\rho=\\frac{nM}{V_{\\text{cell}}N_A}=\\frac{${info.atoms}\\times${latexNumber(input.M)}}{${latexNumber(V * 1e6, 5)}` +
        `\\ \\mathrm{cm^3}\\times${latexNumber(NA, 6)}}=${latexNumber(rho, 5)}\\ \\mathrm{g/cm^3}`,
    });
  }
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.cx.note.hard' }, ...notes],
    equation: '\\rho=\\frac{nM}{V_{\\text{cell}}N_A}',
  };
}

// ---------- Indices ----------

/** Reads whole numbers separated by spaces or commas; the minus sign (or an overbar written as "-") marks a negative. */
export function parseIndices(text: string): number[] | null {
  const cells = text
    .replace(/[[\](){}<>]/g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (cells.length === 0) return null;
  const out = cells.map((c) => (/^[+-]?\d+$/.test(c) ? Number(c) : NaN));
  return out.some((n) => Number.isNaN(n)) ? null : out;
}

/** Spacing of the plane (hkl), cubic: a / sqrt(h2+k2+l2); hexagonal: 1/d2 = 4/3 (h2+hk+k2)/a2 + l2/c2. */
export function dCubic(a: number, h: number, k: number, l: number): number {
  return a / Math.sqrt(h * h + k * k + l * l);
}

export function dHex(a: number, c: number, h: number, k: number, l: number): number {
  return 1 / Math.sqrt((4 / 3) * ((h * h + h * k + k * k) / (a * a)) + (l * l) / (c * c));
}

/** The Bragg angle 2 theta in degrees for spacing d at wavelength lambda and order n, or null when it does not exist. */
export function twoTheta(d: number, lambda: number, n = 1): number | null {
  const s = (n * lambda) / (2 * d);
  if (!(s > 0) || s > 1) return null;
  return (2 * Math.asin(s) * 180) / Math.PI;
}

const fmtIdx = (v: readonly number[]) => v.join(' ');

export interface SpacingInput {
  system: string;
  a: number;
  c: number;
  hkl: string;
  lambda: number;
  order: number;
}

export function spacing(input: SpacingInput): Outcome {
  const hex = input.system === 'hex';
  if (!(input.a > 0) || !Number.isFinite(input.a)) return fail('kitChemMat.cx.err.length');
  if (hex && (!(input.c > 0) || !Number.isFinite(input.c))) return fail('kitChemMat.cx.err.c');
  const idx = parseIndices(input.hkl);
  if (idx === null || !(idx.length === 3 || (hex && idx.length === 4)))
    return fail(hex ? 'kitChemMat.cx.err.indicesHex' : 'kitChemMat.cx.err.indices');
  let h: number, k: number, l: number;
  if (idx.length === 4) {
    if (idx[0] + idx[1] + idx[2] !== 0) return fail('kitChemMat.cx.err.bravais');
    [h, k, , l] = idx;
  } else [h, k, l] = idx;
  if (h === 0 && k === 0 && l === 0) return fail('kitChemMat.cx.err.zero');
  const d = hex ? dHex(input.a, input.c, h, k, l) : dCubic(input.a, h, k, l);
  const rows: Row[] = [{ key: 'kitChemMat.cx.row.d', value: d, dim: 'length', digits: 5 }];
  const steps: KitStep[] = [
    hex
      ? {
          key: 'kitChemMat.cx.step.dHex',
          math:
            `\\frac{1}{d^2}=\\frac43\\,\\frac{h^2+hk+k^2}{a^2}+\\frac{l^2}{c^2}\\ \\Rightarrow` +
            `\\ d=${latexNumber(d * 1e9, 5)}\\ \\mathrm{nm}`,
        }
      : {
          key: 'kitChemMat.cx.step.dCubic',
          math:
            `d=\\frac{a}{\\sqrt{h^2+k^2+l^2}}=\\frac{${latexNumber(input.a * 1e9, 5)}}{\\sqrt{${h * h + k * k + l * l}}}=` +
            `${latexNumber(d * 1e9, 5)}\\ \\mathrm{nm}`,
        },
  ];
  if (hex) {
    const i = -(h + k);
    rows.push({ key: 'kitChemMat.cx.row.bravais', value: `(${h} ${k} ${i} ${l})` });
  }
  if (!Number.isNaN(input.lambda)) {
    if (!(input.lambda > 0)) return fail('kitChemMat.cx.err.wavelength');
    if (!(input.order >= 1) || !Number.isInteger(input.order)) return fail('kitChemMat.cx.err.order');
    const tt = twoTheta(d, input.lambda, input.order);
    if (tt === null) return fail('kitChemMat.cx.err.noReflection');
    rows.push({ key: 'kitChemMat.cx.row.theta', value: tt / 2, unit: '°', digits: 5 });
    rows.push({ key: 'kitChemMat.cx.row.twoTheta', value: tt, unit: '°', digits: 5 });
    steps.push({
      key: 'kitChemMat.cx.step.bragg',
      math:
        `n\\lambda=2d\\sin\\theta\\ \\Rightarrow\\ \\theta=\\arcsin\\frac{${input.order}` +
        `\\times${latexNumber(input.lambda * 1e9, 5)}}{2\\times${latexNumber(d * 1e9, 5)}}=` +
        `${latexNumber(tt / 2, 5)}^\\circ`,
    });
  }
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: hex ? 'kitChemMat.cx.note.hex' : 'kitChemMat.cx.note.cubic' }],
    equation: hex
      ? '\\frac{1}{d^2}=\\frac43\\,\\frac{h^2+hk+k^2}{a^2}+\\frac{l^2}{c^2}'
      : 'd_{hkl}=\\frac{a}{\\sqrt{h^2+k^2+l^2}}',
  };
}

/** The angle in degrees between two directions [uvw], or two plane normals (hkl), of a cubic crystal. */
export function angleBetween(u: readonly number[], v: readonly number[]): number | null {
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const nu = Math.hypot(u[0], u[1], u[2]);
  const nv = Math.hypot(v[0], v[1], v[2]);
  if (nu === 0 || nv === 0) return null;
  const c = Math.min(1, Math.max(-1, dot / (nu * nv)));
  return (Math.acos(c) * 180) / Math.PI;
}

export function angle(first: string, second: string): Outcome {
  const u = parseIndices(first);
  const v = parseIndices(second);
  if (u === null || v === null || u.length !== 3 || v.length !== 3) return fail('kitChemMat.cx.err.indices');
  const deg = angleBetween(u, v);
  if (deg === null) return fail('kitChemMat.cx.err.zero');
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return {
    ok: true,
    rows: [{ key: 'kitChemMat.cx.row.angle', value: deg, unit: '°', digits: 6 }],
    steps: [
      {
        key: 'kitChemMat.cx.step.angle',
        math:
          `\\cos\\varphi=\\frac{[${fmtIdx(u)}]\\cdot[${fmtIdx(v)}]}{|[${fmtIdx(u)}]|\\,` +
          `|[${fmtIdx(v)}]|}=\\frac{${dot}}{${latexNumber(Math.hypot(...u), 5)}\\times${latexNumber(Math.hypot(...v), 5)}}` +
          `\\ \\Rightarrow\\ \\varphi=${latexNumber(deg, 6)}^\\circ`,
      },
    ],
    notes: [{ key: 'kitChemMat.cx.note.angle' }],
    equation: '\\cos\\varphi=\\frac{\\mathbf{u}\\cdot\\mathbf{v}}{|\\mathbf{u}||\\mathbf{v}|}',
  };
}

// ---------- Powder patterns ----------

/** The number of entries with an odd index among h, k, l, for a given N = h2 + k2 + l2 (it depends only on N mod 4). */
function oddCount(N: number): number {
  return N % 4 === 0 ? 0 : N % 4 === 3 ? 3 : N % 4;
}

/** Whether the cubic structure shows a reflection with h2+k2+l2 = N, by its structure-factor rule. */
export function cubicAllowed(structure: Structure, N: number): boolean {
  const odd = oddCount(N);
  switch (structure) {
    case 'sc':
    case 'cscl':
      return true;
    case 'bcc':
      return N % 2 === 0;
    case 'fcc':
    case 'nacl':
      return odd === 0 || odd === 3;
    case 'diamond':
      return odd === 3 || (odd === 0 && N % 8 === 0);
    default:
      return false;
  }
}

/** The rule in words, as a message key. */
export const RULE_KEY: Record<Structure, MessageKey> = {
  sc: 'kitChemMat.cx.rule.sc',
  bcc: 'kitChemMat.cx.rule.bcc',
  fcc: 'kitChemMat.cx.rule.fcc',
  hcp: 'kitChemMat.cx.rule.hcp',
  diamond: 'kitChemMat.cx.rule.diamond',
  nacl: 'kitChemMat.cx.rule.nacl',
  cscl: 'kitChemMat.cx.rule.cscl',
};

/** All signed integer triples with h2+k2+l2 = N. */
function triples(N: number): number[][] {
  const out: number[][] = [];
  const m = Math.floor(Math.sqrt(N));
  for (let h = -m; h <= m; h++)
    for (let k = -m; k <= m; k++) {
      const r = N - h * h - k * k;
      if (r < 0) continue;
      const l = Math.round(Math.sqrt(r));
      if (l * l !== r) continue;
      out.push([h, k, l]);
      if (l !== 0) out.push([h, k, -l]);
    }
  return out;
}

/** The distinct reflections {hkl} of a cubic crystal in order of N, with multiplicity. */
export function cubicReflections(structure: Structure, maxN: number) {
  const list: { N: number; reps: string[]; mult: number }[] = [];
  for (let N = 1; N <= maxN; N++) {
    if (!cubicAllowed(structure, N)) continue;
    const all = triples(N);
    if (all.length === 0) continue;
    const reps = new Set<string>();
    for (const t of all) {
      const s = [...t].map(Math.abs).sort((x, y) => y - x);
      reps.add(s.join(''));
    }
    list.push({ N, reps: [...reps], mult: all.length });
  }
  return list;
}

/** hcp reflections: (h+2k) divisible by 3 together with odd l is extinct. */
export function hcpAllowed(h: number, k: number, l: number): boolean {
  return !((h + 2 * k) % 3 === 0 && Math.abs(l) % 2 === 1);
}

export interface PatternInput {
  structure: Structure;
  a: number;
  ca: number;
  lambda: number;
  maxTwoTheta: number;
}

const rowOf = (...cells: string[]) => cells;

export function pattern(input: PatternInput): Outcome {
  const s = input.structure;
  if (!(input.a > 0) || !Number.isFinite(input.a)) return fail('kitChemMat.cx.err.length');
  if (!(input.lambda > 0) || !Number.isFinite(input.lambda)) return fail('kitChemMat.cx.err.wavelength');
  if (!(input.maxTwoTheta > 0) || input.maxTwoTheta > 180) return fail('kitChemMat.cx.err.maxAngle');
  if (s === 'hcp' && (!(input.ca > 0) || !Number.isFinite(input.ca))) return fail('kitChemMat.cx.err.ca');
  const found: { label: string; d: number; tt: number; mult: number }[] = [];
  if (s === 'hcp') {
    const c = input.a * input.ca;
    const lim = 12;
    const groups = new Map<string, { label: string; d: number; mult: number }>();
    for (let h = 0; h <= lim; h++)
      for (let k = 0; k <= h; k++)
        for (let l = 0; l <= lim; l++) {
          if (h === 0 && k === 0 && l === 0) continue;
          if (!hcpAllowed(h, k, l)) continue;
          const d = dHex(input.a, c, h, k, l);
          const key = d.toPrecision(10);
          const lab = `${h} ${k} ${-(h + k)} ${l}`;
          const g = groups.get(key);
          const mult = (k === 0 || h === k ? 6 : 12) * (l === 0 ? 1 : 2) * (h === 0 && k === 0 ? 1 / 6 : 1);
          if (g) g.mult += mult;
          else groups.set(key, { label: lab, d, mult });
        }
    for (const g of groups.values()) {
      const tt = twoTheta(g.d, input.lambda);
      if (tt !== null && tt <= input.maxTwoTheta) found.push({ label: g.label, d: g.d, tt, mult: Math.round(g.mult) });
    }
  } else {
    const maxN = Math.floor((2 * input.a) / input.lambda) ** 2;
    for (const r of cubicReflections(s, Math.min(maxN, 400))) {
      const d = dCubic(input.a, Math.sqrt(r.N), 0, 0);
      const tt = twoTheta(d, input.lambda);
      if (tt !== null && tt <= input.maxTwoTheta)
        found.push({ label: r.reps.slice(0, 3).join(', '), d, tt, mult: r.mult });
    }
  }
  found.sort((x, y) => x.tt - y.tt);
  if (found.length === 0) return fail('kitChemMat.cx.err.noPeaks');
  const rows: Row[] = [
    { key: 'kitChemMat.cx.row.peaks', value: String(found.length) },
    { key: 'kitChemMat.cx.row.first', value: found[0].tt, unit: '°', digits: 5 },
  ];
  return {
    ok: true,
    rows,
    steps: [
      { key: RULE_KEY[s] },
      {
        key: 'kitChemMat.cx.step.braggAll',
        math: `2\\theta=2\\arcsin\\frac{\\lambda}{2d_{hkl}}`,
      },
    ],
    notes: [{ key: 'kitChemMat.cx.note.pattern' }],
    tables: [
      {
        title: 'kitChemMat.cx.table.pattern',
        header: [
          'kitChemMat.cx.col.hkl',
          'kitChemMat.cx.col.d',
          'kitChemMat.cx.col.twoTheta',
          'kitChemMat.cx.col.mult',
        ],
        rows: found.map((f) => rowOf(f.label, plain(f.d * 1e9, 5), plain(f.tt, 5), String(f.mult))),
      },
    ],
    equation: '2d\\sin\\theta=\\lambda',
  };
}

// ---------- Indexing ----------

const STRUCTURE_WORD: Record<Structure, MessageKey> = {
  sc: 'kitChemMat.cx.structure.sc',
  bcc: 'kitChemMat.cx.structure.bcc',
  fcc: 'kitChemMat.cx.structure.fcc',
  hcp: 'kitChemMat.cx.structure.hcp',
  diamond: 'kitChemMat.cx.structure.diamond',
  nacl: 'kitChemMat.cx.structure.nacl',
  cscl: 'kitChemMat.cx.structure.cscl',
};

/** In order of preference when several fit: the common metals first, simple cubic last. */
const INDEXABLE: readonly Structure[] = ['fcc', 'bcc', 'diamond', 'sc'];

export interface IndexFit {
  structure: Structure;
  a: number;
  spread: number;
  /** How many of the lowest allowed reflections lie below the first peak (0 when the pattern starts at the lowest). */
  skipped: number;
  hkls: number[];
}

/** Tries each cubic structure for peaks given as 2 theta in degrees (sorted); returns the fits, best first. */
export function indexCubic(twoThetas: readonly number[], lambda: number, maxSkip = 0): IndexFit[] {
  const sin2 = twoThetas.map((t) => Math.sin(((t / 2) * Math.PI) / 180) ** 2);
  const fits: IndexFit[] = [];
  for (const s of INDEXABLE) {
    const allowed: number[] = [];
    for (let N = 1; N <= 48; N++) if (cubicAllowed(s, N) && triples(N).length > 0) allowed.push(N);
    // Try each of the first few allowed values of N for the first peak.
    for (let m = 0; m <= maxSkip; m++) {
      const q = sin2[0] / allowed[m];
      const hkls: number[] = [];
      let worst = 0;
      let ok = true;
      for (const x of sin2) {
        const target = x / q;
        let near = allowed[0];
        for (const N of allowed) if (Math.abs(N - target) < Math.abs(near - target)) near = N;
        const err = Math.abs(near - target);
        if (err > Math.max(0.05, 0.004 * near)) {
          ok = false;
          break;
        }
        worst = Math.max(worst, err);
        hkls.push(near);
      }
      if (!ok) continue;
      if (new Set(hkls).size !== hkls.length) continue;
      // lambda^2 / (4 a^2) = q  ->  a = lambda / (2 sqrt q); take a from a least-squares-like mean of the N values
      const aValues = sin2.map((x, i) => (lambda * Math.sqrt(hkls[i])) / (2 * Math.sqrt(x)));
      const a = aValues.reduce((p, v) => p + v, 0) / aValues.length;
      const fit: IndexFit = { structure: s, a, spread: worst, skipped: m, hkls };
      fits.push(fit);
      break;
    }
  }
  return fits.sort((x, y) => INDEXABLE.indexOf(x.structure) - INDEXABLE.indexOf(y.structure));
}

export function indexPattern(peaks: string, lambda: number): Outcome | Failed {
  if (!(lambda > 0) || !Number.isFinite(lambda)) return fail('kitChemMat.cx.err.wavelength');
  const nums = peaks
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((c) => (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(c) ? Number(c) : NaN));
  if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) return fail('kitChemMat.cx.err.peaks');
  if (nums.some((n) => !(n > 0 && n < 180))) return fail('kitChemMat.cx.err.peakRange');
  const sorted = [...nums].sort((x, y) => x - y);
  let fits = indexCubic(sorted, lambda);
  if (fits.length === 0) fits = indexCubic(sorted, lambda, 5);
  if (fits.length === 0) return fail('kitChemMat.cx.err.noFit');
  const best = fits[0];
  const rows: Row[] = [
    { key: 'kitChemMat.cx.row.structure', value: '', word: STRUCTURE_WORD[best.structure] },
    { key: 'kitChemMat.cx.row.a', value: best.a, dim: 'length', digits: 5 },
  ];
  const sin2 = sorted.map((t) => Math.sin(((t / 2) * Math.PI) / 180) ** 2);
  const reflections = new Map(cubicReflections(best.structure, 60).map((r) => [r.N, r.reps[0]]));
  const table = sorted.map((t, i) =>
    rowOf(
      String(i + 1),
      plain(t, 5),
      plain(sin2[i], 5),
      plain(sin2[i] / sin2[0], 4),
      reflections.get(best.hkls[i]) ?? String(best.hkls[i]),
      plain(((lambda * Math.sqrt(best.hkls[i])) / (2 * Math.sqrt(sin2[i]))) * 1e9, 5),
    ),
  );
  return {
    ok: true,
    rows,
    steps: [
      { key: 'kitChemMat.cx.step.sin2', math: `\\sin^2\\theta=\\frac{\\lambda^2}{4a^2}\\,(h^2+k^2+l^2)` },
      { key: 'kitChemMat.cx.step.ratio' },
    ],
    notes: [
      { key: 'kitChemMat.cx.note.index' },
      ...(best.skipped > 0 ? [{ key: 'kitChemMat.cx.note.skipped' as const }] : []),
      ...(fits.length > 1 ? [{ key: 'kitChemMat.cx.note.others' as const }] : []),
    ],
    tables: [
      {
        title: 'kitChemMat.cx.table.index',
        header: [
          '#',
          'kitChemMat.cx.col.twoTheta',
          'sin²θ',
          'kitChemMat.cx.col.ratio',
          'kitChemMat.cx.col.hkl',
          'kitChemMat.cx.col.aNm',
        ],
        rows: table,
      },
    ],
    equation: '\\sin^2\\theta=\\frac{\\lambda^2}{4a^2}\\left(h^2+k^2+l^2\\right)',
  };
}

// ---------- Scherrer ----------

export interface ScherrerInput {
  lambda: number;
  twoTheta: number;
  /** Peak width in degrees of 2 theta, after removing the instrument's width. */
  fwhm: number;
  K: number;
}

/** The mean crystallite size tau = K lambda / (beta cos theta), beta in radians, in meters. */
export function scherrerSize(lambda: number, twoThetaDeg: number, fwhmDeg: number, K: number): number {
  return (K * lambda) / (((fwhmDeg * Math.PI) / 180) * Math.cos(((twoThetaDeg / 2) * Math.PI) / 180));
}

export function scherrer(input: ScherrerInput): Outcome {
  if (!(input.lambda > 0) || !Number.isFinite(input.lambda)) return fail('kitChemMat.cx.err.wavelength');
  if (!(input.twoTheta > 0 && input.twoTheta < 180)) return fail('kitChemMat.cx.err.peakRange');
  if (!(input.fwhm > 0) || !Number.isFinite(input.fwhm)) return fail('kitChemMat.cx.err.width');
  if (!(input.K > 0)) return fail('kitChemMat.cx.err.shape');
  const tau = scherrerSize(input.lambda, input.twoTheta, input.fwhm, input.K);
  return {
    ok: true,
    rows: [{ key: 'kitChemMat.cx.row.size', value: tau, dim: 'length', digits: 5 }],
    steps: [
      {
        key: 'kitChemMat.cx.step.scherrer',
        math:
          `\\tau=\\frac{K\\lambda}{\\beta\\cos\\theta}=\\frac{${latexNumber(input.K)}` +
          `\\times${latexNumber(input.lambda * 1e9, 5)}\\ \\mathrm{nm}}{${latexNumber((input.fwhm * Math.PI) / 180, 5)}` +
          `\\times\\cos ${latexNumber(input.twoTheta / 2, 5)}^\\circ}=${latexNumber(tau * 1e9, 5)}` +
          `\\ \\mathrm{nm}`,
      },
    ],
    notes: [{ key: 'kitChemMat.cx.note.scherrer' }],
    equation: '\\tau=\\frac{K\\lambda}{\\beta\\cos\\theta}',
  };
}

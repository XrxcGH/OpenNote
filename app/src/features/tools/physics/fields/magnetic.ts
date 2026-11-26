// The fields tool's magnetic calculations: the Biot-Savart law for straight segments; the fields of wires, loops,
// solenoids, and toroids; and the Lorentz force on a charge or a wire.
import '../text';
import type { MessageKey } from '../../../../strings/t';
import { MU0 } from '../kit/constants';
import { fmt, q, qIn } from '../kit/format';
import { fail } from '../kit/read';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, ResultRow } from '../kit/types';
import { fromSI, toSI } from '../kit/units';
import type { DimId } from '../kit/units';
import { add, cross, lorentz, norm, scale, segmentField, sourceField } from './engine';
import type { Source, Vec } from './engine';

const K = 'kitPhysics.fields';
const uT = (b: number) => qIn(b, 'bfield', 'µT');
const vecText = (v: Vec, unit: string, dim: DimId) =>
  `(${v.map((one) => fmt(fromSI(one, dim, unit))).join(', ')}) ${unit}`;
const bRows = (B: Vec): ResultRow[] => [
  { key: `${K}.r.B`, symbol: '|B|', value: norm(B), dim: 'bfield', unit: 'µT', primary: true },
  { key: `${K}.r.Bx`, symbol: 'B_x', value: B[0], dim: 'bfield', unit: 'µT' },
  { key: `${K}.r.By`, symbol: 'B_y', value: B[1], dim: 'bfield', unit: 'µT' },
  { key: `${K}.r.Bz`, symbol: 'B_z', value: B[2], dim: 'bfield', unit: 'µT' },
];

const SCALES = ['m', 'cm', 'mm'] as const;

export const segmentsMode: ModeDef = {
  id: 'segments',
  label: `${K}.modes.segments`,
  intro: `${K}.help.segments`,
  fields: [
    {
      id: 'scale',
      label: `${K}.f.scale`,
      kind: 'choice',
      initial: 'cm',
      options: SCALES.map((unit) => ({ value: unit, label: `${K}.o.${unit}` as MessageKey })),
    },
    {
      id: 'segments',
      label: `${K}.f.segments`,
      kind: 'rows',
      initial: '0 0 0 10 0 0 2\n10 0 0 10 10 0 2\n10 10 0 0 10 0 2\n0 10 0 0 0 0 2',
      columns: [
        { label: `${K}.f.x1` },
        { label: `${K}.f.y1` },
        { label: `${K}.f.z1` },
        { label: `${K}.f.x2` },
        { label: `${K}.f.y2` },
        { label: `${K}.f.z2` },
        { label: `${K}.f.amps` },
      ],
    },
    { id: 'P', label: `${K}.f.point`, kind: 'vector', initial: '5 5 0' },
  ],
  solve(read): Outcome {
    const scaleUnit = SCALES.find((unit) => unit === read.choice('scale')) ?? 'm';
    const m = (value: number) => toSI(value, 'length', scaleUnit);
    const lines = read.rows('segments');
    if (lines.length > 40) fail(`${K}.errors.tooManySegments`);
    const P = read.vector('P', 3).map(m) as Vec;
    let B: Vec = [0, 0, 0];
    const steps: KitStep[] = lines.map((line, i) => {
      const a = line.slice(0, 3).map(m) as Vec;
      const b = line.slice(3, 6).map(m) as Vec;
      const part = segmentField(a, b, line[6], P);
      B = add(B, part);
      return {
        key: `${K}.s.segment`,
        vars: { k: String(i + 1), I: q(line[6], 'A'), B: vecText(part, 'µT', 'bfield') },
      };
    });
    steps.push({ key: `${K}.s.segmentSum`, vars: { B: vecText(B, 'µT', 'bfield'), size: uT(norm(B)) } });
    return {
      ok: true,
      rows: bRows(B),
      latex:
        '\\vec B=\\frac{\\mu_0I}{4\\pi}\\frac{\\vec L\\times\\vec r_1}{|\\vec L\\times\\vec r_1|^2}' +
        '\\left(\\frac{\\vec L\\cdot\\vec r_1}{r_1}-\\frac{\\vec L\\cdot\\vec r_2}{r_2}\\right)',
      steps,
      notes: [{ key: `${K}.notes.segments` }],
      plot: segmentPlot(
        lines.map((line) => line.slice(0, 6)),
        read.vector('P', 3),
        scaleUnit,
      ),
    };
  },
};

/** The segments seen from above (the x-y plane), with the field point. */
function segmentPlot(lines: number[][], P: number[], unit: string): Plot {
  const xs = [...lines.flatMap((l) => [l[0], l[3]]), P[0]];
  const ys = [...lines.flatMap((l) => [l[1], l[4]]), P[1]];
  const pad = 0.15 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9);
  return {
    frame: 'equal',
    alt: { key: `${K}.plot.segments`, vars: { count: String(lines.length) } },
    x: { label: `x (${unit})`, min: Math.min(...xs) - pad, max: Math.max(...xs) + pad },
    y: { label: `y (${unit})`, min: Math.min(...ys) - pad, max: Math.max(...ys) + pad },
    series: lines.map((l) => ({
      points: [
        [l[0], l[1]],
        [l[3], l[4]],
      ] as [number, number][],
      tone: 'accent' as const,
      width: 2,
    })),
    // An arrowhead at each segment's middle shows which way the current flows.
    arrows: lines.map((l) => ({
      x1: l[0] + 0.4 * (l[3] - l[0]),
      y1: l[1] + 0.4 * (l[4] - l[1]),
      x2: l[0] + 0.6 * (l[3] - l[0]),
      y2: l[1] + 0.6 * (l[4] - l[1]),
      tone: 'accent' as const,
    })),
    circles: [{ x: P[0], y: P[1], r: 4, px: true, tone: 'danger', fill: true }],
    legend: [
      { tone: 'accent', key: `${K}.legend.current` },
      { tone: 'danger', key: `${K}.legend.point` },
    ],
  };
}

const SOURCES: readonly Source[] = ['wire', 'loop', 'solenoid', 'toroid'];

export const sourcesMode: ModeDef = {
  id: 'sources',
  label: `${K}.modes.sources`,
  fields: [
    {
      id: 'source',
      label: `${K}.f.source`,
      kind: 'choice',
      initial: 'loop',
      options: SOURCES.map((s) => ({ value: s, label: `${K}.o.${s}` as MessageKey })),
    },
    { id: 'I', label: `${K}.f.current`, dim: 'current', unit: 'A', initial: '10' },
    {
      id: 'r',
      label: `${K}.f.distance`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '5',
      when: (ch) => ch('source') === 'wire' || ch('source') === 'toroid',
    },
    {
      id: 'R',
      label: `${K}.f.radius`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '5',
      when: (ch) => ch('source') === 'loop' || ch('source') === 'solenoid',
    },
    {
      id: 'wireRadius',
      label: `${K}.f.wireRadius`,
      dim: 'length',
      unit: 'mm',
      usUnit: 'in',
      initial: '',
      optional: true,
      help: `${K}.help.wireRadius`,
      when: (ch) => ch('source') === 'wire',
    },
    { id: 'N', label: `${K}.f.turns`, initial: '1', when: (ch) => ch('source') !== 'wire' },
    {
      id: 'length',
      label: `${K}.f.solenoidLength`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '20',
      when: (ch) => ch('source') === 'solenoid',
    },
    {
      id: 'z',
      label: `${K}.f.axial`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '0',
      when: (ch) => ch('source') === 'loop' || ch('source') === 'solenoid',
    },
  ],
  solve(read): Outcome {
    const source = SOURCES.find((s) => s === read.choice('source')) ?? 'wire';
    const input = readSource(read, source);
    const B = sourceField(source, input);
    const cm = (m: number) => qIn(m, 'length', 'cm');
    const rows: ResultRow[] = [
      { key: `${K}.r.B`, symbol: '|B|', value: Math.abs(B), dim: 'bfield', unit: 'µT', primary: true },
    ];
    const vars = {
      I: q(input.I, 'A'),
      r: cm(input.r),
      R: cm(input.R),
      N: fmt(input.N),
      L: cm(input.length),
      z: cm(input.z),
      B: uT(Math.abs(B)),
    };
    const inside = source === 'wire' && input.R > 0 && input.r < input.R;
    const steps: KitStep[] = [{ key: `${K}.s.source.${source}${inside ? 'In' : ''}` as MessageKey, vars }];
    if (source === 'solenoid') {
      const ideal = (MU0 * input.N * input.I) / input.length;
      rows.push({ key: `${K}.r.ideal`, symbol: 'μ₀nI', value: ideal, dim: 'bfield', unit: 'µT' });
      steps.push({ key: `${K}.s.idealSolenoid`, vars: { n: q(input.N / input.length, '1/m'), B: uT(ideal) } });
    }
    return {
      ok: true,
      rows,
      latex: SOURCE_LATEX[source],
      steps,
      notes: [{ key: `${K}.notes.sources` }],
      plot: sourcePlot(source, input),
    };
  },
};

const SOURCE_LATEX: Record<Source, string> = {
  wire: 'B=\\frac{\\mu_0I}{2\\pi r}',
  loop: 'B=\\frac{\\mu_0NIR^2}{2(R^2+z^2)^{3/2}}',
  solenoid: 'B=\\frac{\\mu_0nI}{2}\\left(\\cos\\alpha_1-\\cos\\alpha_2\\right)\\approx\\mu_0nI',
  toroid: 'B=\\frac{\\mu_0NI}{2\\pi r}',
};

function readSource(read: Reader, source: Source) {
  const I = read.num('I');
  const r = source === 'wire' || source === 'toroid' ? read.num('r', 'positive') : 0;
  const R =
    source === 'wire' ? (read.opt('wireRadius', 'positive') ?? 0) : source === 'toroid' ? 0 : read.num('R', 'positive');
  const N = source === 'wire' ? 1 : read.num('N', 'positive');
  const length = source === 'solenoid' ? read.num('length', 'positive') : 0;
  const z = source === 'loop' || source === 'solenoid' ? read.num('z') : 0;
  return { I, r, R, N, length, z };
}

function sourcePlot(source: Source, input: ReturnType<typeof readSource>): Plot {
  const radial = source === 'wire' || source === 'toroid';
  const reach = radial ? 3 * Math.max(input.r, input.R) : 3 * Math.max(input.R, input.length / 2, Math.abs(input.z));
  const points: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const at = radial ? (reach * (i + 1)) / 201 : -reach + (2 * reach * i) / 200;
    const B = sourceField(source, radial ? { ...input, r: at } : { ...input, z: at });
    points.push([fromSI(at, 'length', 'cm'), Math.abs(fromSI(B, 'bfield', 'µT'))]);
  }
  const here = radial ? input.r : input.z;
  const top = Math.max(...points.map(([, b]) => b));
  return {
    frame: 'axes',
    alt: { key: radial ? `${K}.plot.radial` : `${K}.plot.axial` },
    x: { label: radial ? 'r (cm)' : 'z (cm)', ...(radial ? { min: 0 } : {}) },
    y: { label: '|B| (µT)', min: 0 },
    series: [
      { points, tone: 'accent', width: 2 },
      {
        points: [
          [fromSI(here, 'length', 'cm'), 0],
          [fromSI(here, 'length', 'cm'), top],
        ],
        tone: 'danger',
        dash: true,
      },
    ],
    legend: [
      { tone: 'accent', key: `${K}.legend.B` },
      { tone: 'danger', key: `${K}.legend.here`, dash: true },
    ],
  };
}

export const forceMode: ModeDef = {
  id: 'force',
  label: `${K}.modes.force`,
  fields: [
    {
      id: 'on',
      label: `${K}.f.on`,
      kind: 'choice',
      initial: 'charge',
      options: [
        { value: 'charge', label: `${K}.o.charge` },
        { value: 'wire', label: `${K}.o.straightWire` },
      ],
    },
    { id: 'q', label: `${K}.f.q`, dim: 'charge', unit: 'e', initial: '1', when: (ch) => ch('on') === 'charge' },
    {
      id: 'm',
      label: `${K}.f.mass`,
      dim: 'mass',
      unit: 'u',
      usUnit: 'u',
      initial: '1.007276',
      optional: true,
      help: `${K}.help.mass`,
      when: (ch) => ch('on') === 'charge',
    },
    {
      id: 'v',
      label: `${K}.f.velocity`,
      kind: 'vector',
      dim: 'speed',
      unit: 'm/s',
      usUnit: 'm/s',
      initial: '1e5 0 0',
      when: (ch) => ch('on') === 'charge',
    },
    {
      id: 'E',
      label: `${K}.f.efield`,
      kind: 'vector',
      dim: 'efield',
      unit: 'N/C',
      initial: '0 0 0',
      when: (ch) => ch('on') === 'charge',
    },
    { id: 'I', label: `${K}.f.current`, dim: 'current', unit: 'A', initial: '5', when: (ch) => ch('on') === 'wire' },
    {
      id: 'L',
      label: `${K}.f.wireVector`,
      kind: 'vector',
      dim: 'length',
      unit: 'm',
      usUnit: 'ft',
      initial: '0.5 0 0',
      when: (ch) => ch('on') === 'wire',
    },
    { id: 'B', label: `${K}.f.bfield`, kind: 'vector', dim: 'bfield', unit: 'T', initial: '0 0 0.5' },
  ],
  solve(read): Outcome {
    const B = read.vector('B', 3) as Vec;
    const N = (f: Vec) => vecText(f, 'N', 'force');
    if (read.choice('on') === 'wire') {
      const I = read.num('I');
      const L = read.vector('L', 3) as Vec;
      const F = scale(cross(L, B), I);
      return {
        ok: true,
        rows: forceRows(F),
        latex: '\\vec F=I\\vec L\\times\\vec B',
        steps: [
          {
            key: `${K}.s.wireForce`,
            vars: { I: q(I, 'A'), L: vecText(L, 'm', 'length'), B: vecText(B, 'T', 'bfield'), F: N(F) },
          },
        ],
        notes: [{ key: `${K}.notes.wireForce` }],
      };
    }
    const charge = read.num('q');
    if (charge === 0) fail(`${K}.errors.zeroCharge`);
    const m = read.opt('m', 'positive');
    const v = read.vector('v', 3) as Vec;
    const E = read.vector('E', 3) as Vec;
    const out = lorentz(charge, v, E, B, m);
    const rows = forceRows(out.force);
    const steps: KitStep[] = [
      {
        key: `${K}.s.lorentz`,
        vars: { q: qIn(charge, 'charge', 'C'), E: vecText(E, 'N/C', 'efield'), vB: N(out.magnetic), F: N(out.force) },
      },
    ];
    if (out.radius !== null && out.frequency !== null && out.pitch !== null) {
      rows.push(
        { key: `${K}.r.radius`, symbol: 'r', value: out.radius, dim: 'length', unit: 'm', usUnit: 'ft' },
        { key: `${K}.r.cyclotron`, symbol: 'f_c', value: out.frequency, dim: 'frequency', unit: 'Hz' },
        { key: `${K}.r.pitch`, symbol: 'p', value: out.pitch, dim: 'length', unit: 'm', usUnit: 'ft' },
      );
      steps.push({ key: `${K}.s.gyration`, vars: { r: q(out.radius, 'm'), f: q(out.frequency, 'Hz') } });
    }
    return {
      ok: true,
      rows,
      latex:
        '\\vec F=q\\left(\\vec E+\\vec v\\times\\vec B\\right),\\qquad r=\\frac{mv_\\perp}{|q|B},\\qquad f_c=\\frac{|q|B}{2\\pi m}',
      steps,
      notes: [{ key: `${K}.notes.lorentz` }],
    };
  },
};

const forceRows = (F: Vec): ResultRow[] => [
  { key: `${K}.r.force`, symbol: '|F|', value: norm(F), dim: 'force', unit: 'N', usUnit: 'lbf', primary: true },
  { key: `${K}.r.Fx`, symbol: 'F_x', value: F[0], dim: 'force', unit: 'N', usUnit: 'lbf' },
  { key: `${K}.r.Fy`, symbol: 'F_y', value: F[1], dim: 'force', unit: 'N', usUnit: 'lbf' },
  { key: `${K}.r.Fz`, symbol: 'F_z', value: F[2], dim: 'force', unit: 'N', usUnit: 'lbf' },
];

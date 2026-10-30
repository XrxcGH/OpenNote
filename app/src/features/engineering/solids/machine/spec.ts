// The machine design tool's form: the endurance limit with its Marin factors, fluctuating stresses on a fatigue
// diagram, life on the S-N line, Miner's rule, a DE-Goodman shaft, a bolted joint, a bearing's life, a helical
// spring, and Lewis bending of a gear tooth.
import { typedLines } from '../kit/lines';
import type { PlotSeries } from '../kit/picture';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import { fail, q } from '../kit/types';
import {
  bearingLife,
  boltedJoint,
  boltStiffness,
  cycles,
  endurance,
  fluctuating,
  lewis,
  lewisY,
  miner,
  shaftDiameter,
  spring,
  type Finish,
  type Loading,
  type Reliability,
  type Surface,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const or0 = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : 0);
const isMode =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(v.mode as string);
const stiffnesses = (v: Values) => v.mode === 'bolt' && v.stiffness === 'stiffnesses';
const line = (n: number, f: (u: number) => readonly [number, number]) => [...Array(n + 1).keys()].map((i) => f(i / n));

function runEndurance(values: Values): Outcome {
  const r = endurance({
    Sut: num(values, 'Sut'),
    surface: values.surface as Surface,
    loading: values.loading as Loading,
    d: num(values, 'd'),
    reliability: values.reliability as Reliability,
    kd: num(values, 'kd'),
    kf: num(values, 'kf'),
  });
  return {
    rows: [
      { id: 'prime', value: q(r.prime, 'stress'), sym: "S_e'" },
      { id: 'ka', value: r.ka, sym: 'k_a' },
      { id: 'kb', value: r.kb, sym: 'k_b' },
      { id: 'kc', value: r.kc, sym: 'k_c' },
      { id: 'ke', value: r.ke, sym: 'k_e' },
      { id: 'Se', value: q(r.Se, 'stress'), sym: 'S_e', answer: true },
    ],
    steps: r.steps,
    notes: ['marin', 'steel'],
  };
}

function runFluctuating(values: Values): Outcome {
  const [sa, sm, Se, Sut] = [num(values, 'sa'), num(values, 'sm'), num(values, 'Se'), num(values, 'Sut')];
  const Sy = num(values, 'Sy');
  const r = fluctuating({ sa, sm, Se, Sut, Sy });
  const rows: ResultRow[] = [
    { id: 'goodman', value: r.goodman, sym: 'n_{Goodman}', answer: true },
    { id: 'gerber', value: r.gerber, sym: 'n_{Gerber}' },
  ];
  if (r.elliptic !== undefined) rows.push({ id: 'elliptic', value: r.elliptic, sym: 'n_{ASME}' });
  if (r.soderberg !== undefined) rows.push({ id: 'soderberg', value: r.soderberg, sym: 'n_{Soderberg}' });
  if (r.langer !== undefined) rows.push({ id: 'langer', value: r.langer, sym: 'n_y', answer: true });
  const series: PlotSeries[] = [
    { id: 'goodmanLine', points: [[0, Se] as const, [Sut, 0] as const] },
    { id: 'gerberLine', points: line(40, (u) => [u * Sut, Se * (1 - u * u)] as const), dashed: true },
  ];
  if (Number.isFinite(Sy)) {
    series.push(
      {
        id: 'ellipse',
        points: line(40, (u) => [Sy * Math.sin((u * Math.PI) / 2), Se * Math.cos((u * Math.PI) / 2)] as const),
        dashed: true,
      },
      { id: 'langerLine', points: [[0, Sy] as const, [Sy, 0] as const] },
    );
  }
  const reach = Number.isFinite(r.goodman) ? r.goodman : 1;
  series.push({
    id: 'loadLine',
    points: [[0, 0] as const, [Math.max(sm, 0) * reach, sa * reach] as const],
    dashed: true,
  });
  return {
    rows,
    steps: r.steps,
    notes: ['fluctuatingNote', ...(sm < 0 ? ['compressiveMean'] : [])],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'mean', kind: 'stress' },
        y: { label: 'alternating', kind: 'stress' },
        series,
        marks: [{ x: sm, y: sa, id: 'here' }],
      },
    },
  };
}

function runLife(values: Values): Outcome {
  const [sa, sm, Se, Sut] = [num(values, 'sa'), num(values, 'sm'), num(values, 'Se'), num(values, 'Sut')];
  if (sm >= Sut) fail('seAboveSut');
  const sRev = sm > 0 ? sa / (1 - sm / Sut) : sa;
  const r = cycles(sRev, Sut, Se, num(values, 'f'));
  return {
    rows: [
      { id: 'sRev', value: q(sRev, 'stress'), sym: '\\sigma_{rev}' },
      { id: 'a', value: q(r.a, 'stress'), sym: 'a' },
      { id: 'b', value: r.b, sym: 'b' },
      { id: 'N', value: r.N, sym: 'N', answer: true },
    ],
    steps: [
      {
        key: 'machine.equivalent',
        math: '\\sigma_{rev} = \\frac{\\sigma_a}{1 - \\sigma_m/S_{ut}} = [[s]]',
        vars: { s: q(sRev, 'stress') },
      },
      {
        key: 'machine.sn',
        math:
          'a = \\frac{(f S_{ut})^2}{S_e} = [[a]], \\quad b = -\\tfrac13\\log\\frac{f S_{ut}}{S_e} = [[b]],' +
          ' \\quad N = \\left(\\frac{\\sigma_{rev}}{a}\\right)^{1/b} = [[N]]',
        vars: { a: q(r.a, 'stress'), b: r.b, N: r.N },
      },
    ],
    notes: ['snLine'],
  };
}

function runMiner(values: Values): Outcome {
  const blocks = typedLines(String(values.blocks)).map(({ words, line: at }) => {
    const n = words.map(Number);
    if (n.length !== 2 || !n.every(Number.isFinite)) fail('blockLine', String(at));
    return { n: n[0], N: n[1] };
  });
  const r = miner(blocks);
  return {
    rows: [
      { id: 'D', value: r.D, sym: 'D', answer: true },
      { id: 'left', value: Math.max(0, 1 - r.D) },
      { id: 'verdict', word: r.D >= 1 ? 'fails' : 'survives' },
    ],
    steps: r.steps,
    notes: ['minerNote'],
  };
}

function runShaft(values: Values): Outcome {
  const r = shaftDiameter({
    Ma: or0(values, 'Ma'),
    Mm: or0(values, 'Mm'),
    Ta: or0(values, 'Ta'),
    Tm: or0(values, 'Tm'),
    Kf: num(values, 'Kf'),
    Kfs: num(values, 'Kfs'),
    Se: num(values, 'Se'),
    Sut: num(values, 'Sut'),
    n: num(values, 'n'),
  });
  return {
    rows: [{ id: 'dShaft', value: q(r.d, 'length'), sym: 'd', answer: true }],
    steps: r.steps,
    notes: ['deGoodman'],
  };
}

function runBolt(values: Values): Outcome {
  const stiff =
    values.stiffness === 'stiffnesses'
      ? boltStiffness({
          d: num(values, 'dBolt'),
          At: num(values, 'At'),
          l: num(values, 'grip'),
          lt: num(values, 'lt'),
          E: num(values, 'Eb'),
          Em: num(values, 'Em'),
        })
      : null;
  const r = boltedJoint({
    At: num(values, 'At'),
    Sp: num(values, 'Sp'),
    fraction: num(values, 'fraction'),
    C: stiff ? stiff.C : num(values, 'C'),
    P: num(values, 'P'),
  });
  const stiffRows: ResultRow[] = stiff
    ? [
        { id: 'kBolt', value: q(stiff.kb, 'stiffness'), sym: 'k_b' },
        { id: 'kMember', value: q(stiff.km, 'stiffness'), sym: 'k_m' },
        { id: 'Cjoint', value: stiff.C, sym: 'C' },
      ]
    : [];
  return {
    rows: [
      ...stiffRows,
      { id: 'Fi', value: q(r.Fi, 'bigForce'), sym: 'F_i', answer: true },
      { id: 'Fb', value: q(r.Fb, 'bigForce'), sym: 'F_b', answer: true },
      { id: 'Fm', value: q(r.Fm, 'bigForce'), sym: 'F_m' },
      { id: 'sigmaB', value: q(r.sigmaB, 'stress'), sym: '\\sigma_b' },
      { id: 'P0', value: q(r.separation, 'bigForce'), sym: 'P_0' },
      { id: 'nLoad', value: r.nLoad, sym: 'n_L' },
      { id: 'nSep', value: r.nSeparation, sym: 'n_0' },
      { id: 'joint', word: r.closed ? 'closed' : 'open' },
    ],
    steps: [...(stiff ? stiff.steps : []), ...r.steps],
    notes: ['boltNote', ...(stiff ? ['boltStiffNote'] : [])],
  };
}

function runBearing(values: Values): Outcome {
  const r = bearingLife(num(values, 'Cr'), num(values, 'Pb'), values.kind === 'roller' ? 'roller' : 'ball');
  const rows: ResultRow[] = [
    { id: 'L10', value: r.L10, sym: 'L_{10}', answer: true },
    { id: 'exponent', value: r.a, sym: 'a' },
  ];
  if (Number.isFinite(num(values, 'rpm')) && num(values, 'rpm') > 0)
    rows.push({ id: 'hours', value: r.L10 / (num(values, 'rpm') * 3600), sym: 'L_{10h}' });
  return { rows, steps: r.steps, notes: ['bearingNote'] };
}

function runSpring(values: Values): Outcome {
  const r = spring(num(values, 'dw'), num(values, 'Dm'), num(values, 'Na'), num(values, 'G'), num(values, 'Fs'));
  const rows: ResultRow[] = [
    { id: 'k', value: q(r.k, 'stiffness'), sym: 'k', answer: true },
    { id: 'index', value: r.C, sym: 'C' },
    { id: 'KB', value: r.KB, sym: 'K_B' },
  ];
  if (r.tau !== undefined) rows.push({ id: 'tau', value: q(r.tau, 'stress'), sym: '\\tau', answer: true });
  if (r.y !== undefined) rows.push({ id: 'y', value: q(r.y, 'deflection'), sym: 'y' });
  return { rows, steps: r.steps, notes: ['springNote', ...(r.C < 4 || r.C > 12 ? ['springIndexRange'] : [])] };
}

function runGear(values: Values): Outcome {
  const finish = values.finish as Finish;
  if (finish !== 'none' && !(num(values, 'rpm') > 0)) fail('needSpeed');
  const V = finish === 'none' ? undefined : Math.PI * num(values, 'm') * num(values, 'teeth') * num(values, 'rpm');
  const typedY = Number.isFinite(num(values, 'Y'));
  const table = typedY ? null : lewisY(num(values, 'teeth'));
  const r = lewis(
    num(values, 'Wt'),
    num(values, 'Fw'),
    num(values, 'm'),
    table ? table.Y : num(values, 'Y'),
    finish,
    V,
  );
  const rows: ResultRow[] = [
    ...(table ? [{ id: 'YLewis', value: table.Y, sym: 'Y' }] : []),
    { id: 'Kv', value: r.Kv, sym: 'K_v' },
    { id: 'sigmaGear', value: q(r.sigma, 'stress'), sym: '\\sigma', answer: true },
  ];
  return {
    rows,
    steps: [
      ...(V === undefined
        ? []
        : [
            {
              key: 'machine.velocity' as const,
              math: 'V = \\pi m N_t n = [[V]]\\ \\mathrm{m/s}',
              vars: { V: V.toPrecision(5) },
            },
          ]),
      ...(table ? [table.step] : []),
      ...r.steps,
    ],
    notes: ['lewisNote', ...(table ? ['lewisTable'] : [])],
  };
}

const RUN: Record<string, (values: Values) => Outcome> = {
  endurance: runEndurance,
  fluctuating: runFluctuating,
  life: runLife,
  miner: runMiner,
  shaft: runShaft,
  bolt: runBolt,
  bearing: runBearing,
  spring: runSpring,
  gear: runGear,
};

export const machineSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'endurance' },
    {
      id: 'Sut',
      type: 'quantity',
      kind: 'stress',
      first: '600 MPa',
      when: isMode('endurance', 'fluctuating', 'life', 'shaft'),
    },
    {
      id: 'surface',
      type: 'choice',
      options: ['ground', 'machined', 'hotRolled', 'forged'],
      first: 'machined',
      when: isMode('endurance'),
    },
    {
      id: 'loading',
      type: 'choice',
      options: ['bending', 'axial', 'torsion'],
      first: 'bending',
      when: isMode('endurance'),
    },
    { id: 'd', type: 'quantity', kind: 'length', first: '30 mm', optional: true, when: isMode('endurance') },
    {
      id: 'reliability',
      type: 'choice',
      options: ['r50', 'r90', 'r95', 'r99', 'r999', 'r9999'],
      first: 'r50',
      when: isMode('endurance'),
    },
    { id: 'kd', type: 'quantity', kind: 'ratio', first: '1', when: isMode('endurance') },
    { id: 'kf', type: 'quantity', kind: 'ratio', first: '1', when: isMode('endurance') },
    { id: 'sa', type: 'quantity', kind: 'stress', first: '100 MPa', when: isMode('fluctuating', 'life') },
    { id: 'sm', type: 'quantity', kind: 'stress', first: '150 MPa', when: isMode('fluctuating', 'life') },
    { id: 'Se', type: 'quantity', kind: 'stress', first: '250 MPa', when: isMode('fluctuating', 'life', 'shaft') },
    { id: 'Sy', type: 'quantity', kind: 'stress', first: '', optional: true, when: isMode('fluctuating') },
    { id: 'f', type: 'quantity', kind: 'ratio', first: '0.9', when: isMode('life') },
    { id: 'blocks', type: 'text', rows: 4, first: '10000 50000\n200000 1000000', when: isMode('miner') },
    { id: 'Ma', type: 'quantity', kind: 'smallMoment', first: '70 N·m', optional: true, when: isMode('shaft') },
    { id: 'Mm', type: 'quantity', kind: 'smallMoment', first: '', optional: true, when: isMode('shaft') },
    { id: 'Ta', type: 'quantity', kind: 'smallMoment', first: '', optional: true, when: isMode('shaft') },
    { id: 'Tm', type: 'quantity', kind: 'smallMoment', first: '45 N·m', optional: true, when: isMode('shaft') },
    { id: 'Kf', type: 'quantity', kind: 'ratio', first: '1.7', when: isMode('shaft') },
    { id: 'Kfs', type: 'quantity', kind: 'ratio', first: '1.5', when: isMode('shaft') },
    { id: 'n', type: 'quantity', kind: 'ratio', first: '1.5', when: isMode('shaft') },
    { id: 'At', type: 'quantity', kind: 'area', first: '84.3 mm^2', when: isMode('bolt') },
    { id: 'Sp', type: 'quantity', kind: 'stress', first: '600 MPa', when: isMode('bolt') },
    { id: 'fraction', type: 'quantity', kind: 'ratio', first: '0.75', when: isMode('bolt') },
    { id: 'stiffness', type: 'choice', options: ['typed', 'stiffnesses'], first: 'typed', when: isMode('bolt') },
    {
      id: 'C',
      type: 'quantity',
      kind: 'ratio',
      first: '0.2',
      when: (v) => v.mode === 'bolt' && v.stiffness !== 'stiffnesses',
    },
    { id: 'dBolt', type: 'quantity', kind: 'length', first: '12 mm', when: stiffnesses },
    { id: 'grip', type: 'quantity', kind: 'length', first: '40 mm', when: stiffnesses },
    { id: 'lt', type: 'quantity', kind: 'length', first: '20 mm', when: stiffnesses },
    { id: 'Eb', type: 'quantity', kind: 'modulus', first: '200 GPa', when: stiffnesses },
    { id: 'Em', type: 'quantity', kind: 'modulus', first: '200 GPa', when: stiffnesses },
    { id: 'P', type: 'quantity', kind: 'bigForce', first: '10 kN', when: isMode('bolt') },
    { id: 'kind', type: 'choice', options: ['ball', 'roller'], first: 'ball', when: isMode('bearing') },
    { id: 'Cr', type: 'quantity', kind: 'bigForce', first: '30 kN', when: isMode('bearing') },
    { id: 'Pb', type: 'quantity', kind: 'bigForce', first: '5 kN', when: isMode('bearing') },
    { id: 'rpm', type: 'quantity', kind: 'speed', first: '', optional: true, when: isMode('bearing', 'gear') },
    { id: 'dw', type: 'quantity', kind: 'length', first: '3 mm', when: isMode('spring') },
    { id: 'Dm', type: 'quantity', kind: 'length', first: '24 mm', when: isMode('spring') },
    { id: 'Na', type: 'quantity', kind: 'count', first: '10', when: isMode('spring') },
    { id: 'G', type: 'quantity', kind: 'modulus', first: '79.3 GPa', when: isMode('spring') },
    { id: 'Fs', type: 'quantity', kind: 'smallForce', first: '', optional: true, when: isMode('spring') },
    { id: 'Wt', type: 'quantity', kind: 'bigForce', first: '2 kN', when: isMode('gear') },
    { id: 'Fw', type: 'quantity', kind: 'length', first: '25 mm', when: isMode('gear') },
    { id: 'm', type: 'quantity', kind: 'length', first: '3 mm', when: isMode('gear') },
    { id: 'Y', type: 'quantity', kind: 'ratio', first: '', optional: true, when: isMode('gear') },
    {
      id: 'finish',
      type: 'choice',
      options: ['none', 'cast', 'cut', 'hobbed', 'shaved'],
      first: 'none',
      when: isMode('gear'),
    },
    {
      id: 'teeth',
      type: 'quantity',
      kind: 'count',
      first: '20',
      when: isMode('gear'),
    },
  ],
  examples: [
    { id: 'marin', values: { mode: 'endurance', Sut: '600 MPa', surface: 'machined', loading: 'bending', d: '30 mm' } },
    {
      id: 'goodman',
      values: { mode: 'fluctuating', sa: '100 MPa', sm: '150 MPa', Se: '250 MPa', Sut: '600 MPa', Sy: '450 MPa' },
    },
    { id: 'life', values: { mode: 'life', sa: '300 MPa', sm: '0 MPa', Se: '250 MPa', Sut: '600 MPa', f: '0.9' } },
    { id: 'miner', values: { mode: 'miner', blocks: '10000 50000\n200000 1000000' } },
    { id: 'bolt', values: { mode: 'bolt', At: '84.3 mm^2', Sp: '600 MPa', fraction: '0.75', C: '0.2', P: '10 kN' } },
    {
      id: 'boltStiff',
      values: {
        mode: 'bolt',
        At: '84.3 mm^2',
        Sp: '600 MPa',
        fraction: '0.75',
        stiffness: 'stiffnesses',
        dBolt: '12 mm',
        grip: '40 mm',
        lt: '20 mm',
        Eb: '200 GPa',
        Em: '200 GPa',
        P: '10 kN',
      },
    },
    { id: 'bearing', values: { mode: 'bearing', kind: 'ball', Cr: '30 kN', Pb: '5 kN', rpm: '1500 rpm' } },
    { id: 'spring', values: { mode: 'spring', dw: '3 mm', Dm: '24 mm', Na: '10', G: '79.3 GPa', Fs: '50 N' } },
    {
      id: 'gear',
      values: {
        mode: 'gear',
        Wt: '2 kN',
        Fw: '25 mm',
        m: '3 mm',
        Y: '0.322',
        finish: 'hobbed',
        teeth: '20',
        rpm: '1200 rpm',
      },
    },
  ],
  run(values) {
    return (RUN[values.mode as string] ?? runEndurance)(values);
  },
};

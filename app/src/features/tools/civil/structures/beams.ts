// The structures tool's beam calculations: moment distribution with a slope-deflection check, fixed-end moments,
// influence lines, and moving loads.
import { grid, num, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, KitStep, Outcome } from '../core/types';
import {
  absoluteMaxMoment,
  beamDiagrams,
  fixedEnd,
  influence,
  maxEndShear,
  maxMomentAtSection,
  momentDistribution,
  triangularFixedEnd,
} from './engine';
import type { BeamSolution, Effect, EndSupport, Span } from './engine';

const ENDS = [
  ['pinned', 'structures.o.pinned'],
  ['fixed', 'structures.o.fixed'],
] as const;

function mdSteps(r: BeamSolution): KitStep[] {
  const diff = Math.max(
    ...r.moments.flatMap((pair, i) => [Math.abs(pair[0] - r.check[i]![0]), Math.abs(pair[1] - r.check[i]![1])]),
  );
  return [
    step('structures.md.s1', undefined, 'DF_i = \\frac{k_i}{\\sum k},\\quad k = \\frac{4EI}{L},\\quad CO = \\tfrac12'),
    ...r.fem.map(([a, b], i) => step('structures.md.fem', { span: i + 1, left: a, right: b })),
    ...r.factors.map(([a, b], j) => step('structures.md.df', { joint: j + 1, left: a, right: b })),
    step('structures.md.s2', { cycles: r.cycles }),
    ...r.moments.map(([a, b], i) => step('structures.md.final', { span: i + 1, left: a, right: b })),
    step('structures.md.check', { diff }, 'M_{ij} = \\frac{2EI}{L}(2\\theta_i + \\theta_j) + FEM_{ij}'),
    step('structures.md.reactions', { list: r.reactions.map((v) => v.toFixed(3)).join(', ') }),
  ];
}

const continuousCalc: Calc = {
  id: 'continuous',
  title: 'structures.md.title',
  intro: 'structures.md.intro',
  fields: [
    grid(
      'spans',
      'structures.f.spans',
      [
        ['structures.f.LCol', 'length'],
        ['structures.f.EICol'],
        ['structures.f.wCol', 'forcePerLength'],
        ['structures.f.PCol', 'force'],
        ['structures.f.aCol', 'length'],
      ],
      '6 1 10 0 0\n6 1 10 0 0',
    ),
    pick('left', 'structures.f.leftEnd', ENDS),
    pick('right', 'structures.f.rightEnd', ENDS),
  ],
  solve({ s, rows }): Outcome {
    const spans: Span[] = rows.spans!.map(([L, EI, w, P, a]) => ({ L: L!, EI: EI!, w: w!, P: P!, a: a! }));
    const r = momentDistribution(spans, (s.left ?? 'pinned') as EndSupport, (s.right ?? 'pinned') as EndSupport);
    const d = beamDiagrams(spans, r);
    const supports = spans.reduce<number[]>((acc, sp) => [...acc, acc[acc.length - 1]! + sp.L], [0]);
    const peak = d.reduce((best, p) => (Math.abs(p.M) > Math.abs(best.M) ? p : best), d[0]!);
    return {
      answer: { key: 'structures.md.answer', vars: { M: peak.M, x: peak.x } },
      rows: [
        ...r.reactions.map((v, i) => ({
          label: 'structures.r.reaction',
          value: `${i + 1}: ${v.toFixed(4)}`,
          unit: 'kN',
        })),
        row('structures.r.Mmax', peak.M, 'kN·m'),
      ],
      steps: mdSteps(r),
      latex: r.moments.map(([a, b], i) => `M_{${i + 1}L} = ${tex(a)},\\ M_{${i + 1}R} = ${tex(b)}`).join(';\\ '),
      notes: [{ key: 'structures.md.note' }],
      plot: {
        title: 'structures.p.diagrams',
        x: 'structures.p.x',
        y: 'structures.p.value',
        series: [
          { name: 'structures.p.moment', points: d.map((p) => [p.x, p.M] as const) },
          { name: 'structures.p.shear', points: d.map((p) => [p.x, p.V] as const), style: 'dashed' },
          { name: 'structures.p.supports', points: supports.map((x) => [x, 0] as const), style: 'points' },
        ],
      },
      grid: {
        caption: 'structures.g.table',
        header: ['structures.g.cycle', ...spans.flatMap(() => ['structures.g.left', 'structures.g.right'])],
        rows: r.table.map((cycle, i) => [i === 0 ? '~structures.g.femRow' : i, ...cycle]),
      },
    };
  },
};

const femCalc: Calc = {
  id: 'fem',
  title: 'structures.fem.title',
  fields: (choices) => [
    pick('load', 'structures.f.load', [
      ['point', 'structures.o.point'],
      ['udl', 'structures.o.udl'],
      ['triangle', 'structures.o.triangle'],
    ]),
    num('L', 'structures.f.L', '8', 'length'),
    ...(choices.load === 'udl' || choices.load === 'triangle'
      ? [num('w', 'structures.f.w', '10', 'forcePerLength')]
      : [num('P', 'structures.f.P', '40', 'force'), num('a', 'structures.f.a', '4', 'length')]),
  ],
  solve({ n, s }): Outcome {
    const L = n.L!;
    const [l, r] =
      s.load === 'triangle'
        ? triangularFixedEnd(L, n.w!)
        : s.load === 'udl'
          ? fixedEnd(L, { w: n.w!, P: 0, a: 0 })
          : fixedEnd(L, { w: 0, P: n.P!, a: n.a! });
    const eq =
      s.load === 'triangle'
        ? 'FEM_{AB} = -\\frac{wL^2}{30},\\ FEM_{BA} = \\frac{wL^2}{20}'
        : s.load === 'udl'
          ? 'FEM = \\mp\\frac{wL^2}{12}'
          : 'FEM_{AB} = -\\frac{P a b^2}{L^2},\\ FEM_{BA} = \\frac{P a^2 b}{L^2}';
    return {
      answer: { key: 'structures.fem.answer', vars: { left: l, right: r } },
      rows: [row('structures.r.femLeft', l, 'kN·m'), row('structures.r.femRight', r, 'kN·m')],
      steps: [
        step(`structures.fem.${s.load ?? 'point'}`, { left: l, right: r }, `${eq} \\Rightarrow ${tex(l)},\\ ${tex(r)}`),
      ],
      latex: `FEM_{AB} = ${tex(l)},\\quad FEM_{BA} = ${tex(r)}\\ \\mathrm{kN\\cdot m}`,
      notes: [{ key: 'structures.fem.note' }],
    };
  },
};

const influenceCalc: Calc = {
  id: 'influence',
  title: 'structures.il.title',
  fields: [
    pick('effect', 'structures.f.effect', [
      ['M', 'structures.o.M'],
      ['V', 'structures.o.V'],
      ['RA', 'structures.o.RA'],
      ['RB', 'structures.o.RB'],
    ]),
    num('L', 'structures.f.L', '20', 'length'),
    num('x', 'structures.f.x', '10', 'length'),
    num('w', 'structures.f.wMoving', '0', 'forcePerLength'),
    num('P', 'structures.f.PMoving', '0', 'force'),
  ],
  solve({ n, s }): Outcome {
    const effect = (s.effect ?? 'M') as Effect;
    const L = n.L!;
    const x = n.x!;
    const xs = [...linspace(0, L, 201), ...(effect === 'V' ? [x - 1e-9 * L, x + 1e-9 * L] : [])].sort((a, b) => a - b);
    const pts = xs.filter((v) => v >= 0 && v <= L).map((xi) => [xi, influence(effect, L, x, xi)] as const);
    const peak = pts.reduce((b, p) => (Math.abs(p[1]) > Math.abs(b[1]) ? p : b), pts[0]!);
    let pos = 0;
    let neg = 0;
    for (let i = 1; i < pts.length; i++) {
      const area = ((pts[i]![1] + pts[i - 1]![1]) / 2) * (pts[i]![0] - pts[i - 1]![0]);
      if (area > 0) pos += area;
      else neg += area;
    }
    const maxEffect = n.w! * pos + n.P! * Math.max(0, ...pts.map((p) => p[1]));
    return {
      answer: { key: 'structures.il.answer', vars: { peak: peak[1], at: peak[0] } },
      rows: [
        row('structures.r.peak', peak[1]),
        row('structures.r.at', peak[0], 'm'),
        row('structures.r.posArea', pos),
        row('structures.r.negArea', neg),
        ...(n.w! > 0 || n.P! > 0 ? [row('structures.r.maxEffect', maxEffect)] : []),
      ],
      steps: [
        step(`structures.il.${effect}`, { x, L }),
        step('structures.il.mb'),
        step('structures.il.areas', { pos, neg }),
        ...(n.w! > 0 || n.P! > 0 ? [step('structures.il.max', { value: maxEffect })] : []),
      ],
      latex: `\\max = ${tex(peak[1])}\\ \\text{at}\\ \\xi = ${tex(peak[0])}\\ \\mathrm{m}`,
      plot: {
        title: 'structures.p.il',
        x: 'structures.p.xi',
        y: 'structures.p.ordinate',
        series: [{ name: 'structures.p.il', points: pts }],
      },
    };
  },
};

const movingCalc: Calc = {
  id: 'moving',
  title: 'structures.mv.title',
  intro: 'structures.mv.intro',
  fields: [
    grid(
      'axles',
      'structures.f.axles',
      [
        ['structures.f.PCol', 'force'],
        ['structures.f.dCol', 'length'],
      ],
      '100 0\n100 4',
    ),
    num('L', 'structures.f.L', '20', 'length'),
    num('x', 'structures.f.xSection', '10', 'length'),
  ],
  solve({ n, rows }): Outcome {
    const axles = rows.axles!.map(([P, d]) => ({ P: P!, d: d! }));
    const L = n.L!;
    const abs = absoluteMaxMoment(axles, L);
    const atX = maxMomentAtSection(axles, L, n.x!);
    const V = maxEndShear(axles, L);
    return {
      answer: { key: 'structures.mv.answer', vars: { M: abs.M, x: abs.x, axle: abs.axle + 1 } },
      rows: [
        row('structures.r.absM', abs.M, 'kN·m'),
        row('structures.r.absAt', abs.x, 'm'),
        row('structures.r.Mx', atX.M, 'kN·m'),
        row('structures.r.Vmax', V.V, 'kN'),
      ],
      steps: [
        step('structures.mv.s1', { axle: abs.axle + 1, x: abs.x, s: abs.s }),
        step('structures.mv.s2', { M: abs.M }),
        step('structures.mv.s3', { M: atX.M, axle: atX.axle + 1, x: n.x! }),
        step('structures.mv.s4', { V: V.V, axle: V.axle + 1 }),
      ],
      latex: `M_{abs,max} = ${tex(abs.M)}\\ \\mathrm{kN\\cdot m}`,
      plot: {
        title: 'structures.p.envelope',
        x: 'structures.p.x',
        y: 'structures.p.Mmax',
        series: [
          {
            name: 'structures.p.Mmax',
            points: linspace(0, L, 81).map((x) => [x, maxMomentAtSection(axles, L, x).M] as const),
          },
          { name: 'structures.p.absPoint', points: [[abs.x, abs.M] as const], style: 'points' },
        ],
      },
    };
  },
};

export const BEAM_CALCS: readonly Calc[] = [continuousCalc, femCalc, influenceCalc, movingCalc];

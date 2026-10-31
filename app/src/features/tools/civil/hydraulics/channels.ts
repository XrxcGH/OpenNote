// The hydraulics tool's open-channel and pipe-network calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Field, Outcome } from '../core/types';
import {
  classify,
  criticalDepth,
  directStep,
  froude,
  geometry,
  hardyCross,
  jump,
  manning,
  normalDepth,
  specificEnergy,
  weirFlow,
} from './engine';
import type { Section } from './engine';

const sectionFields = (choices: Readonly<Record<string, string>>): Field[] => [
  pick('shape', 'hydraulics.f.shape', [
    ['rectangle', 'hydraulics.o.rectangle'],
    ['trapezoid', 'hydraulics.o.trapezoid'],
    ['triangle', 'hydraulics.o.triangle'],
    ['circle', 'hydraulics.o.circle'],
  ]),
  ...(choices.shape === 'circle'
    ? [num('D', 'hydraulics.f.D', '2.5', 'length')]
    : choices.shape === 'triangle'
      ? [num('z', 'hydraulics.f.z', '2')]
      : choices.shape === 'trapezoid'
        ? [num('b', 'hydraulics.f.b', '3', 'length'), num('z', 'hydraulics.f.z', '2')]
        : [num('b', 'hydraulics.f.b', '3', 'length')]),
];

function readSection(n: Readonly<Record<string, number>>, shape: string | undefined): Section {
  if (shape === 'circle') return { kind: 'circle', D: n.D! };
  if (shape === 'triangle') return { kind: 'triangle', z: n.z! };
  if (shape === 'trapezoid') return { kind: 'trapezoid', b: n.b!, z: n.z! };
  return { kind: 'rectangle', b: n.b! };
}

const manningCalc: Calc = {
  id: 'manning',
  title: 'hydraulics.manning.title',
  fields: (choices) => [
    ...sectionFields(choices),
    num('n', 'hydraulics.f.n', '0.015'),
    num('S', 'hydraulics.f.S', '0.001'),
    pick('find', 'hydraulics.f.find', [
      ['Q', 'hydraulics.o.findQ'],
      ['y', 'hydraulics.o.findY'],
    ]),
    ...(choices.find === 'y'
      ? [num('Q', 'hydraulics.f.Q', '4.5', 'flow')]
      : [num('y', 'hydraulics.f.y', '1', 'length')]),
  ],
  solve({ n, s }): Outcome {
    const sec = readSection(n, s.shape);
    const y = s.find === 'y' ? normalDepth(sec, n.Q!, n.n!, n.S!) : n.y!;
    const Q = s.find === 'y' ? n.Q! : manning(sec, y, n.n!, n.S!);
    const g = geometry(sec, y);
    const yc = criticalDepth(sec, Q);
    const Fr = froude(sec, Q, y);
    return {
      answer: {
        key: s.find === 'y' ? 'hydraulics.manning.depthAnswer' : 'hydraulics.manning.answer',
        vars: { Q, y, regime: Fr < 1 ? '~hydraulics.o.subcritical' : '~hydraulics.o.supercritical' },
      },
      rows: [
        row('hydraulics.r.Qflow', Q, 'm³/s'),
        row('hydraulics.r.yn', y, 'm'),
        row('hydraulics.r.A', g.A, 'm²'),
        row('hydraulics.r.P', g.P, 'm'),
        row('hydraulics.r.R', g.R, 'm'),
        row('hydraulics.r.V', Q / g.A, 'm/s'),
        row('hydraulics.r.Fr', Fr),
        row('hydraulics.r.yc', yc, 'm'),
      ],
      steps: [
        step(
          'hydraulics.manning.s1',
          { A: g.A, P: g.P, R: g.R },
          `A = ${tex(g.A)},\\ P = ${tex(g.P)},\\ R = A/P = ${tex(g.R)}`,
        ),
        step(
          s.find === 'y' ? 'hydraulics.manning.s2y' : 'hydraulics.manning.s2',
          { Q, y },
          `Q = \\frac{1}{n} A R^{2/3} S^{1/2} = ${tex(Q)}\\ \\mathrm{m^3/s}`,
        ),
        step('hydraulics.manning.s3', { Fr, yc }, `Fr = \\frac{V}{\\sqrt{g D_h}} = ${tex(Fr)}`),
      ],
      latex: `Q = \\frac{1}{n} A R^{2/3} S^{1/2} = ${tex(Q)}\\ \\mathrm{m^3/s}`,
      notes: [{ key: 'hydraulics.manning.note' }],
    };
  },
};

const energyCalc: Calc = {
  id: 'energy',
  title: 'hydraulics.energy.title',
  fields: (choices) => [
    ...sectionFields(choices),
    num('Q', 'hydraulics.f.Q', '4.5', 'flow'),
    opt('y', 'hydraulics.f.yOpt', '', 'length'),
  ],
  solve({ n, o, s }): Outcome {
    const sec = readSection(n, s.shape);
    const Q = n.Q!;
    const yc = criticalDepth(sec, Q);
    const Ec = specificEnergy(sec, Q, yc);
    const top = sec.kind === 'circle' ? sec.D * 0.99 : Math.max(yc * 4, (o.y ?? 0) * 1.5);
    const ys = linspace(yc * 0.25, top, 80);
    const M = (y: number) => {
      const g = geometry(sec, y);
      // The centroid depth of the flow area, by integrating the width over depth.
      const N = 200;
      let first = 0;
      for (let i = 0; i < N; i++) {
        const eta = ((i + 0.5) * y) / N;
        const w = geometry(sec, Math.max(eta, 1e-12)).T;
        first += w * (y - eta) * (y / N);
      }
      return (Q * Q) / (9.80665 * g.A) + first;
    };
    const alt =
      o.y === null
        ? null
        : (() => {
            const E = specificEnergy(sec, Q, o.y);
            return { E, Fr: froude(sec, Q, o.y) };
          })();
    return {
      answer: { key: 'hydraulics.energy.answer', vars: { yc, Ec } },
      rows: [
        row('hydraulics.r.yc', yc, 'm'),
        row('hydraulics.r.Ec', Ec, 'm'),
        ...(alt ? [row('hydraulics.r.E', alt.E, 'm'), row('hydraulics.r.Fr', alt.Fr)] : []),
      ],
      steps: [
        step('hydraulics.energy.s1', { yc }, `\\frac{Q^2 T}{g A^3} = 1 \\Rightarrow y_c = ${tex(yc)}\\ \\mathrm{m}`),
        step('hydraulics.energy.s2', { Ec }, `E_c = y_c + \\frac{Q^2}{2 g A_c^2} = ${tex(Ec)}\\ \\mathrm{m}`),
        ...(alt ? [step('hydraulics.energy.s3', { E: alt.E, Fr: alt.Fr })] : []),
      ],
      latex: `y_c = ${tex(yc)}\\ \\mathrm{m},\\quad E_{min} = ${tex(Ec)}\\ \\mathrm{m}`,
      plot: {
        title: 'hydraulics.p.energy',
        x: 'hydraulics.p.E',
        y: 'hydraulics.p.y',
        series: [
          { name: 'hydraulics.p.E', points: ys.map((y) => [specificEnergy(sec, Q, y), y] as const) },
          { name: 'hydraulics.p.M', points: ys.map((y) => [M(y), y] as const), style: 'dashed' },
          { name: 'hydraulics.p.critical', points: [[Ec, yc] as const], style: 'points' },
        ],
      },
    };
  },
};

const jumpCalc: Calc = {
  id: 'jump',
  title: 'hydraulics.jump.title',
  fields: [num('q', 'hydraulics.f.q', '1.5', 'flowPerWidth'), num('y1', 'hydraulics.f.y1', '0.3', 'length')],
  solve({ n }): Outcome {
    const j = jump(n.q!, n.y1!);
    return {
      answer: { key: 'hydraulics.jump.answer', vars: { y2: j.y2, loss: j.loss } },
      rows: [
        row('hydraulics.r.Fr1', j.Fr1),
        row('hydraulics.r.y2', j.y2, 'm'),
        row('hydraulics.r.Fr2', j.Fr2),
        row('hydraulics.r.loss', j.loss, 'm'),
        row('hydraulics.r.efficiency', j.efficiency),
      ],
      steps: [
        step('hydraulics.jump.s1', { Fr: j.Fr1 }, `Fr_1 = \\frac{q}{y_1\\sqrt{g y_1}} = ${tex(j.Fr1)}`),
        step(
          'hydraulics.jump.s2',
          { y2: j.y2 },
          `y_2 = \\frac{y_1}{2}\\left(\\sqrt{1 + 8 Fr_1^2} - 1\\right) = ${tex(j.y2)}\\ \\mathrm{m}`,
        ),
        step(
          'hydraulics.jump.s3',
          { loss: j.loss },
          `\\Delta E = \\frac{(y_2 - y_1)^3}{4 y_1 y_2} = ${tex(j.loss)}\\ \\mathrm{m}`,
        ),
      ],
      latex: `y_2 = ${tex(j.y2)}\\ \\mathrm{m},\\quad \\Delta E = ${tex(j.loss)}\\ \\mathrm{m}`,
    };
  },
};

const gvfCalc: Calc = {
  id: 'gvf',
  title: 'hydraulics.gvf.title',
  intro: 'hydraulics.gvf.intro',
  fields: (choices) => [
    ...sectionFields(choices),
    num('Q', 'hydraulics.f.Q', '4.5', 'flow'),
    num('n', 'hydraulics.f.n', '0.015'),
    num('S0', 'hydraulics.f.S0', '0.001'),
    num('y1', 'hydraulics.f.yControl', '2', 'length'),
    opt('y2', 'hydraulics.f.yEnd', '', 'length'),
    num('steps', 'hydraulics.f.steps', '40'),
  ],
  solve({ n, o, s }): Outcome {
    const sec = readSection(n, s.shape);
    const Q = n.Q!;
    const yc = criticalDepth(sec, Q);
    const yn = n.S0! > 0 ? normalDepth(sec, Q, n.n!, n.S0!) : null;
    const type = classify(n.S0!, n.y1!, yn, yc);
    // Toward normal depth by default, stopping just short since the profile only approaches it.
    const target =
      o.y2 ?? (yn !== null ? yn + (n.y1! > yn ? 0.01 : -0.01) * Math.abs(n.y1! - yn) : yc * (n.y1! > yc ? 1.01 : 0.99));
    const p = directStep(sec, Q, n.n!, n.S0!, n.y1!, target, Math.round(n.steps!));
    return {
      answer: {
        key: 'hydraulics.gvf.answer',
        vars: {
          type,
          L: Math.abs(p.length),
          dir: p.length < 0 ? '~hydraulics.o.upstream' : '~hydraulics.o.downstream',
        },
      },
      rows: [
        row('hydraulics.r.profile', type),
        ...(yn === null ? [] : [row('hydraulics.r.yn', yn, 'm')]),
        row('hydraulics.r.yc', yc, 'm'),
        row('hydraulics.r.length', p.length, 'm'),
      ],
      steps: [
        step('hydraulics.gvf.s1', { yc, yn: yn ?? '~hydraulics.o.none', type }),
        step(
          'hydraulics.gvf.s2',
          undefined,
          '\\Delta x = \\frac{E_2 - E_1}{S_0 - \\bar S_f},\\quad S_f = \\left(\\frac{n Q}{A R^{2/3}}\\right)^2',
        ),
        step('hydraulics.gvf.s3', { L: p.length }),
      ],
      latex: `L = ${tex(p.length)}\\ \\mathrm{m}\\ (${type})`,
      plot: {
        title: 'hydraulics.p.profile',
        x: 'hydraulics.p.x',
        y: 'hydraulics.p.y',
        series: [
          { name: 'hydraulics.p.surface', points: p.points },
          ...(yn === null
            ? []
            : [
                {
                  name: 'hydraulics.p.normal',
                  points: [[p.points[0]![0], yn] as const, [p.length, yn] as const],
                  style: 'dashed' as const,
                },
              ]),
          {
            name: 'hydraulics.p.criticalLine',
            points: [[p.points[0]![0], yc] as const, [p.length, yc] as const],
            style: 'dashed',
          },
        ],
      },
      grid: {
        caption: 'hydraulics.g.profile',
        header: ['hydraulics.g.x', 'hydraulics.g.y'],
        rows: p.points.map((pt) => [pt[0], pt[1]]),
      },
    };
  },
};

const weirCalc: Calc = {
  id: 'weir',
  title: 'hydraulics.weir.title',
  fields: (choices) => [
    pick('kind', 'hydraulics.f.structure', [
      ['rect', 'hydraulics.o.rectWeir'],
      ['vnotch', 'hydraulics.o.vnotch'],
      ['orifice', 'hydraulics.o.orifice'],
    ]),
    num('Cd', 'hydraulics.f.Cd', choices.kind === 'vnotch' ? '0.58' : choices.kind === 'orifice' ? '0.6' : '0.62'),
    num('H', 'hydraulics.f.H', '0.3', 'length'),
    choices.kind === 'vnotch'
      ? num('size', 'hydraulics.f.notch', '90', 'angle')
      : choices.kind === 'orifice'
        ? num('size', 'hydraulics.f.Ao', '0.05', 'area')
        : num('size', 'hydraulics.f.Lw', '2', 'length'),
  ],
  solve({ n, s }): Outcome {
    const kind = (s.kind ?? 'rect') as 'rect' | 'vnotch' | 'orifice';
    const Q = weirFlow(kind, n.Cd!, n.H!, n.size!);
    const eq =
      kind === 'rect'
        ? 'Q = C_d \\tfrac23 \\sqrt{2g}\\,L H^{3/2}'
        : kind === 'vnotch'
          ? 'Q = C_d \\tfrac{8}{15} \\sqrt{2g}\\,\\tan\\tfrac\\theta2\\,H^{5/2}'
          : 'Q = C_d A \\sqrt{2 g H}';
    return {
      answer: { key: 'hydraulics.weir.answer', vars: { Q } },
      rows: [row('hydraulics.r.Qflow', Q, 'm³/s')],
      steps: [step(`hydraulics.weir.${kind}`, { Q }, `${eq} = ${tex(Q)}\\ \\mathrm{m^3/s}`)],
      latex: `${eq} = ${tex(Q)}\\ \\mathrm{m^3/s}`,
      notes: [{ key: 'hydraulics.weir.note' }],
      plot: {
        title: 'hydraulics.p.rating',
        x: 'hydraulics.p.H',
        y: 'hydraulics.p.Q',
        series: [
          {
            name: 'hydraulics.p.rating',
            points: linspace(n.H! / 20, n.H! * 2, 40).map((H) => [H, weirFlow(kind, n.Cd!, H, n.size!)] as const),
          },
        ],
      },
    };
  },
};

const networkCalc: Calc = {
  id: 'network',
  title: 'hydraulics.net.title',
  intro: 'hydraulics.net.intro',
  fields: [
    grid(
      'pipes',
      'hydraulics.f.pipes',
      [
        ['hydraulics.f.kCol'],
        ['hydraulics.f.eCol'],
        ['hydraulics.f.q0Col', 'flow'],
        ['hydraulics.f.loop1Col'],
        ['hydraulics.f.loop2Col'],
      ],
      '1 2 1.5 1 0\n4 2 1.5 -1 0',
      2,
    ),
  ],
  solve({ rows }): Outcome {
    const pipes = rows.pipes!.map(([k, e, Q0, l1, l2]) => ({ k: k!, e: e!, Q0: Q0!, loops: [l1!, l2!] }));
    const r = hardyCross(pipes);
    return {
      answer: { key: 'hydraulics.net.answer', vars: { count: r.iterations } },
      rows: r.Q.map((q, i) => ({
        label: 'hydraulics.r.pipeFlow',
        value: `${i + 1}: ${q.toPrecision(6)}`,
        unit: 'm³/s',
      })),
      steps: [
        step('hydraulics.net.s1', undefined, '\\Delta Q = -\\frac{\\sum h}{e \\sum |h / Q|},\\quad h = k Q |Q|^{e-1}'),
        step('hydraulics.net.s2', { count: r.iterations, first: r.history[0]!.map((v) => v.toFixed(4)).join(', ') }),
        step('hydraulics.net.s3'),
      ],
      latex: r.Q.map((q, i) => `Q_{${i + 1}} = ${tex(q)}`).join(',\\ '),
      notes: [{ key: 'hydraulics.net.note' }],
      grid: {
        caption: 'hydraulics.g.pipes',
        header: ['hydraulics.g.pipe', 'hydraulics.g.Q', 'hydraulics.g.h'],
        rows: r.Q.map((q, i) => [i + 1, q, r.heads[i]!]),
      },
    };
  },
};

export const CHANNEL_CALCS: readonly Calc[] = [manningCalc, energyCalc, jumpCalc, gvfCalc, weirCalc, networkCalc];

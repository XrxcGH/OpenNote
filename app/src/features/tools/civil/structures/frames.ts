// The structures tool's truss, lateral-load, and earthquake calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { logspace } from '../core/num';
import { need } from '../core/types';
import type { Calc, Outcome } from '../core/types';
import { frameMdCalc } from './frameCalc';
import { cantilever, modalCombination, portal, responseSpectrum, trussInfluence } from './engine';

const PRATT_JOINTS = '0 0 1\n3 0 0\n6 0 0\n9 0 0\n12 0 2\n3 3 0\n6 3 0\n9 3 0';
const PRATT_MEMBERS = '1 2\n2 3\n3 4\n4 5\n6 7\n7 8\n1 6\n2 6\n3 7\n4 8\n8 5\n2 7\n4 7';

const trussCalc: Calc = {
  id: 'truss',
  title: 'structures.truss.title',
  intro: 'structures.truss.intro',
  fields: [
    grid(
      'joints',
      'structures.f.joints',
      [['structures.f.xCol', 'length'], ['structures.f.yCol', 'length'], ['structures.f.supportCol']],
      PRATT_JOINTS,
      3,
    ),
    grid('members', 'structures.f.members', [['structures.f.aJoint'], ['structures.f.bJoint']], PRATT_MEMBERS, 3),
    grid('deck', 'structures.f.deck', [['structures.f.jointCol']], '1\n2\n3\n4\n5', 2),
    num('member', 'structures.f.member', '2'),
  ],
  solve({ n, rows }): Outcome {
    const joints = rows.joints!.map(([x, y, support]) => ({ x: x!, y: y!, support: Math.round(support!) }));
    const members = rows.members!.map(([a, b]) => ({ a: Math.round(a!), b: Math.round(b!) }));
    const deck = rows.deck!.map((r) => Math.round(r[0]!));
    const member = Math.round(n.member!);
    const il = trussInfluence({ joints, members }, member, deck);
    const xs = deck.map((j) => joints[j - 1]!.x);
    const max = Math.max(...il);
    const min = Math.min(...il);
    return {
      answer: { key: 'structures.truss.answer', vars: { member, max, min } },
      rows: [row('structures.r.ilMax', max), row('structures.r.ilMin', min)],
      steps: [
        step('structures.truss.s1', { count: deck.length }),
        step('structures.truss.s2', { max, min }),
        step('structures.truss.s3'),
      ],
      latex: `F_{${member}}:\\ \\max = ${tex(max)},\\ \\min = ${tex(min)}`,
      plot: {
        title: 'structures.p.trussIl',
        x: 'structures.p.x',
        y: 'structures.p.ordinate',
        series: [{ name: 'structures.p.il', points: xs.map((x, i) => [x, il[i]!] as const) }],
      },
      grid: {
        caption: 'structures.g.trussIl',
        header: ['structures.g.joint', 'structures.g.x', 'structures.g.force'],
        rows: deck.map((j, i) => [j, xs[i]!, il[i]!]),
      },
    };
  },
};

const lateralCalc: Calc = {
  id: 'lateral',
  title: 'structures.lat.title',
  intro: 'structures.lat.intro',
  fields: (choices) => [
    pick('method', 'structures.f.method', [
      ['portal', 'structures.o.portal'],
      ['cantilever', 'structures.o.cantilever'],
    ]),
    grid(
      'stories',
      'structures.f.stories',
      [
        ['structures.f.FCol', 'force'],
        ['structures.f.hCol', 'length'],
      ],
      '20 4',
    ),
    ...(choices.method === 'cantilever'
      ? [grid('columns', 'structures.f.columns', [['structures.f.xCol', 'length']], '0\n6\n12', 2)]
      : [num('bays', 'structures.f.bays', '1'), num('bay', 'structures.f.bay', '6', 'length')]),
  ],
  solve({ n, s, rows }): Outcome {
    let V = 0;
    const stories = rows.stories!.map(([F, h]) => {
      V += F!;
      return { V, h: h! };
    });
    if (s.method === 'cantilever') {
      const xs = rows.columns!.map((r) => r[0]!);
      const c = cantilever(stories, xs);
      return {
        answer: { key: 'structures.lat.cantAnswer', vars: { N: Math.max(...c[c.length - 1]!.axial.map(Math.abs)) } },
        rows: c.map((r, i) => ({
          label: 'structures.r.overturning',
          value: `${i + 1}: ${r.Mo.toFixed(3)}`,
          unit: 'kN·m',
        })),
        steps: [
          step('structures.lat.c1', undefined, 'N_i = \\frac{M_o\\, d_i}{\\sum d^2}'),
          ...c.map((r, i) =>
            step('structures.lat.c2', { story: i + 1, Mo: r.Mo, list: r.axial.map((v) => v.toFixed(3)).join(', ') }),
          ),
        ],
        latex: c.map((r, i) => `M_{o,${i + 1}} = ${tex(r.Mo)}`).join(',\\ '),
        grid: {
          caption: 'structures.g.axial',
          header: ['structures.g.story', ...xs.map(() => 'structures.g.column')],
          rows: c.map((r, i) => [i + 1, ...r.axial]),
        },
      };
    }
    const p = portal(stories, Math.round(n.bays!), n.bay!);
    const top = p.rows[0]!;
    return {
      answer: { key: 'structures.lat.portalAnswer', vars: { ext: top.ext, int: top.int, M: top.Mext } },
      rows: [
        row('structures.r.extShear', top.ext, 'kN'),
        row('structures.r.intShear', top.int, 'kN'),
        row('structures.r.extMoment', top.Mext, 'kN·m'),
        row('structures.r.intMoment', top.Mint, 'kN·m'),
      ],
      steps: [
        step(
          'structures.lat.p1',
          undefined,
          'V_{ext} = \\frac{V}{2n},\\quad V_{int} = \\frac{V}{n},\\quad M = V_{col}\\frac{h}{2}',
        ),
        ...p.rows.map((r, i) =>
          step('structures.lat.p2', { story: i + 1, V: r.V, ext: r.ext, int: r.int, Mext: r.Mext, Mint: r.Mint }),
        ),
        ...p.beams.map((b, i) => step('structures.lat.p3', { story: i + 1, M: b.M, V: b.V })),
      ],
      latex: `V_{ext} = ${tex(top.ext)}\\ \\mathrm{kN},\\ M_{ext} = ${tex(top.Mext)}\\ \\mathrm{kN\\cdot m}`,
      grid: {
        caption: 'structures.g.portal',
        header: [
          'structures.g.story',
          'structures.g.V',
          'structures.g.ext',
          'structures.g.int',
          'structures.g.Mext',
          'structures.g.Mint',
          'structures.g.beamM',
        ],
        rows: p.rows.map((r, i) => [i + 1, r.V, r.ext, r.int, r.Mext, r.Mint, p.beams[i]!.M]),
      },
    };
  },
};

const RECORD = Array.from({ length: 41 }, (_, i) => {
  const t = i * 0.05;
  return `${t.toFixed(2)} ${(Math.sin(2 * Math.PI * 2 * t) * Math.exp(-t)).toFixed(4)}`;
}).join('\n');

const spectrumCalc: Calc = {
  id: 'spectrum',
  title: 'structures.sp.title',
  intro: 'structures.sp.intro',
  fields: [
    grid('record', 'structures.f.record', [['structures.f.tCol', 'seconds'], ['structures.f.agCol']], RECORD, 3),
    pick('units', 'structures.f.agUnits', [
      ['g', 'structures.o.g'],
      ['ms2', 'structures.o.ms2'],
    ]),
    num('zeta', 'structures.f.zeta', '0.05'),
    num('Tmin', 'structures.f.Tmin', '0.05', 'seconds'),
    num('Tmax', 'structures.f.Tmax', '3', 'seconds'),
    opt('T', 'structures.f.Tread', '1', 'seconds'),
  ],
  solve({ n, o, s, rows }): Outcome {
    const data = rows.record!;
    const dt = data[1]![0]! - data[0]![0]!;
    need(dt > 0, 'structures.errors.step');
    for (let i = 1; i < data.length; i++)
      need(Math.abs(data[i]![0]! - data[i - 1]![0]! - dt) <= 1e-6 * dt, 'structures.errors.step');
    const scale = s.units === 'ms2' ? 1 : 9.80665;
    const ag = data.map((r) => r[1]! * scale);
    const periods = logspace(n.Tmin!, n.Tmax!, 40);
    const sp = responseSpectrum(ag, dt, n.zeta!, periods);
    const at = o.T === null ? null : responseSpectrum(ag, dt, n.zeta!, [o.T])[0]!;
    const pga = Math.max(...ag.map(Math.abs));
    return {
      answer: at
        ? { key: 'structures.sp.answer', vars: { T: at.T, Sa: at.Sa / 9.80665, Sd: at.Sd * 1000 } }
        : { key: 'structures.sp.answerAll', vars: { count: periods.length } },
      rows: [
        row('structures.r.pga', pga / 9.80665, 'g'),
        ...(at
          ? [
              row('structures.r.Sd', at.Sd * 1000, 'mm'),
              row('structures.r.Sv', at.Sv, 'm/s'),
              row('structures.r.Sa', at.Sa / 9.80665, 'g'),
            ]
          : []),
      ],
      steps: [
        step('structures.sp.s1', undefined, '\\ddot u + 2\\zeta\\omega\\dot u + \\omega^2 u = -\\ddot u_g(t)'),
        step('structures.sp.s2', { dt }),
        step('structures.sp.s3', undefined, 'S_v = \\omega S_d,\\quad S_a = \\omega^2 S_d'),
      ],
      latex: at ? `S_a(${tex(at.T)}\\,\\mathrm{s}) = ${tex(at.Sa / 9.80665)}\\,g` : `\\zeta = ${tex(n.zeta!)}`,
      plot: {
        title: 'structures.p.spectrum',
        x: 'structures.p.period',
        y: 'structures.p.Sa',
        xLog: true,
        series: [
          { name: 'structures.p.Sa', points: sp.map((p) => [p.T, p.Sa / 9.80665] as const) },
          ...(at
            ? [{ name: 'structures.p.design', points: [[at.T, at.Sa / 9.80665] as const], style: 'points' as const }]
            : []),
        ],
      },
      grid: {
        caption: 'structures.g.spectrum',
        header: ['structures.g.T', 'structures.g.Sd', 'structures.g.Sv', 'structures.g.Sa'],
        rows: sp.map((p) => [p.T, p.Sd * 1000, p.Sv, p.Sa / 9.80665]),
      },
    };
  },
};

const modalCalc: Calc = {
  id: 'modal',
  title: 'structures.modal.title',
  intro: 'structures.modal.intro',
  fields: [
    grid(
      'modes',
      'structures.f.modes',
      [['structures.f.peakCol'], ['structures.f.TCol', 'seconds']],
      '12 1.2\n5 0.4\n2 0.25',
    ),
    num('zeta', 'structures.f.zeta', '0.05'),
  ],
  solve({ n, rows }): Outcome {
    const peaks = rows.modes!.map((r) => r[0]!);
    const periods = rows.modes!.map((r) => r[1]!);
    const c = modalCombination(peaks, periods, n.zeta!);
    return {
      answer: { key: 'structures.modal.answer', vars: { srss: c.srss, cqc: c.cqc } },
      rows: [row('structures.r.srss', c.srss), row('structures.r.cqc', c.cqc)],
      steps: [
        step('structures.modal.s1', { v: c.srss }, `r_{SRSS} = \\sqrt{\\sum r_i^2} = ${tex(c.srss)}`),
        step(
          'structures.modal.s2',
          { v: c.cqc },
          `\\rho_{ij} = \\frac{8\\zeta^2(1 + \\beta)\\beta^{3/2}}{(1 - \\beta^2)^2 + 4\\zeta^2\\beta(1` +
            ` + \\beta)^2},\\ r_{CQC} = ${tex(c.cqc)}`,
        ),
      ],
      latex: `r_{SRSS} = ${tex(c.srss)},\\quad r_{CQC} = ${tex(c.cqc)}`,
    };
  },
};

export const FRAME_CALCS: readonly Calc[] = [frameMdCalc, trussCalc, lateralCalc, spectrumCalc, modalCalc];

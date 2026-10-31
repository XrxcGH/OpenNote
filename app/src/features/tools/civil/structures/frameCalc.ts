// The structures tool's frame moment distribution: braced, or free to sway with the sidesway-shear correction.
import { grid, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import type { Calc, Outcome } from '../core/types';
import { frameMomentDistribution } from './frameMd';

export const frameMdCalc: Calc = {
  id: 'frameMd',
  title: 'structures.fmd.title',
  intro: 'structures.fmd.intro',
  fields: [
    grid(
      'joints',
      'structures.f.joints',
      [['structures.f.xCol', 'length'], ['structures.f.yCol', 'length'], ['structures.f.frameSupportCol']],
      '0 0 1\n0 4 0\n6 4 0\n6 0 1',
      2,
    ),
    grid(
      'members',
      'structures.f.frameMembers',
      [
        ['structures.f.aJoint'],
        ['structures.f.bJoint'],
        ['structures.f.EICol'],
        ['structures.f.wCol', 'forcePerLength'],
      ],
      '1 2 1 0\n2 3 1 10\n4 3 1 0',
    ),
    pick('sway', 'structures.f.sway', [
      ['braced', 'structures.o.braced'],
      ['sway', 'structures.o.sway'],
    ]),
    grid('loads', 'structures.f.hLoads', [['structures.f.jointCol'], ['structures.f.HCol', 'force']], '2 20'),
  ],
  solve({ s, rows }): Outcome {
    const joints = rows.joints!.map(([x, y, support]) => ({ x: x!, y: y!, support: Math.round(support!) }));
    const members = rows.members!.map(([a, b, EI, w]) => ({ a: Math.round(a!), b: Math.round(b!), EI: EI!, w: w! }));
    const loads = rows.loads!.map(([joint, H]) => ({ joint: Math.round(joint!), H: H! }));
    const r = frameMomentDistribution(joints, members, loads, s.sway === 'sway');
    let M = 0;
    let member = 1;
    r.moments.forEach(([a, b], i) => {
      if (Math.max(Math.abs(a), Math.abs(b)) > Math.abs(M)) {
        M = Math.abs(a) >= Math.abs(b) ? a : b;
        member = i + 1;
      }
    });
    const ends = (list: [number, number][]) => list.map(([a, b]) => `${tex(a)},\\ ${tex(b)}`).join(';\\ ');
    const sw = r.sway;
    return {
      answer: { key: 'structures.fmd.answer', vars: { M, member } },
      rows: [
        row('structures.r.MmaxEnd', M, 'kN·m'),
        sw ? row('structures.r.swayFactor', sw.factor) : row('structures.r.brace', r.brace, 'kN'),
        row('structures.r.cycles', r.cycles),
      ],
      steps: [
        step('structures.fmd.s1', undefined, 'k = \\frac{4EI}{L},\\quad DF = \\frac{k}{\\sum k}'),
        ...r.fem.map(([a, b], i) => step('structures.fmd.fem', { member: i + 1, a, b })),
        step('structures.fmd.s2', { cycles: r.cycles, R: r.brace }),
        ...(sw
          ? [
              step('structures.fmd.s3', { R1: sw.brace }, `\\mathrm{FEM}_\\Delta = -\\frac{6EI\\Delta}{h^2}`),
              step('structures.fmd.s4', { c: sw.factor }, `M = M_{held} + ${tex(sw.factor)}\\, M_\\Delta`),
            ]
          : []),
        ...r.moments.map(([a, b], i) => step('structures.fmd.final', { member: i + 1, a, b })),
      ],
      latex: `M_{ab},\\ M_{ba}:\\ ${ends(r.moments)}\\ \\mathrm{kN\\,m}`,
      grid: {
        caption: 'structures.g.frameMd',
        header: [
          'structures.g.member',
          'structures.g.joint',
          'structures.g.df',
          'structures.g.fem',
          'structures.g.final',
        ],
        rows: members.flatMap((m, i) => [
          [i + 1, m.a, r.df[i]![0], r.fem[i]![0], r.moments[i]![0]],
          [i + 1, m.b, r.df[i]![1], r.fem[i]![1], r.moments[i]![1]],
        ]),
      },
    };
  },
};

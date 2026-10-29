// The process tool's balance calculations: mixing, separation, recycle with purge, typed linear balances, and the
// energy balance of a reaction.
import { formula, grid, num, row, step } from '../core/calc';
import { fmt, tex } from '../core/format';
import type { Calc, Outcome } from '../core/types';
import { linearBalances, mix, reactionHeat, recycleLoop, separate } from './engine';

const mixCalc: Calc = {
  id: 'mix',
  title: 'process.mix.title',
  fields: [grid('streams', 'process.f.streams', [['process.f.flowCol'], ['process.f.fracCol']], '100 0.2\n50 0.5', 2)],
  solve({ rows }): Outcome {
    const m = mix(rows.streams!);
    return {
      answer: { key: 'process.mix.answer', vars: { F: m.F, x: m.x } },
      rows: [row('process.r.F', m.F), row('process.r.x', m.x), row('process.r.component', m.F * m.x)],
      steps: [
        step('process.mix.s1', { F: m.F }, `F = \\sum F_i = ${tex(m.F)}`),
        step(
          'process.mix.s2',
          { x: m.x },
          `x = \\frac{\\sum F_i x_i}{F} = \\frac{${tex(m.F * m.x)}}{${tex(m.F)}} = ${tex(m.x)}`,
        ),
        step('process.mix.check', { inSum: m.parts.reduce((s, v) => s + v, 0), out: m.F * m.x }),
      ],
      latex: `F = ${tex(m.F)},\\quad x = ${tex(m.x)}`,
    };
  },
};

const separateCalc: Calc = {
  id: 'separator',
  title: 'process.sep.title',
  fields: [grid('feed', 'process.f.components', [['process.f.flowCol'], ['process.f.splitCol']], '60 0.9\n40 0.2')],
  solve({ rows }): Outcome {
    const s = separate(rows.feed!);
    return {
      answer: { key: 'process.sep.answer', vars: { T: s.T, B: s.B } },
      rows: [row('process.r.top', s.T), row('process.r.bottom', s.B)],
      steps: [
        step('process.sep.s1', undefined, 'T_i = s_i F_i,\\quad B_i = (1 - s_i) F_i'),
        step('process.sep.s2', { T: s.T, B: s.B, F: s.T + s.B }),
      ],
      latex: `T = ${tex(s.T)},\\quad B = ${tex(s.B)}`,
      grid: {
        caption: 'process.g.split',
        header: [
          'process.g.component',
          'process.g.feed',
          'process.g.top',
          'process.g.bottom',
          'process.g.xTop',
          'process.g.xBottom',
        ],
        rows: s.rows.map((r, i) => [i + 1, r.feed, r.top, r.bottom, s.xTop[i]!, s.xBottom[i]!]),
      },
    };
  },
};

const recycleCalc: Calc = {
  id: 'recycle',
  title: 'process.rec.title',
  intro: 'process.rec.intro',
  fields: [
    num('FA', 'process.f.FA', '100'),
    num('FI', 'process.f.FI', '0'),
    num('x', 'process.f.x', '0.25'),
    num('r', 'process.f.recovery', '1'),
    num('p', 'process.f.purge', '0'),
  ],
  solve({ n }): Outcome {
    const r = recycleLoop(n.FA!, n.FI!, n.x!, n.r!, n.p!);
    return {
      answer: { key: 'process.rec.answer', vars: { X: r.overall, RA: r.RA, rec: r.recycle.A } },
      rows: [
        row('process.r.overall', r.overall),
        row('process.r.RA', r.RA),
        row('process.r.recA', r.recycle.A),
        row('process.r.RI', r.RI),
        row('process.r.purgeA', r.purge.A),
        row('process.r.purgeI', r.purge.I),
        row('process.r.product', r.product),
        row('process.r.reacted', r.reacted),
      ],
      steps: [
        step('process.rec.s1', { RA: r.RA }, `R_A = \\frac{F_A}{1 - (1 - p)\\,r\\,(1 - x)} = ${tex(r.RA)}`),
        step('process.rec.s2', { rec: r.recycle.A, reacted: r.reacted }),
        ...(n.FI! > 0 ? [step('process.rec.s3', { RI: r.RI }, `R_I = \\frac{F_I}{p} = ${tex(r.RI)}`)] : []),
        step('process.rec.s4', { X: r.overall }, `X_{overall} = \\frac{x R_A}{F_A} = ${tex(r.overall)}`),
      ],
      latex: `X_{overall} = ${tex(r.overall)},\\quad R_A = ${tex(r.RA)}`,
    };
  },
};

const linearCalc: Calc = {
  id: 'linear',
  title: 'process.lin.title',
  intro: 'process.lin.intro',
  fields: [
    formula(
      'equations',
      'process.f.equations',
      'F1 + F2 = F3; 0.2*F1 + 0.5*F2 = 0.3*F3; F1 = 100',
      'process.f.equationsHelp',
    ),
  ],
  solve({ s }): Outcome {
    const b = linearBalances(s.equations!);
    const solved = b.x;
    return {
      answer:
        solved === null
          ? { key: b.dof > 0 ? 'process.lin.under' : 'process.lin.over', vars: { dof: b.dof } }
          : { key: 'process.lin.answer', vars: { count: b.names.length } },
      rows:
        solved === null
          ? []
          : b.names.map((name, i) => ({ label: 'process.r.unknown', value: `${name} = ${fmt(solved[i]!)}` })),
      steps: [
        step('process.lin.s1', { equations: b.A.length, unknowns: b.names.length, names: b.names.join(', ') }),
        step(
          'process.lin.s2',
          { rank: b.rank, dof: b.dof },
          `\\mathrm{DOF} = ${b.names.length} - ${b.rank} = ${b.dof}`,
        ),
        ...(solved === null ? [] : [step('process.lin.s3', { residual: b.residual })]),
      ],
      latex:
        solved === null
          ? `\\mathrm{DOF} = ${b.dof}`
          : b.names.map((name, i) => `\\mathrm{${name}} = ${tex(solved[i]!)}`).join(',\\ '),
      grid: {
        caption: 'process.g.matrix',
        header: [...b.names.map(() => 'process.g.coefficient'), 'process.g.rhs'],
        rows: b.A.map((r, i) => [...r, b.b[i]!]),
      },
    };
  },
};

const energyCalc: Calc = {
  id: 'energy',
  title: 'process.energy.title',
  intro: 'process.energy.intro',
  fields: [
    grid(
      'species',
      'process.f.species',
      [['process.f.nInCol'], ['process.f.nuCol'], ['process.f.dHfCol'], ['process.f.cpCol']],
      '1 -1 -110.52 30\n0.5 -0.5 0 30\n0 1 -393.51 40',
    ),
    num('xi', 'process.f.xi', '1'),
    num('Tin', 'process.f.Tin', '298.15', 'kelvin'),
    num('Tout', 'process.f.Tout', '398.15', 'kelvin'),
  ],
  solve({ n, rows }): Outcome {
    const e = reactionHeat(
      rows.species!.map(([nIn, nu, dHf, cp]) => ({ nIn: nIn!, nu: nu!, dHf: dHf!, cp: cp! })),
      n.xi!,
      n.Tin!,
      n.Tout!,
    );
    return {
      answer: { key: e.Q >= 0 ? 'process.energy.add' : 'process.energy.remove', vars: { Q: Math.abs(e.Q) } },
      rows: [
        row('process.r.dHr', e.dHr, 'kJ/mol'),
        row('process.r.sensIn', e.sensibleIn, 'kJ'),
        row('process.r.sensOut', e.sensibleOut, 'kJ'),
        row('process.r.Q', e.Q, 'kJ'),
      ],
      steps: [
        step(
          'process.energy.s1',
          { dHr: e.dHr },
          `\\Delta H^\\circ_r = \\sum \\nu_i \\Delta H^\\circ_{f,i} = ${tex(e.dHr)}\\ \\mathrm{kJ/mol}`,
        ),
        step('process.energy.s2', { inS: e.sensibleIn, outS: e.sensibleOut }),
        step(
          'process.energy.s3',
          { Q: e.Q },
          `Q = \\xi \\Delta H^\\circ_r` +
            ` + \\sum n_{out} \\bar c_p (T_{out} - 298.15) - \\sum n_{in} \\bar c_p (T_{in} - 298.15)` +
            ` = ${tex(e.Q)}\\ \\mathrm{kJ}`,
        ),
      ],
      latex: `Q = ${tex(e.Q)}\\ \\mathrm{kJ}`,
      grid: {
        caption: 'process.g.energy',
        header: ['process.g.component', 'process.g.nIn', 'process.g.nOut'],
        rows: e.out.map((out, i) => [i + 1, rows.species![i]![0]!, out]),
      },
    };
  },
};

export const BALANCE_CALCS: readonly Calc[] = [mixCalc, separateCalc, recycleCalc, linearCalc, energyCalc];

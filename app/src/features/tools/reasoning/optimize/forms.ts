// The optimization tool's modes as forms: linear and integer programs, transportation, assignment, project networks,
// earned value, decisions from a payoff table or a tree, and queues and the newsvendor.
import { ganttFigure } from '../core/charts';
import { fracLatex, fracText, toNumber } from '../core/frac';
import type { Frac } from '../core/frac';
import { solveLp } from '../core/simplex';
import type { Tableau } from '../core/simplex';
import { treeFigure, treeText } from '../core/treeFigure';
import type { TreeNode } from '../core/treeFigure';
import { fail, matrix, num, numbers } from '../core/util';
import { isChance, parseTree, playPath, solveTree } from '../games/tree';
import type { GameNode } from '../games/tree';
import { attempt, say, saySteps } from '../ui/say';
import type { Mode, Outcome, Table, ToolSpec, Values } from '../ui/types';
import { hungarian } from './assign';
import { decide } from './decision';
import { linearText, parseLp } from './linear';
import { branchAndBound, costRanges, dual, rhsRanges } from './lp';
import type { BbNode, Range } from './lp';
import { mmc, newsvendor } from './ops';
import { planeFigure } from './plane';
import { cpm, earnedValue, normalCdf, parseActivities } from './project';
import { transport } from './transport';

const T = 'optimize';
const s = (path: string, vars?: Record<string, string | number>) => say(`${T}.${path}`, vars);
const solveWith = (fn: (v: Values) => Outcome) => (v: Values) => attempt(T, () => fn(v));
const names = (text: string | undefined, count: number, prefix: string): string[] => {
  const given = (text ?? '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return Array.from({ length: count }, (_, i) => given[i] ?? `${prefix}${i + 1}`);
};
const value = (v: Values, id: string): number => {
  const x = numbers(v[id] ?? '');
  if (!x || x.length !== 1) return fail('number', { field: s(`fields.${id}`) });
  return x[0];
};
const optional = (v: Values, id: string): number | null => ((v[id] ?? '').trim() ? value(v, id) : null);
const rangeText = (r: Range | undefined) =>
  r ? s('range', { lo: r.lo ? fracText(r.lo) : '−∞', hi: r.hi ? fracText(r.hi) : '∞' }) : '–';

// Linear and integer programs.

function tableauTable(t: Tableau, k: number): Table {
  const cell = (f: Frac) => fracText(f);
  return {
    caption: s(t.entering !== undefined ? 'table.tableauPivot' : 'table.tableauFinal', {
      k: k + 1,
      phase: t.phase,
      entering: t.entering !== undefined ? t.names[t.entering] : '',
      leaving: t.leaving !== undefined ? t.names[t.basis[t.leaving]] : '',
    }),
    header: [s('table.basis'), ...t.names, s('table.rhs')],
    rows: [
      ...t.rows.map((r, i) => [t.names[t.basis[i]], ...r.map(cell)]),
      [t.phase === 1 ? s('table.phaseOneRow') : s('table.objectiveRow'), ...t.obj.map(cell)],
    ],
  };
}

function bbTree(n: BbNode, vars: readonly string[]): TreeNode {
  const last = n.bounds[n.bounds.length - 1];
  const fate = s(`bb.${n.fate}`);
  return {
    label: n.status === 'optimal' ? `z = ${fracText(n.z)}` : fate,
    note: n.status === 'optimal' ? (n.fate === 'branch' ? n.x.map(fracText).join(', ') : fate) : undefined,
    edge: last ? `${vars[last.j]} ${last.op === '<=' ? '≤' : '≥'} ${last.v}` : undefined,
    shape: 'box',
    tone: n.fate === 'integer' ? 'accent' : n.fate === 'branch' ? undefined : 'warn',
    children: n.children.map((c) => bbTree(c, vars)),
  };
}

function lpOutcome(v: Values): Outcome {
  const p = parseLp(v.objective ?? '', v.constraints ?? '');
  const { lp, vars, labels } = p;
  const res = solveLp(lp);
  const tableaux = res.log.slice(0, 12).map(tableauTable);
  const d = dual(lp);
  const dualVars = lp.rows.map((_, i) => `y${i + 1}`);
  const dualLines = [
    `${d.sense} ${linearText(d.c, dualVars)}`,
    ...d.rows.map((r) => `${linearText(r.a, dualVars)} ${r.op === '<=' ? '≤' : '≥'} ${fracText(r.b)}`),
    ...d.signs.map((g, i) =>
      g === 'free' ? s('dualFree', { name: dualVars[i] }) : `${dualVars[i]} ${g === '<=' ? '≤' : '≥'} 0`,
    ),
  ];
  const figure =
    vars.length === 2
      ? {
          svg: planeFigure(
            lp.rows.map((r) => ({ a: toNumber(r.a[0]), b: toNumber(r.a[1]), op: r.op, c: toNumber(r.b) })),
            [vars[0], vars[1]],
            res.status === 'optimal' ? [toNumber(res.x[0]), toNumber(res.x[1])] : null,
          ),
          alt: s('planeAlt', { count: lp.rows.length }),
        }
      : undefined;
  if (v.integer === 'all') {
    const bb = branchAndBound(
      lp,
      vars.map(() => true),
    );
    const tree = bbTree(bb.root, vars);
    return {
      ok: true,
      answer: bb.best
        ? s('ipAnswer', {
            point: vars.map((x, j) => `${x} = ${fracText(bb.best!.x[j])}`).join(', '),
            z: fracText(bb.best.z),
          })
        : s('ipNone'),
      note: bb.hitLimit ? s('bbLimit', { count: bb.nodes }) : s('bbNodes', { count: bb.nodes }),
      steps: [s('steps.bbStart'), s('steps.bbBranch'), s('steps.bbPrune')],
      figure: { svg: treeFigure(tree), alt: s('bbAlt', { tree: treeText(tree) }) },
    };
  }
  if (res.status !== 'optimal') {
    return {
      ok: true,
      answer: s(`status.${res.status}`),
      tables: tableaux,
      steps: [s('steps.setUp'), s(res.status === 'infeasible' ? 'steps.phaseOneFails' : 'steps.noRatio')],
      ...(figure ? { figure } : {}),
    };
  }
  const rhs = rhsRanges(lp, res);
  const cost = costRanges(lp, res);
  const steps = [s('steps.setUp')];
  if (res.log.some((t) => t.phase === 1)) steps.push(s('steps.phaseOne'));
  res.log.forEach((t, k) => {
    if (t.entering === undefined) return;
    steps.push(
      s('steps.pivot', {
        k: k + 1,
        entering: t.names[t.entering],
        leaving: t.names[t.basis[t.leaving!]],
      }),
    );
  });
  steps.push(s('steps.optimal'), s('steps.shadow'), s('steps.dual', { dual: dualLines.join('; ') }));
  const point = vars.map((x, j) => `${x} = ${fracText(res.x[j])}`).join(', ');
  return {
    ok: true,
    answer: s('lpAnswer', { point, z: fracText(res.z) }),
    latex: `z^{*} = ${fracLatex(res.z)},\\quad ${vars.map((x, j) => `${x} = ${fracLatex(res.x[j])}`).join(',\\ ')}`,
    note: res.degenerate ? s('degenerate') : undefined,
    steps,
    tables: [
      {
        caption: s('table.variables'),
        header: [s('table.variable'), s('table.value'), s('table.reduced'), s('table.costRange')],
        rows: vars.map((x, j) => [x, fracText(res.x[j]), fracText(res.reduced[j]), rangeText(cost[j])]),
      },
      {
        caption: s('table.constraints'),
        header: [s('table.constraint'), s('table.shadow'), s('table.rhsRange')],
        rows: labels.map((l, i) => [l, fracText(res.duals[i]), rangeText(rhs[i])]),
      },
      ...tableaux,
    ],
    ...(figure ? { figure } : {}),
  };
}

// Transportation and assignment.

function transportOutcome(v: Values): Outcome {
  const cost = matrix(v.costs ?? '');
  if (!cost) return fail('matrix', { field: s('fields.costs') });
  const supply = numbers(v.supply ?? '');
  const demand = numbers(v.demand ?? '');
  if (!supply || !demand) return fail('list');
  const r = transport(cost, supply, demand, v.start === 'northwest' ? 'northwest' : 'vogel');
  const rows = names(v.rowNames, r.cost.length, 'S');
  const cols = names(v.colNames, r.cost[0].length, 'D');
  if (r.dummy === 'source') rows[rows.length - 1] = s('dummy');
  if (r.dummy === 'destination') cols[cols.length - 1] = s('dummy');
  const planTable = (caption: string, ship: number[][], basic: boolean[][]): Table => ({
    caption,
    header: ['', ...cols, s('table.supply')],
    rows: [
      ...ship.map((row, i) => [
        rows[i],
        ...row.map((q, j) => (basic[i][j] ? `${num(q)} @ ${num(r.cost[i][j])}` : `· @ ${num(r.cost[i][j])}`)),
        num(r.supply[i]),
      ]),
      [s('table.demand'), ...r.demand.map((d) => num(d)), ''],
    ],
  });
  const last = r.rounds[r.rounds.length - 1];
  const routes = r.plan.ship.flatMap((row, i) =>
    row.flatMap((q, j) => (q > 0 ? [`${rows[i]} → ${cols[j]} ${num(q)}`] : [])),
  );
  return {
    ok: true,
    answer: s('trAnswer', { total: num(r.plan.total), routes: routes.join(', ') }),
    steps: saySteps(T, r.steps),
    tables: [
      planTable(s('table.initial', { total: num(r.initial.total) }), r.initial.ship, r.initial.basic),
      planTable(s('table.final', { total: num(r.plan.total) }), r.plan.ship, r.plan.basic),
      {
        caption: s('table.potentials'),
        header: ['', ...cols, 'u'],
        rows: [
          ...last.reduced.map((row, i) => [rows[i], ...row.map((d) => (d === null ? '·' : num(d))), num(last.u[i])]),
          ['v', ...last.v.map((x) => num(x)), ''],
        ],
      },
    ],
  };
}

function assignOutcome(v: Values): Outcome {
  const cost = matrix(v.costs ?? '');
  if (!cost) return fail('matrix', { field: s('fields.costs') });
  const r = hungarian(cost, v.goal === 'max');
  const rows = names(v.rowNames, r.size, 'W');
  const cols = names(v.colNames, r.size, 'J');
  const pairs = r.match.flatMap((j, i) =>
    i < cost.length && j < cost[0].length ? [`${rows[i]} → ${cols[j]} (${num(cost[i][j])})`] : [],
  );
  return {
    ok: true,
    answer: s(v.goal === 'max' ? 'asAnswerMax' : 'asAnswer', { total: num(r.total), pairs: pairs.join(', ') }),
    steps: saySteps(T, r.steps),
    tables: [
      {
        caption: s('table.reducedMatrix'),
        header: ['', ...cols],
        rows: r.reduced.map((row, i) => [rows[i], ...row.map((x, j) => (r.match[i] === j ? `[${num(x)}]` : num(x)))]),
      },
    ],
  };
}

// Projects.

function projectOutcome(v: Values): Outcome {
  const acts = parseActivities(v.activities ?? '');
  const sch = cpm(acts);
  const unit = (v.unit ?? '').trim();
  const withUnit = (x: number) => (unit ? `${num(x)} ${unit}` : num(x));
  const pert = acts.some((a) => a.three);
  const deadline = optional(v, 'deadline');
  const notes: string[] = [];
  if (sch.paths.length > 1) notes.push(s('pmPaths', { count: sch.paths.length }));
  let latex: string | undefined;
  if (pert) {
    const sd = Math.sqrt(sch.variance);
    notes.push(s('pmVariance', { variance: num(sch.variance, 4), sd: num(sd, 4) }));
    if (deadline !== null) {
      const z = sd > 0 ? (deadline - sch.length) / sd : deadline >= sch.length ? Infinity : -Infinity;
      const p = Number.isFinite(z) ? normalCdf(z) : z > 0 ? 1 : 0;
      notes.push(s('pmChance', { deadline: num(deadline), z: num(z, 4), p: num(p, 4) }));
      const ratio = `\\frac{${num(deadline)} - ${num(sch.length, 6)}}{${num(sd, 4)}}`;
      latex = `P(T \\le ${num(deadline)}) = \\Phi\\left(${ratio}\\right) = ${num(p, 4)}`;
    }
  }
  return {
    ok: true,
    answer: s('pmAnswer', { path: (sch.paths[0] ?? []).join('–'), length: withUnit(sch.length) }),
    ...(latex ? { latex } : {}),
    note: notes.join('\n') || undefined,
    steps: saySteps(T, sch.steps),
    tables: [
      {
        caption: s('table.schedule'),
        header: [
          s('table.activity'),
          s('table.duration'),
          ...(pert ? [s('table.variance')] : []),
          'ES',
          'EF',
          'LS',
          'LF',
          s('table.slack'),
          s('table.critical'),
        ],
        rows: sch.order.map((i) => [
          acts[i].name,
          num(acts[i].dur, 4),
          ...(pert ? [num(acts[i].variance, 4)] : []),
          num(sch.es[i], 4),
          num(sch.ef[i], 4),
          num(sch.ls[i], 4),
          num(sch.lf[i], 4),
          num(sch.slack[i], 4),
          sch.critical[i] ? s('yes') : '',
        ]),
      },
    ],
    figure: {
      svg: ganttFigure(
        sch.order.map((i) => ({
          row: acts[i].name,
          start: sch.es[i],
          end: sch.ef[i],
          label: num(acts[i].dur, 3),
          tone: sch.critical[i] ? ('warn' as const) : ('accent' as const),
        })),
        unit,
      ),
      alt: s('ganttAlt', { count: acts.length, length: withUnit(sch.length) }),
    },
  };
}

function earnedOutcome(v: Values): Outcome {
  const e = earnedValue(value(v, 'bac'), value(v, 'pv'), value(v, 'ev'), value(v, 'ac'));
  const row = (key: string, x: number, digits = 4) => [s(`ev.${key}`), num(x, digits)];
  return {
    ok: true,
    answer: s('evAnswer', {
      cpi: num(e.cpi, 4),
      spi: num(e.spi, 4),
      eac: num(e.eac, 6),
      cost: s(e.cpi >= 1 ? 'evUnder' : 'evOver'),
      time: s(e.spi >= 1 ? 'evAhead' : 'evBehind'),
    }),
    latex: [
      `\\mathrm{CPI} = \\frac{EV}{AC} = ${num(e.cpi, 4)}`,
      `\\mathrm{SPI} = \\frac{EV}{PV} = ${num(e.spi, 4)}`,
      `\\mathrm{EAC} = \\frac{BAC}{\\mathrm{CPI}} = ${num(e.eac, 6)}`,
    ].join(',\\quad '),
    steps: [s('steps.evIndices'), s('steps.evForecast')],
    tables: [
      {
        caption: s('table.earned'),
        header: [s('table.measure'), s('table.value')],
        rows: [
          row('cv', e.cv, 6),
          row('sv', e.sv, 6),
          row('cpi', e.cpi),
          row('spi', e.spi),
          row('eac', e.eac, 6),
          row('etc', e.etc, 6),
          row('vac', e.vac, 6),
          row('tcpi', e.tcpi),
        ],
      },
    ],
  };
}

// Decisions.

function decisionOutcome(v: Values): Outcome {
  const pay = matrix(v.payoffs ?? '');
  if (!pay) return fail('matrix', { field: s('fields.payoffs') });
  const probs = numbers(v.probs ?? '');
  if (!probs) return fail('list');
  const like = (v.likelihood ?? '').trim() ? matrix(v.likelihood ?? '') : null;
  if ((v.likelihood ?? '').trim() && !like) return fail('matrix', { field: s('fields.likelihood') });
  const r = decide(pay, probs, like, optional(v, 'tolerance'));
  const alts = names(v.alternatives, pay.length, 'd');
  const states = names(v.states, pay[0].length, 's');
  const pick = (xs: number[], low = false) =>
    alts[xs.reduce((b, x, i) => (low ? (x < xs[b] - 1e-9 ? i : b) : x > xs[b] + 1e-9 ? i : b), 0)];
  const tables: Table[] = [
    {
      caption: s('table.criteria'),
      header: [
        s('table.alternative'),
        s('table.emv'),
        s('table.worst'),
        s('table.bestCase'),
        s('table.maxRegret'),
        s('table.average'),
        ...(r.certainty ? [s('table.certainty')] : []),
      ],
      rows: alts.map((a, i) => [
        a,
        num(r.emv[i]),
        num(r.maximin[i]),
        num(r.maximax[i]),
        num(r.maxRegret[i]),
        num(r.laplace[i]),
        ...(r.certainty ? [num(r.certainty[i])] : []),
      ]),
    },
    {
      caption: s('table.regret'),
      header: ['', ...states],
      rows: r.regret.map((row, i) => [alts[i], ...row.map((x) => num(x))]),
    },
  ];
  const steps = [
    s('steps.emv', { best: alts[r.best], emv: num(r.emv[r.best]) }),
    s('steps.evpi', { evwpi: num(r.evwpi), emv: num(r.emv[r.best]), evpi: num(r.evpi) }),
  ];
  const notes = [
    s('criteria', {
      maximin: pick(r.maximin),
      maximax: pick(r.maximax),
      regret: pick(r.maxRegret, true),
      laplace: pick(r.laplace),
    }),
  ];
  if (r.sample) {
    const sm = r.sample;
    const signals = sm.pSignal.map((_, k) => s('signal', { k: k + 1 }));
    tables.push({
      caption: s('table.posterior'),
      header: [s('table.signal'), 'P', ...states, s('table.bestThen'), s('table.value')],
      rows: sm.pSignal.map((p, k) => [
        signals[k],
        num(p, 4),
        ...sm.posterior[k].map((x) => num(x, 4)),
        alts[sm.bestBy[k]],
        num(sm.valueBy[k]),
      ]),
    });
    steps.push(
      s('steps.bayes'),
      s('steps.evsi', {
        evwsi: num(sm.evwsi),
        emv: num(r.emv[r.best]),
        evsi: num(sm.evsi),
        eff: num(sm.efficiency * 100, 4),
      }),
    );
  }
  return {
    ok: true,
    // With a risk tolerance the student asked for the utility view: the certainty equivalent decides, EMV follows.
    answer: r.certainty
      ? s('dcAnswerCe', {
          best: pick(r.certainty),
          ce: num(Math.max(...r.certainty)),
          emvBest: alts[r.best],
          emv: num(r.emv[r.best]),
          evpi: num(r.evpi),
        })
      : s('dcAnswer', { best: alts[r.best], emv: num(r.emv[r.best]), evpi: num(r.evpi) }),
    latex: `\\mathrm{EVPI} = ${num(r.evwpi)} - ${num(r.emv[r.best])} = ${num(r.evpi)}`,
    note: notes.join('\n'),
    steps,
    tables,
  };
}

function toTree(n: GameNode, choice: Map<GameNode, number>, onPath: boolean): TreeNode {
  const chosen = choice.get(n);
  return {
    label: n.payoff ? fracText(n.payoff[0]) : (n.player ?? ''),
    edge: n.move ? `${n.move}${n.prob ? ` [${fracText(n.prob)}]` : ''}` : undefined,
    shape: n.payoff ? 'box' : isChance(n.player) ? 'circle' : 'square',
    tone: onPath ? 'accent' : undefined,
    children: n.children
      .map((c, i) => toTree(c, choice, onPath && (isChance(n.player) || chosen === i)))
      .map((c, i) => (isChance(n.player) || chosen === i ? c : { ...c, cut: true })),
  };
}

function treeOutcome(v: Values): Outcome {
  const { root, players } = parseTree(v.tree ?? '', true);
  if (players.length > 1) return fail('dtOnePlayer', { names: players.join(', ') });
  const check = (n: GameNode): void => {
    if (n.payoff && n.payoff.length !== 1) fail('dtOnePayoff');
    n.children.forEach(check);
  };
  check(root);
  const solved = solveTree(root, players.length ? players : ['you']);
  const tree = toTree(root, solved.choice, true);
  const path = playPath(root, solved.choice);
  return {
    ok: true,
    answer: s('dtAnswer', { path: path.join('; ') || '–', value: fracText(solved.value[0]) }),
    steps: saySteps(T, solved.steps),
    figure: { svg: treeFigure(tree), alt: s('dtAlt', { tree: treeText(tree) }) },
  };
}

// Operations.

function opsOutcome(v: Values): Outcome {
  if (v.kind === 'newsvendor') {
    const r = newsvendor(value(v, 'cu'), value(v, 'co'), value(v, 'mean'), value(v, 'sd'));
    return {
      ok: true,
      answer: s('nvAnswer', { q: num(r.q, 6), ratio: num(r.ratio, 4), z: num(r.z, 5) }),
      latex: `F(Q^{*}) = \\frac{c_u}{c_u + c_o} = ${num(r.ratio, 4)},\\quad Q^{*} = \\mu + z\\sigma = ${num(r.q, 6)}`,
      steps: [
        s('steps.nvRatio', { ratio: num(r.ratio, 4) }),
        s('steps.nvQuantile', { z: num(r.z, 5), q: num(r.q, 6) }),
      ],
    };
  }
  const q = mmc(value(v, 'lambda'), value(v, 'mu'), value(v, 'servers'));
  const row = (key: string, x: number) => [s(`queue.${key}`), num(x, 5)];
  return {
    ok: true,
    answer: s('qAnswer', { wq: num(q.wq, 5), lq: num(q.lq, 5), rho: num(q.rho, 4) }),
    latex: `P_0 = ${num(q.p0, 5)},\\quad L_q = ${num(q.lq, 5)},\\quad W_q = \\frac{L_q}{\\lambda} = ${num(q.wq, 5)}`,
    steps: [s('steps.qLoad'), s('steps.qErlang'), s('steps.qLittle')],
    tables: [
      {
        caption: s('table.queue'),
        header: [s('table.measure'), s('table.value')],
        rows: [
          row('a', q.a),
          row('rho', q.rho),
          row('p0', q.p0),
          row('pWait', q.pWait),
          row('lq', q.lq),
          row('wq', q.wq),
          row('w', q.w),
          row('l', q.l),
        ],
      },
    ],
  };
}

const LP: Mode = {
  id: 'lp',
  fields: [
    { id: 'objective', initial: 'max 3x + 2y', help: true, wide: true },
    { id: 'constraints', kind: 'area', rows: 5, initial: 'x + y <= 4\nx + 3y <= 6\nx <= 3', help: true },
    { id: 'integer', kind: 'select', options: ['none', 'all'] },
  ],
  solve: solveWith(lpOutcome),
};

const TRANSPORT: Mode = {
  id: 'transport',
  fields: [
    { id: 'costs', kind: 'area', rows: 4, initial: '8 6 10\n9 12 13', help: true },
    { id: 'supply', initial: '20, 30' },
    { id: 'demand', initial: '10, 25, 15' },
    { id: 'start', kind: 'select', options: ['vogel', 'northwest'] },
    { id: 'rowNames', initial: '' },
    { id: 'colNames', initial: '' },
  ],
  solve: solveWith(transportOutcome),
};

const ASSIGN: Mode = {
  id: 'assign',
  fields: [
    { id: 'costs', kind: 'area', rows: 4, initial: '4 1 3\n2 0 5\n3 2 2', help: true },
    { id: 'goal', kind: 'select', options: ['min', 'max'] },
    { id: 'rowNames', initial: '' },
    { id: 'colNames', initial: '' },
  ],
  solve: solveWith(assignOutcome),
};

const PROJECT: Mode = {
  id: 'project',
  fields: [
    { id: 'activities', kind: 'area', rows: 6, initial: 'A 3\nB 2 | A\nC 4 | A\nD 2 | B, C', help: true },
    { id: 'unit', initial: 'days' },
    { id: 'deadline', initial: '', help: true },
  ],
  solve: solveWith(projectOutcome),
};

const EARNED: Mode = {
  id: 'earned',
  fields: [
    { id: 'bac', initial: '100000' },
    { id: 'pv', initial: '50000' },
    { id: 'ev', initial: '40000' },
    { id: 'ac', initial: '45000' },
  ],
  solve: solveWith(earnedOutcome),
};

const DECISION: Mode = {
  id: 'decision',
  fields: [
    { id: 'payoffs', kind: 'area', rows: 4, initial: '50 50\n120 0', help: true },
    { id: 'probs', initial: '0.5, 0.5' },
    { id: 'alternatives', initial: 'sure, gamble' },
    { id: 'states', initial: 'good, bad' },
    { id: 'likelihood', kind: 'area', rows: 3, initial: '', help: true },
    { id: 'tolerance', initial: '', help: true },
  ],
  solve: solveWith(decisionOutcome),
};

const TREE: Mode = {
  id: 'tree',
  fields: [
    {
      id: 'tree',
      kind: 'area',
      rows: 7,
      initial: 'Choose\n  sure: 50\n  gamble: chance\n    win [1/2]: 120\n    lose [1/2]: 0',
      help: true,
    },
  ],
  solve: solveWith(treeOutcome),
};

const OPS_FIELDS: Record<string, readonly [string, string][]> = {
  queue: [
    ['lambda', '4'],
    ['mu', '3'],
    ['servers', '2'],
  ],
  newsvendor: [
    ['cu', '5'],
    ['co', '3'],
    ['mean', '100'],
    ['sd', '20'],
  ],
};

const OPS: Mode = {
  id: 'ops',
  fields: (v) => [
    { id: 'kind', kind: 'select', options: ['queue', 'newsvendor'] },
    ...(OPS_FIELDS[v.kind ?? 'queue'] ?? OPS_FIELDS.queue).map(([id, initial]) => ({ id, initial })),
  ],
  solve: solveWith(opsOutcome),
};

export const OPTIMIZE: ToolSpec = {
  id: 'optimize',
  modes: [LP, TRANSPORT, ASSIGN, PROJECT, EARNED, DECISION, TREE, OPS],
};

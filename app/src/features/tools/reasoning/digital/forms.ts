// The digital logic tool's combinational modes as forms: minimization with Karnaugh maps, NAND and NOR circuits,
// timing simulation, and CMOS delay. Sequential modes are in formsSeq.ts. This file reads the fields and words the
// results; the methods live in the engine files beside it.
import { timingFigure } from '../core/charts';
import { treeFigure, treeText } from '../core/treeFigure';
import { fail, integers, lines, num, numbers } from '../core/util';
import { attempt, say, saySteps } from '../ui/say';
import type { Mode, Outcome, ToolSpec, Values } from '../ui/types';
import { dynamicPower, elmore, logicalEffort, parseRcTree } from './cmos';
import { mintermsOf, parseBool, rowEnv, varsOf } from './expr';
import { gateTree, simulate, twoLevel } from './gates';
import { kmapFigure } from './kmap';
import { literals, maxterms, minimize, pattern, sumText, termLatex, termText } from './qm';
import { BUILD, FLIPFLOPS, FSM } from './formsSeq';

const T = 'digital';
const s = (path: string, vars?: Record<string, string | number>) => say(`${T}.${path}`, vars);

/** Variable names from "A B C", "A, B, C", or "ABC". */
export function parseVars(text: string): string[] {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const names = parts.length === 1 && /^[A-Za-z]{2,6}$/.test(parts[0]) ? [...parts[0]] : parts;
  for (const v of names) if (!/^[A-Za-z][0-9_]*$/.test(v)) fail('varName', { name: v });
  if (new Set(names).size !== names.length) fail('varTwice');
  return names;
}

interface Fn {
  vars: string[];
  ons: number[];
  dcs: number[];
}

function functionOf(v: Values): Fn {
  if (v.source === 'expression') {
    const e = parseBool(v.expr ?? '');
    const used = varsOf(e);
    const vars = (v.vars ?? '').trim() ? parseVars(v.vars) : used;
    for (const name of used) if (!vars.includes(name)) fail('varMissing', { name });
    if (vars.length > 6) fail('varCount', { max: 6 });
    return { vars, ons: mintermsOf(e, vars), dcs: [] };
  }
  const vars = parseVars(v.vars ?? '');
  const ons = integers(v.minterms ?? '');
  const dcs = (v.dontcares ?? '').trim() ? integers(v.dontcares) : [];
  if (!ons || !dcs) fail('termList');
  return { vars, ons: [...new Set(ons!)].sort((a, b) => a - b), dcs: [...new Set(dcs!)].sort((a, b) => a - b) };
}

const list = (xs: readonly number[]) => (xs.length ? xs.join(', ') : '–');

function minimizeOutcome(v: Values): Outcome {
  const { vars, ons, dcs } = functionOf(v);
  const n = vars.length;
  const sop = minimize(n, ons, dcs);
  const offs = maxterms(n, ons, dcs);
  const pos = minimize(n, offs, dcs);
  const best = sop.covers[0];
  const sopText = best.length ? best.map((c) => termText(c, vars)).join(' + ') : '0';
  const posText = pos.covers[0].length ? pos.covers[0].map((c) => sumText(c, vars)).join('') : '1';
  const literalCount = best.reduce((sum, c) => sum + literals(c, n), 0);
  const others = sop.covers.slice(1).map((cover) => cover.map((c) => termText(c, vars)).join(' + '));
  const notes = [s('posLine', { pos: posText })];
  if (others.length) notes.push(s('otherCovers', { covers: others.join('; ') }));
  const steps = [
    s('steps.canonical', { ons: list(ons), dcs: list(dcs), offs: list(offs) }),
    ...saySteps(T, sop.steps),
    s('steps.chosen', { terms: best.length, literals: literalCount }),
  ];
  const fn = vars.join(', ');
  return {
    ok: true,
    answer: s('sopAnswer', { fn, sop: sopText }),
    note: notes.join('\n'),
    latex: `F(${fn}) = ${best.length ? best.map((c) => termLatex(c, vars)).join(' + ') : '0'}`,
    steps,
    tables: [
      {
        caption: s('table.primes'),
        header: [s('table.prime'), s('table.pattern'), s('table.covers'), s('table.essential')],
        rows: sop.primes.map((p, i) => [
          termText(p, vars),
          pattern(p, n),
          sop.chart[i].join(', '),
          sop.essential.includes(p) ? s('yes') : s('no'),
        ]),
      },
      {
        caption: s('table.truth'),
        header: [s('table.row'), ...vars, 'F'],
        rows: Array.from({ length: 1 << n }, (_, row) => {
          const env = rowEnv(vars, row);
          const f = ons.includes(row) ? '1' : dcs.includes(row) ? 'X' : '0';
          return [String(row), ...vars.map((x) => String(env[x])), f];
        }),
      },
    ],
    figure: {
      svg: kmapFigure(vars, ons, dcs, best),
      alt: s('kmapAlt', { n, groups: best.map((c, i) => `${i + 1}: ${termText(c, vars)}`).join(', ') || '–' }),
    },
  };
}

function gatesOutcome(v: Values): Outcome {
  const e = parseBool(v.expr ?? '');
  const vars = (v.vars ?? '').trim() ? parseVars(v.vars) : varsOf(e);
  if (vars.length > 6) fail('varCount', { max: 6 });
  const ons = mintermsOf(e, vars);
  const sop = minimize(vars.length, ons).covers[0];
  const pos = minimize(vars.length, maxterms(vars.length, ons, [])).covers[0];
  const nand = twoLevel(sop, vars, 'NAND');
  const nor = twoLevel(pos, vars, 'NOR');
  const tree = gateTree(e);
  return {
    ok: true,
    answer: s('nandAnswer', { text: nand.text }),
    note: s('norLine', { text: nor.text }),
    steps: [
      s('steps.sop', { sop: sop.length ? sop.map((c) => termText(c, vars)).join(' + ') : '0' }),
      s('steps.nand', { gates: nand.gates }),
      s('steps.pos', { pos: pos.length ? pos.map((c) => sumText(c, vars)).join('') : '1' }),
      s('steps.nor', { gates: nor.gates }),
    ],
    figure: { svg: treeFigure(tree), alt: s('treeAlt', { tree: treeText(tree) }) },
  };
}

function vectorsOf(text: string, n: number): number[] {
  return lines(text).map((line, i) => {
    const bits = line.replace(/[\s,]/g, '');
    if (!/^[01]+$/.test(bits) || bits.length !== n) fail('vector', { line: i + 1, n });
    return parseInt(bits, 2);
  });
}

function simulateOutcome(v: Values): Outcome {
  const e = parseBool(v.expr ?? '');
  const vars = (v.vars ?? '').trim() ? parseVars(v.vars) : varsOf(e);
  const delay = integers(v.delay ?? '')?.[0];
  const hold = integers(v.hold ?? '')?.[0];
  if (delay === undefined || hold === undefined) fail('whole');
  const sim = simulate(e, vars, vectorsOf(v.vectors ?? '', vars.length), delay!, hold!);
  const settled = sim.inputs[0]
    ? Array.from({ length: sim.times / hold! }, (_, i) => String(sim.output[(i + 1) * hold! - 1]))
    : [];
  return {
    ok: true,
    answer: sim.glitches.length
      ? s('glitchAnswer', { vectors: sim.glitches.map((g) => g + 1).join(', ') })
      : s('cleanAnswer'),
    note: s('settled', { values: settled.join(', ') }),
    steps: [s('steps.delay', { delay: delay!, hold: hold! }), s('steps.changes', { times: list(sim.changes) })],
    tables: [
      {
        caption: s('table.changes'),
        header: [s('table.time'), 'F'],
        rows: sim.changes.map((t) => [String(t), String(sim.output[t])]),
      },
    ],
    figure: {
      svg: timingFigure([...sim.inputs, { name: 'F', levels: sim.output }]),
      alt: s('timingAlt', { signals: [...vars, 'F'].join(', '), steps: sim.times }),
    },
  };
}

function elmoreOutcome(v: Values): Outcome {
  const tree = parseRcTree(v.tree ?? '');
  const { tau, steps } = elmore(tree, (v.target ?? '').trim());
  const nums = numbers(`${v.alpha} ${v.cap} ${v.volts} ${v.freq}`);
  if (!nums || nums.length !== 4) fail('powerValues');
  const capScale = { fF: 1e-15, pF: 1e-12, nF: 1e-9 }[v.capUnit as 'pF'] ?? 1e-12;
  const fScale = { kHz: 1e3, MHz: 1e6, GHz: 1e9 }[v.freqUnit as 'MHz'] ?? 1e6;
  const power = dynamicPower(nums![0], nums![1] * capScale, nums![2], nums![3] * fScale);
  return {
    ok: true,
    answer: s('elmoreAnswer', { node: v.target.trim(), tau: num(tau) }),
    note: s('powerLine', { power: num(power) }),
    latex: `\\tau = \\sum_k R_{ik} C_k = ${num(tau)}\\,\\text{ns}`,
    steps: [...saySteps(T, steps), s('steps.power', { power: num(power) })],
    tables: [
      {
        caption: s('table.elmore'),
        header: [s('table.node'), s('table.parent'), 'R (kΩ)', 'C (pF)'],
        rows: tree.map((n) => [n.name, n.parent ?? s('source'), num(n.r), num(n.c)]),
      },
    ],
  };
}

function effortOutcome(v: Values): Outcome {
  const g = numbers(v.g ?? '');
  const p = numbers(v.p ?? '');
  const b = (v.b ?? '').trim() ? numbers(v.b) : [];
  const ends = numbers(`${v.cin} ${v.cout}`);
  if (!g || !p || !b || !ends || ends.length !== 2) fail('effortValues');
  const r = logicalEffort(g!, p!, b!, ends![0], ends![1]);
  return {
    ok: true,
    answer: s('effortAnswer', { delay: num(r.delay, 4), f: num(r.stageEffort, 4) }),
    latex: `D = N F^{1/N} + P = ${r.N} \\cdot ${num(r.F, 4)}^{1/${r.N}} + ${num(r.delay - r.N * r.stageEffort, 4)} = ${num(r.delay, 4)}`,
    steps: [
      s('steps.effortPath', { G: num(r.G, 4), B: num(r.B, 4), H: num(r.H, 4), F: num(r.F, 4) }),
      s('steps.effortStage', { N: r.N, f: num(r.stageEffort, 4) }),
      s('steps.effortSizes'),
    ],
    tables: [
      {
        caption: s('table.stages'),
        header: [s('table.stage'), 'g', 'p', 'b', s('table.cin')],
        rows: r.sizes.map((c, i) => [String(i + 1), num(g![i]), num(p![i]), num(b![i] ?? 1), num(c, 4)]),
      },
    ],
  };
}

const solveWith = (fn: (v: Values) => Outcome) => (v: Values) => attempt(T, () => fn(v));

const MINIMIZE: Mode = {
  id: 'minimize',
  fields: (v) => [
    { id: 'source', kind: 'select', options: ['minterms', 'expression'] },
    ...(v.source === 'expression'
      ? [
          { id: 'expr', initial: "A'B'C' + A'BD + A'BC + B'C'D + CD'", wide: true, help: true },
          { id: 'vars', initial: '', help: true },
        ]
      : [
          { id: 'vars', initial: 'A B C D' },
          { id: 'minterms', initial: '0 1 2 5 6 7 8 9 10 14' },
          { id: 'dontcares', initial: '' },
        ]),
  ],
  solve: solveWith(minimizeOutcome),
};

const GATES: Mode = {
  id: 'gates',
  fields: [
    { id: 'expr', initial: 'AB + AC + BC', wide: true, help: true },
    { id: 'vars', initial: '', help: true },
  ],
  solve: solveWith(gatesOutcome),
};

const SIMULATE: Mode = {
  id: 'simulate',
  fields: [
    { id: 'expr', initial: "AB + A'C", wide: true },
    { id: 'vars', initial: 'A B C' },
    { id: 'delay', initial: '1' },
    { id: 'hold', initial: '6' },
    { id: 'vectors', kind: 'area', initial: '111\n011\n111', help: true },
  ],
  solve: solveWith(simulateOutcome),
};

const ELMORE: Mode = {
  id: 'elmore',
  fields: [
    { id: 'tree', kind: 'area', initial: 'n1 in 1 1\nn2 n1 1 1', help: true },
    { id: 'target', initial: 'n2' },
    { id: 'alpha', initial: '0.1' },
    { id: 'cap', initial: '1' },
    { id: 'capUnit', kind: 'select', options: ['nF', 'pF', 'fF'] },
    { id: 'volts', initial: '1' },
    { id: 'freq', initial: '1' },
    { id: 'freqUnit', kind: 'select', options: ['GHz', 'MHz', 'kHz'] },
  ],
  solve: solveWith(elmoreOutcome),
};

const EFFORT: Mode = {
  id: 'effort',
  fields: [
    { id: 'g', initial: '1 1 1', help: true },
    { id: 'p', initial: '1 1 1' },
    { id: 'b', initial: '' },
    { id: 'cin', initial: '1' },
    { id: 'cout', initial: '64' },
  ],
  solve: solveWith(effortOutcome),
};

export const DIGITAL: ToolSpec = {
  id: 'digital',
  modes: [MINIMIZE, GATES, SIMULATE, FLIPFLOPS, FSM, BUILD, ELMORE, EFFORT],
};

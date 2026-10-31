// The automata and grammars tool's grammar modes (parse trees, normal form with CYK, LL(1), LR) and its machines with
// memory (pushdown automata, Turing machines, transducers) as forms.
import { el, label, svgRoot } from '../core/svg';
import { treeFigure, treeText } from '../core/treeFigure';
import type { TreeNode } from '../core/treeFigure';
import { fail, integers } from '../core/util';
import type { Figure, Mode, Outcome, Table, Values } from '../ui/types';
import {
  END,
  cyk,
  grammarLines,
  itemText,
  leftmost,
  ll1,
  ll1Parse,
  parseGrammar,
  parseTrees,
  prodText,
  slr,
  slrParse,
  toCnf,
  tokensOf,
} from './cfg';
import type { Grammar, TraceRow, Tree } from './cfg';
import { area, f, s, shown, solveWith } from './common';
import { STEP_LIMIT, compose, parseFst, parsePda, parseTm, runPda, runTm, tapeText, transduce } from './machines';
import type { Tm, TmConfig } from './machines';

const toNode = (t: Tree): TreeNode => ({
  label: t.sym,
  children: t.children.map(toNode),
  shape: t.children.length ? 'circle' : 'box',
});

const grammarTable = (g: Grammar, caption: string): Table => ({
  caption,
  header: [s('table.rule')],
  rows: grammarLines(g).map((l) => [l]),
});

function grammarOutcome(v: Values): Outcome {
  const g = parseGrammar(v.grammar ?? '');
  const tokens = tokensOf(g, v.input ?? '');
  const { count, trees } = parseTrees(g, tokens);
  if (count === 0)
    return {
      ok: true,
      answer: s('notDerived', { w: shown(tokens.join(' ')) }),
      tables: [grammarTable(g, s('table.grammar'))],
    };
  const pick = v.tree === '2' && trees[1] ? trees[1] : trees[0];
  const node = toNode(pick);
  return {
    ok: true,
    answer: count === 1 ? s('oneTree') : s('manyTrees', { count: count >= 1_000_000 ? '1,000,000+' : count }),
    note: count > 1 ? s('ambiguous') : undefined,
    steps: leftmost(g, pick).map((form, i) =>
      i === 0 ? s('steps.deriveStart', { form }) : s('steps.derive', { form }),
    ),
    tables: [grammarTable(g, s('table.grammar'))],
    figure: { svg: treeFigure(node), alt: s('treeAlt', { tree: treeText(node) }) },
  };
}

function cnfOutcome(v: Values): Outcome {
  const g = parseGrammar(v.grammar ?? '');
  const { cnf, stages } = toCnf(g);
  const tokens = tokensOf(g, v.input ?? '');
  const r = cyk(cnf, tokens);
  const tables: Table[] = [grammarTable(cnf, s('table.cnf'))];
  if (tokens.length)
    tables.push({
      caption: s('table.cyk'),
      header: [s('table.length'), ...tokens],
      rows: [...r.table]
        .map((row, l) => [
          String(l + 1),
          ...tokens.map((_, i) => (row[i] ? (row[i].length ? row[i].join(', ') : '∅') : '')),
        ])
        .reverse(),
    });
  return {
    ok: true,
    answer: s(r.accepted ? 'cykYes' : 'cykNo', { w: shown(tokens.join(' ')), start: cnf.start }),
    steps: [
      ...(stages.length
        ? stages.map((st) => s(`steps.cnf_${st.key}`, { rules: grammarLines(st.g).join('; ') }))
        : [s('steps.cnfAlready')]),
      s('steps.cyk', { n: tokens.length }),
    ],
    tables,
  };
}

const setList = (set: Iterable<string>, nullable = false) => `{${[...set, ...(nullable ? ['ε'] : [])].join(', ')}}`;

function traceTable(rows: readonly TraceRow[], g: Grammar, caption: string): Table {
  const word = (a: string) => {
    const [kind, arg] = a.split(':');
    if (kind === 'accept') return s('trace.accept');
    if (kind === 'match') return s('trace.match', { a: arg });
    if (kind === 'use' || kind === 'reduce') return s(`trace.${kind}`, { rule: prodText(g.prods[Number(arg)]) });
    if (kind === 'shift') return s('trace.shift', { state: arg });
    return s('trace.error', { a: arg });
  };
  return {
    caption,
    header: [s('table.stack'), s('table.input'), s('table.action')],
    rows: rows.slice(0, 200).map((r) => [r.stack, r.input, word(r.action)]),
  };
}

function ll1Outcome(v: Values): Outcome {
  const g = parseGrammar(v.grammar ?? '');
  const t = ll1(g);
  const tokens = tokensOf(g, v.input ?? '');
  const parse = ll1Parse(g, t, tokens);
  const sets: Table = {
    caption: s('table.sets'),
    header: [s('table.nonterminal'), 'FIRST', 'FOLLOW'],
    rows: g.nonterminals.map((a) => [
      a,
      setList(t.sets.first.get(a)!, t.sets.nullable.has(a)),
      setList(t.sets.follow.get(a)!),
    ]),
  };
  const table: Table = {
    caption: s('table.ll1'),
    header: ['', ...t.columns],
    rows: g.nonterminals.map((a) => [
      a,
      ...t.columns.map((c) => (t.table.get(a)?.get(c) ?? []).map((i) => prodText(g.prods[i])).join(' / ')),
    ]),
  };
  return {
    ok: true,
    answer: t.conflicts.length
      ? s('ll1Conflicts', { count: t.conflicts.length, list: t.conflicts.map((c) => `${c.nt}, ${c.t}`).join('; ') })
      : s(parse.ok ? 'll1Yes' : 'll1No', { w: shown(tokens.join(' ')) }),
    note: t.conflicts.length ? s('ll1Note') : undefined,
    steps: [s('steps.first'), s('steps.follow'), s('steps.ll1Fill')],
    tables: [sets, table, traceTable(parse.rows, g, s('table.trace'))],
  };
}

function lrOutcome(v: Values): Outcome {
  const g = parseGrammar(v.grammar ?? '');
  const lr = slr(g);
  const tokens = tokensOf(g, v.input ?? '');
  const parse = slrParse(lr, tokens);
  const terms = [...lr.g.terminals, END];
  const nts = lr.g.nonterminals.slice(1);
  return {
    ok: true,
    answer: lr.conflicts.length
      ? s('slrConflicts', {
          count: lr.conflicts.length,
          list: lr.conflicts.map((c) => `${c.state}, ${c.t}: ${c.actions.join('/')}`).join('; '),
        })
      : s(parse.ok ? 'slrYes' : 'slrNo', { w: shown(tokens.join(' ')), states: lr.states.length }),
    note: lr.conflicts.length ? s('slrNote') : undefined,
    steps: [
      s('steps.augment', { rule: prodText(lr.g.prods[0]) }),
      s('steps.items', { count: lr.states.length }),
      s('steps.slrFill'),
    ],
    tables: [
      {
        caption: s('table.items'),
        header: [s('table.stateNumber'), s('table.itemList'), s('table.gotos')],
        rows: lr.states.map((items, i) => [
          `I${i}`,
          items.map((it) => itemText(lr.g, it)).join('; '),
          [...(lr.goto.get(i) ?? [])].map(([x, j]) => `${x} → I${j}`).join(', '),
        ]),
      },
      {
        caption: s('table.slr'),
        header: [s('table.stateNumber'), ...terms, ...nts],
        rows: lr.states.map((_, i) => [
          String(i),
          ...terms.map((t) => (lr.action.get(i)?.get(t) ?? []).join(' / ')),
          ...nts.map((a) => String(lr.goto.get(i)?.get(a) ?? '')),
        ]),
      },
      traceTable(parse.rows, lr.g, s('table.trace')),
    ],
  };
}

function pdaOutcome(v: Values): Outcome {
  const pda = parsePda(v.pda ?? '');
  const byEmpty = v.acceptBy === 'empty';
  if (!byEmpty && pda.accept.size === 0) fail('pdaNoAccept');
  const input = [...(v.input ?? '').replace(/\s+/g, '').replace(/^ε$/, '')];
  const r = runPda(pda, input, byEmpty);
  const w = shown(input.join(''));
  return {
    ok: true,
    answer: s(r.accepted ? 'pdaYes' : r.capped ? 'pdaCapped' : 'pdaNo', { w, explored: r.explored }),
    note: s('pdaExplored', { count: r.explored }),
    steps: [s(byEmpty ? 'steps.pdaEmpty' : 'steps.pdaFinal'), s('steps.pdaSearch')],
    tables: r.accepted
      ? [
          {
            caption: s('table.pdaPath'),
            header: [s('table.state'), s('table.inputLeft'), s('table.stackTop')],
            rows: r.path.map((c) => [c.state, shown(input.slice(c.pos).join('')), shown(c.stack)]),
          },
        ]
      : [],
  };
}

const CELL = 28;

function tapeFigure(tm: Tm, c: TmConfig): Figure {
  const cells = [...c.tape.keys(), c.head];
  const lo = Math.min(...cells) - 1;
  const hi = Math.max(...cells) + 1;
  const width = (hi - lo + 1) * CELL + 20;
  const parts = [];
  for (let i = lo; i <= hi; i += 1) {
    const x = 10 + (i - lo) * CELL;
    const here = i === c.head;
    parts.push(
      el('rect', { x, y: 30, width: CELL, height: CELL, fill: here ? '@accentSoft' : '@paper', stroke: '@line' }),
      label(x + CELL / 2, 30 + CELL / 2, c.tape.get(i) ?? tm.blank, { fill: '@ink' }),
    );
    if (here) parts.push(label(x + CELL / 2, 14, `▼ ${c.state}`, { fill: '@accent' }));
  }
  return {
    svg: svgRoot(Math.max(width, 120), 72, ...parts),
    alt: s('tapeAlt', { tape: tapeText(tm, c, true), state: c.state, step: c.step }),
  };
}

function turingOutcome(v: Values): Outcome {
  const tm = parseTm(v.tm ?? '');
  const raw = (v.input ?? '').replace(/\s+/g, '');
  const input = raw === 'ε' ? [] : [...raw];
  const limit = integers(v.limit ?? '');
  const max = limit?.length === 1 ? limit[0] : NaN;
  if (!(max >= 1 && max <= STEP_LIMIT)) fail('tmLimit', { max: STEP_LIMIT });
  const atText = (v.at ?? '').trim();
  const at = atText === '' ? -1 : (integers(atText)?.[0] ?? NaN);
  if (Number.isNaN(at) || at < -1) fail('tmAt');
  const r = runTm(tm, input, max, at);
  const view = at >= 0 && r.at ? r.at : r.final;
  return {
    ok: true,
    answer: s(`tmEnd_${r.end}`, { steps: r.steps, tape: shown(tapeText(tm, r.final)) }),
    note: at >= 0 && !r.at ? s('tmAtLate', { at, steps: r.steps }) : undefined,
    steps: [s('steps.tmRule'), s('steps.tmTrace', { count: r.trace.length })],
    tables: [
      {
        caption: s('table.tmTrace'),
        header: [s('table.step'), s('table.state'), s('table.tape')],
        rows: r.trace.map((c) => [String(c.step), c.state, tapeText(tm, c, true)]),
      },
    ],
    figure: tapeFigure(tm, view),
  };
}

function fstOutcome(v: Values): Outcome {
  const first = parseFst(v.fst ?? '');
  const secondText = (v.then ?? '').trim();
  const fst = secondText ? compose(first, parseFst(secondText)) : first;
  const input = [...(v.input ?? '').replace(/\s+/g, '')];
  const r = transduce(fst, input);
  return {
    ok: true,
    answer: r.outputs.length
      ? s('fstOutputs', { list: r.outputs.map(shown).join(', '), count: r.outputs.length })
      : s('fstNone', { w: shown(input.join('')) }),
    note: r.capped ? s('fstCapped') : undefined,
    steps: [s(secondText ? 'steps.fstCompose' : 'steps.fstRun', { arcs: fst.arcs.length })],
    tables: [
      {
        caption: secondText ? s('table.composed') : s('table.arcs'),
        header: [s('table.from'), s('table.arc'), s('table.to')],
        rows: fst.arcs.slice(0, 200).map((a) => [a.from, `${shown(a.input)} : ${shown(a.output)}`, a.to]),
      },
    ],
  };
}

const AMBIGUOUS = 'E -> E + E | E * E | ( E ) | id';
const CNF_G = 'S -> AB | BC\nA -> BA | a\nB -> CC | b\nC -> AB | a';
const EXPR = "E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id";
const LR_G = 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';
const ANBN = `# a^n b^n: push an A per a, pop one per b.
start q0
accept q2
q0 a Z -> q0 AZ
q0 a A -> q0 AA
q0 ε Z -> q1 Z
q0 ε A -> q1 A
q1 b A -> q1 ε
q1 ε Z -> q2 Z`;
const INCREMENT = `# Binary increment: run right to the end, then carry leftward.
start q0
accept qh
q0 0 q0 0 R
q0 1 q0 1 R
q0 _ q1 _ L
q1 1 q1 0 L
q1 0 qh 1 S
q1 _ qh 1 S`;
const PLURAL = `# Plural with e-insertion after x: bax+s becomes baxes.
start q0
final q3
q0 a:a q0
q0 b:b q0
q0 x:x q1
q0 +:ε q2
q1 a:a q0
q1 b:b q0
q1 x:x q1
q1 +:e q2
q2 s:s q3`;

export const GRAMMAR: Mode = {
  id: 'grammar',
  fields: [
    area('grammar', AMBIGUOUS, 4),
    f('input', 'id + id * id', { help: true }),
    { id: 'tree', kind: 'select', options: ['1', '2'] },
  ],
  solve: solveWith(grammarOutcome),
};
export const CNF: Mode = {
  id: 'cnf',
  fields: [area('grammar', CNF_G, 5), f('input', 'baaba', { help: true })],
  solve: solveWith(cnfOutcome),
};
export const LL1: Mode = {
  id: 'll1',
  fields: [area('grammar', EXPR, 6), f('input', 'id + id * id', { help: true })],
  solve: solveWith(ll1Outcome),
};
export const LR: Mode = {
  id: 'lr',
  fields: [area('grammar', LR_G, 4), f('input', 'id * id + id', { help: true })],
  solve: solveWith(lrOutcome),
};
export const PDA: Mode = {
  id: 'pda',
  fields: [area('pda', ANBN, 8), f('input', 'aabb'), { id: 'acceptBy', kind: 'select', options: ['final', 'empty'] }],
  solve: solveWith(pdaOutcome),
};
export const TURING: Mode = {
  id: 'turing',
  fields: [area('tm', INCREMENT, 8), f('input', '1011'), f('limit', '100000'), f('at', '', { help: true })],
  solve: solveWith(turingOutcome),
};
export const FST: Mode = {
  id: 'fst',
  fields: [area('fst', PLURAL, 8), area('then', '', 3), f('input', 'bax+s')],
  solve: solveWith(fstOutcome),
};

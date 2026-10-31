// The automata and grammars tool's finite-automaton modes as forms: running a machine, regular expressions to
// machines, conversions, comparisons, and the pumping game. Grammars and machines with memory are in formsGrammar.ts.
import { graphFigure } from '../core/graphFigure';
import type { GraphEdge, GraphNode } from '../core/graphFigure';
import { integers } from '../core/util';
import type { Figure, Mode, Outcome, Table, ToolSpec, Values } from '../ui/types';
import { area, f, s, shown, solveWith } from './common';
import {
  EPS,
  complement,
  equivalent,
  isDfa,
  minimize,
  parseFa,
  product,
  run,
  setText,
  subset,
  symbolsOfInput,
  thompson,
  toRegex,
} from './fa';
import type { Fa, ProductOp, SubsetRow } from './fa';
import { CNF, FST, GRAMMAR, LL1, LR, PDA, TURING } from './formsGrammar';
import { LANGUAGES, playPumping } from './pumping';
import type { LanguageId } from './pumping';
import { parseRegex, print } from './regex';

const MAX_DRAWN = 30;

/** A state diagram: parallel arcs share one arrow with their symbols listed. */
export function faFigure(fa: Fa): Figure | undefined {
  if (fa.states.length > MAX_DRAWN) return undefined;
  const nodes: GraphNode[] = fa.states.map((q) => ({ id: q, label: q, ring: fa.accept.has(q), start: q === fa.start }));
  const merged = new Map<string, GraphEdge>();
  for (const [from, row] of fa.delta)
    for (const [a, to] of row)
      for (const t of to) {
        const k = `${from}\u0000${t}`;
        const e = merged.get(k);
        merged.set(k, e ? { ...e, label: `${e.label}, ${a}` } : { from, to: t, label: a });
      }
  const arcs = [...merged.values()].map((e) => `${e.from} → ${e.to} (${e.label})`).join('; ');
  return {
    svg: graphFigure(nodes, [...merged.values()], { directed: true }),
    alt: s('diagramAlt', { count: fa.states.length, arcs }),
  };
}

/** The transition table: one row per state, one column per symbol (and ε when used). */
export function faTable(fa: Fa, caption = s('table.transitions')): Table {
  const usesEps = [...fa.delta.values()].some((row) => row.has(EPS));
  const symbols = [...fa.alphabet, ...(usesEps ? [EPS] : [])];
  return {
    caption,
    header: [s('table.state'), ...symbols],
    rows: fa.states.map((q) => [
      `${q === fa.start ? '→ ' : ''}${fa.accept.has(q) ? '* ' : ''}${q}`,
      ...symbols.map((a) => {
        const to = fa.delta.get(q)?.get(a);
        return to?.size ? [...to].join(', ') : '—';
      }),
    ]),
  };
}

const subsetTable = (rows: readonly SubsetRow[], alphabet: readonly string[]): Table => ({
  caption: s('table.subsets'),
  header: [s('table.dfaState'), s('table.nfaStates'), ...alphabet],
  rows: rows.map((r) => [`${r.accept ? '* ' : ''}${r.name}`, r.set, ...r.to]),
});

const roundsTable = (rounds: readonly string[][]): Table => ({
  caption: s('table.partitions'),
  header: [s('table.round'), s('table.classes')],
  rows: rounds.map((r, i) => [String(i), r.join('  ')]),
});

/** A machine, or a regular expression when the box holds a single line with no spaces in it. */
export function machineOf(text: string): { fa: Fa; fromRegex: boolean } {
  const body = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (body.length === 1 && !/\s/.test(body[0].trim()) && !/^(start|accept)/i.test(body[0].trim()))
    return { fa: thompson(parseRegex(body[0])), fromRegex: true };
  return { fa: parseFa(text), fromRegex: false };
}

const inputsOf = (text: string): string[] =>
  text.trim() === '' ? [] : text.split(/[,;]/).map((x) => x.trim().replace(/^ε$/, ''));

function verdicts(fa: Fa, inputs: readonly string[]): { answer: string; tables: Table[]; steps: string[] } {
  const results = inputs.map((w) => ({ w, r: run(fa, symbolsOfInput(w)) }));
  const yes = results.filter((x) => x.r.accepted).map((x) => shown(x.w));
  const no = results.filter((x) => !x.r.accepted).map((x) => shown(x.w));
  const answer = [
    yes.length ? s('acceptedList', { list: yes.join(', ') }) : '',
    no.length ? s('rejectedList', { list: no.join(', ') }) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const steps: string[] = [];
  const tables: Table[] = [];
  if (results.length) {
    const { w, r } = results[0];
    const symbols = symbolsOfInput(w);
    steps.push(s('steps.runStart', { set: setText(fa, r.sets[0]) }));
    symbols.forEach((a, i) => steps.push(s('steps.runRead', { a, set: setText(fa, r.sets[i + 1]) })));
    steps.push(s(r.accepted ? 'steps.runYes' : 'steps.runNo', { w: shown(w) }));
    tables.push({
      caption: s('table.run', { w: shown(w) }),
      header: [s('table.read'), s('table.active')],
      rows: [['—', setText(fa, r.sets[0])], ...symbols.map((a, i) => [a, setText(fa, r.sets[i + 1])])],
    });
  }
  return { answer, tables, steps };
}

function simulateOutcome(v: Values): Outcome {
  const { fa } = machineOf(v.machine ?? '');
  const inputs = inputsOf(v.inputs ?? '');
  const kind = s(isDfa(fa) ? 'kindDfa' : 'kindNfa', { count: fa.states.length });
  const r = verdicts(fa, inputs);
  return {
    ok: true,
    answer: r.answer || kind,
    note: r.answer ? kind : undefined,
    steps: r.steps,
    tables: [faTable(fa), ...r.tables],
    figure: faFigure(fa),
  };
}

function regexOutcome(v: Values): Outcome {
  const re = parseRegex(v.regex ?? '');
  const nfa = thompson(re);
  const { dfa, rows } = subset(nfa);
  const min = minimize(dfa);
  const inputs = inputsOf(v.inputs ?? '');
  const r = verdicts(min.dfa, inputs);
  const show = v.show === 'thompson' ? nfa : v.show === 'subset' ? dfa : min.dfa;
  return {
    ok: true,
    answer: s('regexAnswer', { nfa: nfa.states.length, dfa: dfa.states.length, min: min.dfa.states.length }),
    note: r.answer || undefined,
    steps: [
      s('steps.thompson', { re: print(re), count: nfa.states.length }),
      s('steps.subset', { count: dfa.states.length }),
      s('steps.minimize', { rounds: min.rounds.length, count: min.dfa.states.length }),
      ...r.steps,
    ],
    tables: [subsetTable(rows, nfa.alphabet), roundsTable(min.rounds), faTable(min.dfa, s('table.minimal'))],
    figure: faFigure(show),
  };
}

function convertOutcome(v: Values): Outcome {
  const { fa } = machineOf(v.machine ?? '');
  const op = v.operation ?? 'subset';
  if (op === 'regex') {
    const r = toRegex(fa);
    const text = print(r.re);
    return {
      ok: true,
      answer: s('regexOf', { re: text }),
      steps: [s('steps.gnfa'), ...r.steps.map((x) => s('steps.eliminate', { state: x.state, re: print(x.re) }))],
      tables: [faTable(fa)],
      figure: faFigure(fa),
    };
  }
  if (op === 'minimize') {
    const m = minimize(fa);
    return {
      ok: true,
      answer: s('minimalAnswer', { from: fa.states.length, count: m.dfa.states.length }),
      steps: [
        ...(isDfa(fa) ? [] : [s('steps.determinizeFirst')]),
        ...(m.removed.length ? [s('steps.unreachable', { list: m.removed.join(', ') })] : []),
        ...m.rounds.map((r, i) => s(i === 0 ? 'steps.firstSplit' : 'steps.refine', { classes: r.join(' '), round: i })),
        s('steps.stable'),
      ],
      tables: [roundsTable(m.rounds), faTable(m.dfa, s('table.minimal'))],
      figure: faFigure(m.dfa),
    };
  }
  if (op === 'complement') {
    const c = complement(fa);
    return {
      ok: true,
      answer: s('complementAnswer', { count: c.states.length }),
      steps: [s('steps.complement')],
      tables: [faTable(c, s('table.result'))],
      figure: faFigure(c),
    };
  }
  const { dfa, rows } = subset(fa);
  return {
    ok: true,
    answer: s('subsetAnswer', { from: fa.states.length, count: dfa.states.length }),
    steps: rows.map((r) =>
      s('steps.subsetRow', {
        name: r.name,
        set: r.set,
        moves: fa.alphabet.map((a, i) => `${a} → ${r.to[i]}`).join(', '),
      }),
    ),
    tables: [subsetTable(rows, fa.alphabet), faTable(dfa, s('table.result'))],
    figure: faFigure(dfa),
  };
}

function compareOutcome(v: Values): Outcome {
  const a = machineOf(v.first ?? '').fa;
  const b = machineOf(v.second ?? '').fa;
  const op = v.operation ?? 'equivalent';
  if (op === 'equivalent') {
    const r = equivalent(a, b);
    return {
      ok: true,
      answer: r.equal ? s('sameLanguage') : s(r.first ? 'onlyFirst' : 'onlySecond', { w: shown(r.witness) }),
      steps: [s('steps.equivalence')],
      tables: [faTable(a, s('table.first')), faTable(b, s('table.second'))],
    };
  }
  const p = minimize(product(a, b, op as ProductOp)).dfa;
  return {
    ok: true,
    answer: s('productAnswer', { op: s(`options.operation.${op}`), count: p.states.length }),
    steps: [s('steps.product'), s('steps.productMin', { count: p.states.length })],
    tables: [faTable(p, s('table.result'))],
    figure: faFigure(p),
  };
}

const EXAMPLES: Record<LanguageId, string> = {
  anbn: 'aaabbb',
  anbncn: 'aaabbbccc',
  ww: 'aaabaaab',
  palindrome: 'aaabaaa',
  squares: 'aaaaaaaaa',
  primes: 'aaaaa',
  balanced: '((()))',
  morea: 'aaaabbb',
};

function pumpingOutcome(v: Values): Outcome {
  const lang = (LANGUAGES as readonly string[]).includes(v.language ?? '') ? (v.language as LanguageId) : 'anbn';
  const kind = v.kind === 'cfl' ? 'cfl' : 'regular';
  const p = integers(v.p ?? '');
  const text = (v.s ?? '').trim();
  const game = playPumping(lang, kind, p?.length === 1 ? p[0] : NaN, text);
  const names = kind === 'regular' ? ['x', 'y', 'z'] : ['u', 'v', 'x', 'y', 'z'];
  const rows = game.splits
    .slice(0, 60)
    .map((r) => [...r.parts.map(shown), r.pumpOut === null ? s('survives') : s('pumpsOut', { i: r.pumpOut })]);
  const winner = game.survivor;
  return {
    ok: true,
    answer: winner
      ? s('pumpSurvives', { split: winner.parts.map((x, i) => `${names[i]} = ${shown(x)}`).join(', ') })
      : s('pumpWins', { count: game.splits.length }),
    note: s(kind === 'regular' ? 'pumpNoteRegular' : 'pumpNoteCfl'),
    steps: [
      s(kind === 'regular' ? 'steps.pumpRuleRegular' : 'steps.pumpRuleCfl', { p: p?.[0] ?? '' }),
      s('steps.pumpCount', { count: game.splits.length }),
      winner ? s('steps.pumpBadChoice') : s('steps.pumpGoodChoice'),
    ],
    tables: [
      {
        caption: game.splits.length > 60 ? s('table.splitsSome', { count: game.splits.length }) : s('table.splits'),
        header: [...names, s('table.outcome')],
        rows,
      },
    ],
  };
}

const DIV3 = `# Binary numbers divisible by 3: the state is the remainder so far.
start r0
accept r0
r0 0 r0
r0 1 r1
r1 0 r2
r1 1 r0
r2 0 r1
r2 1 r2`;

const ENDS01 = `# Strings that end in 01, guessing where the 0 is.
start q0
accept q2
q0 0 q0 q1
q0 1 q0
q1 1 q2`;

const SIMULATE: Mode = {
  id: 'simulate',
  fields: [area('machine', DIV3, 8), f('inputs', '110, 0, 111', { help: true, wide: true })],
  solve: solveWith(simulateOutcome),
};
const REGEX: Mode = {
  id: 'regex',
  fields: [
    f('regex', '(a|b)*abb', { help: true }),
    { id: 'show', kind: 'select', options: ['minimal', 'subset', 'thompson'] },
    f('inputs', 'abb, aabb, abab', { help: true, wide: true }),
  ],
  solve: solveWith(regexOutcome),
};
const CONVERT: Mode = {
  id: 'convert',
  fields: [
    area('machine', ENDS01),
    { id: 'operation', kind: 'select', options: ['subset', 'minimize', 'complement', 'regex'] },
  ],
  solve: solveWith(convertOutcome),
};
const COMPARE: Mode = {
  id: 'compare',
  fields: [
    area('first', '(a|b)*abb', 3),
    area('second', '(a|b)*bb', 3),
    { id: 'operation', kind: 'select', options: ['equivalent', 'union', 'intersection', 'difference'] },
  ],
  solve: solveWith(compareOutcome),
};
const PUMPING: Mode = {
  id: 'pumping',
  fields: (v) => [
    { id: 'language', kind: 'select', options: LANGUAGES },
    { id: 'kind', kind: 'select', options: ['regular', 'cfl'] },
    f('p', '3', { help: true }),
    f('s', EXAMPLES[(v.language as LanguageId) ?? 'anbn'] ?? EXAMPLES.anbn, { help: true }),
  ],
  solve: solveWith(pumpingOutcome),
};

export const AUTOMATA: ToolSpec = {
  id: 'automata',
  modes: [SIMULATE, REGEX, CONVERT, COMPARE, PUMPING, PDA, GRAMMAR, CNF, LL1, LR, TURING, FST],
};

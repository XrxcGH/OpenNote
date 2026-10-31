// The logic workbench's propositional modes as forms: truth tables, normal forms, natural-deduction proofs,
// syllogisms, and resolution with DPLL. Models, lambda terms, argument maps, and fault trees are in formsMore.ts.
import { treeFigure, treeText } from '../core/treeFigure';
import type { TreeNode } from '../core/treeFigure';
import { KitError, fail, lines } from '../core/util';
import type { Mode, Outcome, Table, ToolSpec, Values } from '../ui/types';
import { area, f, s, solveWith } from './common';
import { parseFormula, show } from './formula';
import type { Formula } from './formula';
import { ARGUMENT, FAULT, KRIPKE, LAMBDA, MODEL } from './formsMore';
import { classify, normalForm, truthTable } from './normal';
import type { TruthTable } from './normal';
import { checkProof, ruleName } from './proof';
import { clauseShow, dpll, resolution } from './sat';
import type { DpllNode } from './sat';
import { judge, parseStatement, statementText, vennFigure } from './syllogism';

const TF = (b: boolean) => (b ? 'T' : 'F');
const MAX_ROWS = 1024;

function tableOf(t: TruthTable, heads: readonly string[]): Table {
  return {
    caption: t.rows.length > MAX_ROWS ? s('table.someRows', { shown: MAX_ROWS, all: t.rows.length }) : s('table.truth'),
    header: [...t.vars, ...heads],
    rows: t.rows.slice(0, MAX_ROWS).map((r) => [...r.values.map(TF), ...r.results.map(TF)]),
  };
}

const rowText = (t: TruthTable, i: number) =>
  t.vars.map((v, j) => `${v} = ${TF(t.rows[i].values[j])}`).join(', ') || '—';
const formulaLines = (text: string): Formula[] => lines(text).map(parseFormula);

function truthOutcome(v: Values): Outcome {
  const kind = v.kind ?? 'classify';
  if (kind === 'validity') {
    const premises = formulaLines(v.premises ?? '');
    const conclusion = parseFormula(v.conclusion ?? '');
    const t = truthTable([...premises, conclusion]);
    const bad = t.rows.findIndex((r) => r.results.slice(0, -1).every(Boolean) && !r.results[r.results.length - 1]);
    return {
      ok: true,
      answer: bad < 0 ? s('valid') : s('invalid', { row: rowText(t, bad) }),
      steps: [s('steps.validity')],
      tables: [tableOf(t, [...premises.map((p) => show(p)), show(conclusion)])],
    };
  }
  if (kind === 'equivalence') {
    const a = parseFormula(v.formula ?? '');
    const b = parseFormula(v.second ?? '');
    const t = truthTable([a, b]);
    const bad = t.rows.findIndex((r) => r.results[0] !== r.results[1]);
    return {
      ok: true,
      answer: bad < 0 ? s('equivalent') : s('notEquivalent', { row: rowText(t, bad) }),
      steps: [s('steps.equivalence')],
      tables: [tableOf(t, [show(a), show(b)])],
    };
  }
  const a = parseFormula(v.formula ?? '');
  const t = truthTable([a]);
  const k = classify(t);
  const falseRow = t.rows.findIndex((r) => !r.results[0]);
  const trueRow = t.rows.findIndex((r) => r.results[0]);
  return {
    ok: true,
    answer: s(`kind_${k}`, { rows: t.rows.length }),
    note:
      k === 'contingent' ? s('rowsBoth', { trueRow: rowText(t, trueRow), falseRow: rowText(t, falseRow) }) : undefined,
    steps: [s('steps.rows', { n: t.vars.length, rows: t.rows.length })],
    tables: [tableOf(t, [show(a)])],
  };
}

function normalOutcome(v: Values): Outcome {
  const a = parseFormula(v.formula ?? '');
  const cnf = v.form !== 'dnf';
  const r = normalForm(a, cnf);
  return {
    ok: true,
    answer: s(cnf ? 'cnfAnswer' : 'dnfAnswer', { text: r.text }),
    steps: [s('steps.start', { text: show(a) }), ...r.stages.map((st) => s(`steps.nf_${st.key}`, { text: st.text }))],
    note: s('clauseCount', { count: r.clauses.length }),
  };
}

function proofOutcome(v: Values): Outcome {
  let r: ReturnType<typeof checkProof>;
  try {
    r = checkProof(v.proof ?? '');
  } catch (e) {
    if (e instanceof KitError && typeof e.vars.line === 'number')
      return fail('onLine', { line: e.vars.line, why: s(`errors.${e.key}`, e.vars) });
    throw e;
  }
  const firstBad = r.problems.findIndex((p) => p !== null);
  const last = r.lines[r.lines.length - 1];
  const premises = r.lines.filter((l) => l.rule === 'premise').map((l) => show(l.formula));
  const closed = last.depth === 0;
  const rows = r.lines.map((l, i) => {
    const p = r.problems[i];
    return [
      String(l.n),
      `${'│ '.repeat(l.depth)}${show(l.formula)}`,
      `${ruleName(l.rule)}${l.refs.length ? ` ${l.refs.map((x) => (x.to ? `${x.from}–${x.to}` : x.from)).join(', ')}` : ''}`,
      p ? s(`errors.${p.key}`, { rule: ruleName(l.rule), ...p.vars }) : '✓',
    ];
  });
  return {
    ok: true,
    answer:
      firstBad >= 0
        ? s('proofBad', { line: r.lines[firstBad].n, why: rows[firstBad][3] })
        : closed
          ? s('proofGood', { conclusion: show(last.formula), premises: premises.join(', ') || '∅' })
          : s('proofOpen'),
    note: r.ok && closed && premises.length === 0 ? s('theorem') : undefined,
    tables: [
      {
        caption: s('table.proof'),
        header: [s('table.line'), s('table.formula'), s('table.rule'), s('table.check')],
        rows,
      },
    ],
  };
}

function syllogismOutcome(v: Values): Outcome {
  const major = parseStatement(v.major ?? '');
  const minor = parseStatement(v.minor ?? '');
  const conclusion = parseStatement(v.conclusion ?? '');
  const existential = v.import === 'aristotelian';
  const r = judge(major, minor, conclusion, existential);
  const venn = vennFigure(major, minor, r.terms);
  const named = { [r.terms.S]: 'S', [r.terms.P]: 'P', [r.terms.M]: 'M' };
  return {
    ok: true,
    answer: r.valid
      ? s(r.name ? 'syllogismValidNamed' : 'syllogismValid', { form: r.form, name: r.name ?? '' })
      : s('syllogismInvalid', { form: r.form, rules: r.broken.map((b) => s(`fallacy.${b}`)).join('; ') }),
    note: existential ? s('importNote') : s('booleanNote'),
    steps: [
      s('steps.terms', { S: r.terms.S, P: r.terms.P, M: r.terms.M }),
      s('steps.form', { major: statementText(major, named), minor: statementText(minor, named), form: r.form }),
      s('steps.rules'),
    ],
    figure: {
      svg: venn.svg,
      alt: s('vennAlt', {
        S: r.terms.S,
        P: r.terms.P,
        M: r.terms.M,
        shaded: venn.shaded.length,
        marks: venn.xs.filter((x) => x.length).length,
      }),
    },
  };
}

const dpllNode = (n: DpllNode): TreeNode => ({
  label: n.label,
  edge: n.edge,
  note: n.result ? s(`dpll_${n.result}`) : undefined,
  tone: n.result === 'sat' ? 'accentSoft' : n.result === 'unsat' ? 'warnSoft' : undefined,
  shape: 'box',
  children: n.kids.map(dpllNode),
});

function satOutcome(v: Values): Outcome {
  const premises = formulaLines(v.formulas ?? '');
  if (!premises.length) fail('emptyFormula');
  const goalText = (v.goal ?? '').trim();
  const all: Formula[] = goalText ? [...premises, { k: 'not', f: parseFormula(goalText) }] : premises;
  const clauses = all.flatMap((x) => normalForm(x, true).clauses);
  const steps = [
    s(goalText ? 'steps.negateGoal' : 'steps.clauses', {
      count: clauses.length,
      list: clauses.map(clauseShow).join(' ') || '∅',
    }),
  ];
  if (v.method === 'dpll') {
    const r = dpll(clauses);
    const node = dpllNode(r.tree);
    return {
      ok: true,
      answer: r.sat
        ? s(goalText ? 'goalFails' : 'satisfiable', {
            model: [...r.model!].map(([k, b]) => `${k} = ${TF(b)}`).join(', ') || '—',
          })
        : s(goalText ? 'goalFollows' : 'unsatisfiable'),
      note: s('dpllNodes', { count: r.nodes }),
      steps: [...steps, s('steps.dpll')],
      figure: { svg: treeFigure(node), alt: s('treeAlt', { tree: treeText(node) }) },
    };
  }
  const r = resolution(clauses);
  const used = r.refuted ? r.proof : [];
  const rows = (r.refuted ? used : r.all.map((_, i) => i)).slice(0, 300).map((i) => {
    const x = r.all[i];
    return [
      String(i + 1),
      clauseShow(x.clause),
      x.from ? s('resolvedFrom', { a: x.from[0] + 1, b: x.from[1] + 1, on: x.from[2] }) : s('given'),
    ];
  });
  return {
    ok: true,
    answer: r.refuted
      ? s(goalText ? 'goalFollows' : 'unsatisfiable')
      : s(goalText ? 'goalNotShown' : 'saturated', { count: r.all.length }),
    steps: [...steps, s('steps.resolution')],
    tables: [
      {
        caption: r.refuted ? s('table.refutation') : s('table.clauses'),
        header: ['#', s('table.clause'), s('table.from')],
        rows,
      },
    ],
  };
}

const TRUTH: Mode = {
  id: 'truth',
  fields: (v) => {
    const kind = v.kind ?? 'classify';
    return [
      { id: 'kind', kind: 'select', options: ['classify', 'equivalence', 'validity'] },
      ...(kind === 'validity'
        ? [area('premises', 'p -> q\nq -> r', 3), f('conclusion', 'p -> r', { wide: true })]
        : [
            f('formula', kind === 'equivalence' ? '~(p & q)' : '((p -> q) and (q -> r)) -> (p -> r)', {
              help: true,
              wide: true,
            }),
            ...(kind === 'equivalence' ? [f('second', '~p | ~q', { wide: true })] : []),
          ]),
    ];
  },
  solve: solveWith(truthOutcome),
};
const NORMAL: Mode = {
  id: 'normal',
  fields: [
    f('formula', '(p and q) or r', { help: true, wide: true }),
    { id: 'form', kind: 'select', options: ['cnf', 'dnf'] },
  ],
  solve: solveWith(normalOutcome),
};
const PROOF: Mode = {
  id: 'proof',
  fields: [area('proof', '1. p -> q  premise\n2. ~q  premise\n3. ~p  MT 1, 2', 8)],
  solve: solveWith(proofOutcome),
};
const SYLLOGISM: Mode = {
  id: 'syllogism',
  fields: [
    f('major', 'All mammals are animals', { wide: true }),
    f('minor', 'All dogs are mammals', { wide: true }),
    f('conclusion', 'All dogs are animals', { wide: true, help: true }),
    { id: 'import', kind: 'select', options: ['boolean', 'aristotelian'] },
  ],
  solve: solveWith(syllogismOutcome),
};
const SAT: Mode = {
  id: 'sat',
  fields: [
    area('formulas', 'p -> q\nq -> r\np', 4),
    f('goal', 'r', { help: true }),
    { id: 'method', kind: 'select', options: ['resolution', 'dpll'] },
  ],
  solve: solveWith(satOutcome),
};

export const LOGIC: ToolSpec = {
  id: 'logic',
  modes: [TRUTH, NORMAL, PROOF, SYLLOGISM, MODEL, KRIPKE, SAT, LAMBDA, ARGUMENT, FAULT],
};

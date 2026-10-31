// The logic workbench's other modes as forms: first-order models, Kripke models, lambda terms, argument maps, and
// fault trees.
import { graphFigure } from '../core/graphFigure';
import { treeFigure, treeText } from '../core/treeFigure';
import type { TreeNode } from '../core/treeFigure';
import { fail, integers, num } from '../core/util';
import type { Mode, Outcome, Values } from '../ui/types';
import { area, f, s, solveWith } from './common';
import { parseFormula, show } from './formula';
import { boolean, numeral, parseProgram, print, reduce } from './lambda';
import { MAX_EXACT, cutSets, flatten, parseArgument, parseFaultTree, topProbability } from './maps';
import type { Claim } from './maps';
import { closeFrame, holds, parseKripke, parseStructure, truthAt } from './models';
import type { Frame } from './models';

function modelOutcome(v: Values): Outcome {
  const st = parseStructure(v.structure ?? '');
  const formula = parseFormula(v.formula ?? '');
  const r = holds(st, formula);
  const why = r.notes.map((n) => {
    const [kind, x, d, sub, env] = n.split('|');
    return s(kind === 'all' ? 'counterexample' : 'witness', { x, d, sub, env: env || '—' });
  });
  return {
    ok: true,
    answer: s(r.value ? 'modelTrue' : 'modelFalse', { formula: show(formula) }),
    steps: [s('steps.domain', { domain: st.domain.join(', ') }), ...why.slice(0, 12)],
    tables: [
      {
        caption: s('table.structure'),
        header: [s('table.symbol'), s('table.meaning')],
        rows: [
          ...[...st.preds].map(([k, set]) => [
            k,
            [...set].map((x) => (x.includes(',') ? `(${x})` : x)).join(', ') || '∅',
          ]),
          ...[...st.fns].map(([k, m]) => [k, [...m].map(([a, b]) => `${a} ↦ ${b}`).join(', ')]),
          ...[...st.consts].map(([k, c]) => [k, c]),
        ],
      },
    ],
  };
}

function kripkeOutcome(v: Values): Outcome {
  const k = parseKripke(v.worlds ?? '', v.relation ?? '', v.valuation ?? '');
  const frame = (['K', 'T', 'S4', 'S5'].includes(v.frame ?? '') ? v.frame : 'K') as Frame;
  const rel = closeFrame(k, frame);
  const formula = parseFormula(v.formula ?? '');
  const truth = truthAt(k, rel, formula);
  const yes = k.worlds.filter((w) => truth.get(w));
  const edges = [...rel].map((p) => {
    const [from, to] = p.split('\u0000');
    return { from, to, bold: !k.rel.has(p) };
  });
  return {
    ok: true,
    answer: s('kripkeAnswer', { formula: show(formula), list: yes.join(', ') || '∅', count: yes.length }),
    note: s(`frame_${frame}`),
    steps: [s('steps.kripke'), s('steps.frame', { added: rel.size - k.rel.size })],
    tables: [
      {
        caption: s('table.worlds'),
        header: [s('table.world'), s('table.trueLetters'), s('table.sees'), show(formula)],
        rows: k.worlds.map((w) => [
          w,
          [...k.val.get(w)!].join(', ') || '∅',
          k.worlds.filter((u) => rel.has(`${w}\u0000${u}`)).join(', ') || '∅',
          truth.get(w) ? 'T' : 'F',
        ]),
      },
    ],
    figure:
      k.worlds.length <= 30
        ? {
            svg: graphFigure(
              k.worlds.map((w) => ({
                id: w,
                label: w,
                note: [...k.val.get(w)!].join(' ') || undefined,
                ring: truth.get(w),
              })),
              edges,
              { directed: true },
            ),
            alt: s('kripkeAlt', {
              count: k.worlds.length,
              edges: edges.map((e) => `${e.from} → ${e.to}`).join(', ') || '∅',
            }),
          }
        : undefined,
  };
}

function lambdaOutcome(v: Values): Outcome {
  const term = parseProgram(v.term ?? '');
  const limit = integers(v.limit ?? '');
  const max = limit?.length === 1 ? limit[0] : NaN;
  if (!(max >= 1 && max <= 10_000)) fail('lambdaLimit', { max: 10_000 });
  const r = reduce(term, max);
  const last = r.terms[r.terms.length - 1];
  const n = numeral(last);
  const b = boolean(last);
  const meaning = n !== null ? s('isNumeral', { n }) : b !== null ? s(b ? 'isTrue' : 'isFalse') : undefined;
  return {
    ok: true,
    answer: r.normal
      ? s('normalForm', { term: print(last), steps: r.steps })
      : s(r.tooBig ? 'lambdaBig' : 'lambdaLimitHit', { steps: r.steps, term: print(last) }),
    note: meaning,
    steps: r.terms.map((t, i) =>
      i === 0
        ? s('steps.lambdaStart', { term: print(t) })
        : i === r.terms.length - 1 && r.steps > r.terms.length - 1
          ? s('steps.lambdaLast', { term: print(t), i: r.steps })
          : s('steps.beta', { term: print(t), i }),
    ),
  };
}

const claimNode = (c: Claim): TreeNode => ({
  label: c.number,
  note: c.text.length > 28 ? `${c.text.slice(0, 27)}…` : c.text,
  edge: c.kind === 'root' ? undefined : s(`relation.${c.kind}`),
  tone: c.kind === 'objection' ? 'warnSoft' : c.kind === 'support' ? 'accentSoft' : 'hiSoft',
  shape: 'box',
  children: c.children.map(claimNode),
});

function argumentOutcome(v: Values): Outcome {
  const root = parseArgument(v.outline ?? '');
  const all = flatten(root);
  const node = claimNode(root);
  return {
    ok: true,
    answer: s('argumentAnswer', {
      supports: all.filter((c) => c.kind === 'support').length,
      objections: all.filter((c) => c.kind === 'objection').length,
    }),
    tables: [
      {
        caption: s('table.claims'),
        header: [s('table.number'), s('table.role'), s('table.text')],
        rows: all.map((c) => [c.number, s(`relation.${c.kind}`), c.text]),
      },
    ],
    figure: { svg: treeFigure(node), alt: s('treeAlt', { tree: treeText(node) }) },
  };
}

function faultOutcome(v: Values): Outcome {
  const t = parseFaultTree(v.gates ?? '');
  const cuts = cutSets(t);
  const p = topProbability(cuts, t.prob);
  return {
    ok: true,
    answer:
      p.exact !== null
        ? s('faultExact', { p: num(p.exact, 6), count: cuts.length })
        : s('faultRare', { p: num(p.rare, 6), count: cuts.length }),
    note: s('faultBounds', { rare: num(p.rare, 6), upper: num(p.upper, 6), max: MAX_EXACT }),
    steps: [s('steps.mocus', { top: t.top }), s('steps.inclusion')],
    tables: [
      {
        caption: s('table.cuts'),
        header: [s('table.cutSet'), s('table.order'), s('table.probability')],
        rows: cuts.slice(0, 300).map((c) => [
          `{${c.join(', ')}}`,
          String(c.length),
          num(
            c.reduce((a, e) => a * t.prob.get(e)!, 1),
            6,
          ),
        ]),
      },
    ],
  };
}

export const MODEL: Mode = {
  id: 'model',
  fields: [
    area('structure', 'domain 1 2 3\nR = {(1,2), (2,3), (3,1)}\nP = {1, 2}\nf = {1->2, 2->3, 3->1}\nc = 1', 6),
    f('formula', 'forall x exists y R(x, y)', { help: true, wide: true }),
  ],
  solve: solveWith(modelOutcome),
};
export const KRIPKE: Mode = {
  id: 'kripke',
  fields: [
    f('worlds', 'w1 w2'),
    f('relation', 'w1 R w2', { help: true }),
    area('valuation', 'w2: p', 3),
    { id: 'frame', kind: 'select', options: ['K', 'T', 'S4', 'S5'] },
    f('formula', '[]p', { help: true, wide: true }),
  ],
  solve: solveWith(kripkeOutcome),
};
export const LAMBDA: Mode = {
  id: 'lambda',
  fields: [area('term', '(\\x. x x)(\\y. y)', 4), f('limit', '10000')],
  solve: solveWith(lambdaOutcome),
};
export const ARGUMENT: Mode = {
  id: 'argument',
  fields: [
    area(
      'outline',
      'Claim: The town should build the park.\n+ Children need a safe place to play.\n  + 2 schools are nearby.\n' +
        '- It costs too much.\n  - The town has a surplus this year.',
      6,
    ),
  ],
  solve: solveWith(argumentOutcome),
};
export const FAULT: Mode = {
  id: 'fault',
  fields: [area('gates', 'top = A AND (B OR C)\nA 0.1\nB 0.2\nC 0.3', 6)],
  solve: solveWith(faultOutcome),
};

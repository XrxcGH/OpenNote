// The numbers, counting, and groups tool's number-theory and counting modes as forms. Ciphers, groups, and fields
// are in formsAlgebra.ts.
import { fracLatex, fracText } from '../core/frac';
import { fail, integers, num, numbers } from '../core/util';
import type { Field, Mode, Outcome, ToolSpec, Values } from '../ui/types';
import {
  bell,
  catalan,
  choose,
  closedText,
  derangements,
  master,
  multichoose,
  multinomial,
  partitions,
  permutations,
  recurrence,
  stirling1,
  stirling2,
} from './counting';
import { bigOf, ds, smallOf, solveWith } from './common';
import { expandSeries, inclusionExclusion } from './series';
import { CIPHER, FIELD, GROUP, PERM, PUBLIC } from './formsAlgebra';
import {
  big,
  carmichael,
  continuedFraction,
  crt,
  diophantine,
  discreteLog,
  extendedEuclid,
  factor,
  gcd,
  isPrime,
  jacobi,
  modInverse,
  modPow,
  orderMod,
  parseBase,
  phi,
  primeProven,
  primitiveRoot,
  toBase,
} from './numbers';

const s = ds;
const bigList = (text: string, id: string): bigint[] => {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) fail('list', { field: s(`fields.${id}`) });
  return parts.map((p) => big(p, s(`fields.${id}`)));
};
const factorText = (fs: { p: bigint; k: number }[]) =>
  fs.map(({ p, k }) => (k > 1 ? `${p}^${k}` : `${p}`)).join(' × ') || '1';

function euclidOutcome(v: Values): Outcome {
  const a = bigOf(v, 'a');
  const b = bigOf(v, 'b');
  const r = extendedEuclid(a, b);
  const notes: string[] = [];
  if (r.g === 1n && b > 1n) notes.push(s('inverse', { a: String(a), m: String(b), inv: String(modInverse(a, b)) }));
  if (a !== 0n && b !== 0n) notes.push(s('lcm', { lcm: String(((a < 0n ? -a : a) / r.g) * (b < 0n ? -b : b)) }));
  return {
    ok: true,
    answer: s('euclidAnswer', { g: String(r.g), a: String(a), b: String(b), x: String(r.x), y: String(r.y) }),
    latex: `\\gcd(${a}, ${b}) = ${r.g} = ${a}\\cdot(${r.x}) + ${b}\\cdot(${r.y})`,
    note: notes.join('\n') || undefined,
    steps: [s('steps.euclid'), s('steps.euclidBack')],
    tables: [
      {
        caption: s('table.euclid'),
        header: ['q', 'r', 's', 't'],
        rows: r.rows.map((row) => [row.q === null ? '' : String(row.q), String(row.r), String(row.s), String(row.t)]),
      },
    ],
  };
}

function powOutcome(v: Values): Outcome {
  const a = bigOf(v, 'base');
  const e = bigOf(v, 'exponent');
  const m = bigOf(v, 'modulus');
  const r = modPow(a, e, m);
  return {
    ok: true,
    answer: s('powAnswer', { a: String(a), e: String(e), m: String(m), value: String(r.value) }),
    latex: `${a}^{${e}} \\equiv ${r.value} \\pmod{${m}}`,
    steps: [s('steps.squareMultiply', { bits: e < 0n ? '' : e.toString(2) })],
    tables: [
      {
        caption: s('table.pow'),
        header: [s('table.bit'), s('table.square'), s('table.result')],
        rows: r.steps.map((st) => [String(st.bit), String(st.square), String(st.result)]),
      },
    ],
  };
}

function crtOutcome(v: Values): Outcome {
  const res = bigList(v.residues ?? '', 'residues');
  const mods = bigList(v.moduli ?? '', 'moduli');
  const r = crt(res, mods);
  return {
    ok: true,
    answer: s('crtAnswer', { x: String(r.x), m: String(r.m) }),
    latex: `x \\equiv ${r.x} \\pmod{${r.m}}`,
    steps: r.steps.map((st, i) =>
      s(i === 0 ? 'steps.crtStart' : 'steps.crtJoin', { x: String(st.x), m: String(st.m) }),
    ),
  };
}

function numberOutcome(v: Values): Outcome {
  const n = bigOf(v, 'n');
  if (n < 1n) return fail('positive');
  const prime = isPrime(n);
  const fs = factor(n);
  const divisors = fs.reduce((acc, f) => acc * BigInt(f.k + 1), 1n);
  const sigma = fs.reduce((acc, { p, k }) => acc * ((p ** BigInt(k + 1) - 1n) / (p - 1n)), 1n);
  const root = n <= 10n ** 12n ? primitiveRoot(n) : null;
  const rows: string[][] = [
    [s('row.prime'), prime ? s('yes') : s('no')],
    [s('row.factors'), factorText(fs)],
    [s('row.phi'), String(phi(n))],
    [s('row.lambda'), String(carmichael(n))],
    [s('row.divisors'), String(divisors)],
    [s('row.sigma'), String(sigma)],
    [s('row.root'), root === null ? s('none') : String(root)],
  ];
  const notes: string[] = [];
  if (!prime && n > 2n && (n - 1n) % carmichael(n) === 0n && fs.every((f) => f.k === 1) && fs.length >= 2)
    notes.push(s('carmichaelNumber'));
  if (prime && !primeProven(n)) notes.push(s('probable'));
  if ((v.a ?? '').trim()) {
    const a = bigOf(v, 'a');
    if (gcd(a, n) === 1n && n > 1n) rows.push([s('row.order', { a: String(a) }), String(orderMod(a, n))]);
    if (n % 2n === 1n) rows.push([s('row.jacobi', { a: String(a) }), String(jacobi(a, n))]);
  }
  return {
    ok: true,
    answer: s(prime ? 'primeAnswer' : n === 1n ? 'oneAnswer' : 'compositeAnswer', {
      n: String(n),
      factors: factorText(fs),
    }),
    note: notes.join('\n') || undefined,
    steps: [s('steps.millerRabin'), s('steps.rho'), s('steps.phi')],
    tables: [{ caption: s('table.number', { n: String(n) }), header: [s('table.measure'), s('table.value')], rows }],
  };
}

function dlogOutcome(v: Values): Outcome {
  const g = bigOf(v, 'g');
  const h = bigOf(v, 'h');
  const n = bigOf(v, 'modulus');
  const r = discreteLog(g, h, n);
  return {
    ok: true,
    answer:
      r.x === null
        ? s('dlogNone', { g: String(g), h: String(h), n: String(n) })
        : s('dlogAnswer', { g: String(g), h: String(h), n: String(n), x: String(r.x) }),
    steps: [s('steps.bsgs', { m: String(r.m) })],
  };
}

function convertOutcome(v: Values): Outcome {
  if (v.kind === 'diophantine') {
    const [a, b, c] = [bigOf(v, 'a'), bigOf(v, 'b'), bigOf(v, 'c')];
    if (a === 0n && b === 0n) return fail('bothZero');
    const r = diophantine(a, b, c);
    if (!r) return { ok: true, answer: s('dioNone', { g: String(gcd(a, b)), c: String(c) }) };
    return {
      ok: true,
      answer: s('dioAnswer', { x: String(r.x), y: String(r.y), dx: String(r.dx), dy: String(r.dy) }),
      latex: `x = ${r.x} + ${r.dx}t,\\quad y = ${r.y} ${r.dy < 0n ? '-' : '+'} ${r.dy < 0n ? -r.dy : r.dy}t`,
      steps: [s('steps.dioGcd', { g: String(r.g) }), s('steps.dioScale')],
    };
  }
  if (v.kind === 'base') {
    const from = smallOf(v, 'from', 36);
    const to = smallOf(v, 'to', 36);
    if (from < 2 || to < 2) return fail('baseRange');
    const x = parseBase(v.value ?? '', from);
    return {
      ok: true,
      answer: s('baseAnswer', { value: (v.value ?? '').trim(), from, out: toBase(x, to), to }),
      tables: [
        {
          caption: s('table.bases'),
          header: [s('table.base'), s('table.value')],
          rows: [2, 8, 10, 16].map((b) => [String(b), toBase(x, b)]),
        },
      ],
    };
  }
  const p = bigOf(v, 'p');
  const q = bigOf(v, 'q');
  const r = continuedFraction(p, q);
  return {
    ok: true,
    answer: s('cfAnswer', { p: String(p), q: String(q), terms: `[${r.terms[0]}; ${r.terms.slice(1).join(', ')}]` }),
    steps: [s('steps.cf')],
    tables: [
      {
        caption: s('table.convergents'),
        header: ['k', 'a_k', s('table.convergent')],
        rows: r.terms.map((t, k) => [String(k), String(t), `${r.convergents[k][0]}/${r.convergents[k][1]}`]),
      },
    ],
  };
}

function countingOutcome(v: Values): Outcome {
  const n = smallOf(v, 'n', 2000);
  const k = smallOf(v, 'k', 2000);
  if (n < 0 || k < 0) return fail('countWhole');
  const cap = (f: () => bigint) => {
    const x = f();
    const t = x.toString();
    return t.length > 60 ? s('digits', { lead: t.slice(0, 12), count: t.length }) : t;
  };
  const rows: [string, string][] = [
    [s('count.perm', { n, k }), cap(() => permutations(n, k))],
    [s('count.choose', { n, k }), cap(() => choose(n, k))],
    [s('count.permRep', { n, k }), cap(() => BigInt(n) ** BigInt(k))],
    [s('count.chooseRep', { n, k }), cap(() => multichoose(n, k))],
    [s('count.stirling2', { n, k }), n <= 400 ? cap(() => stirling2(n, k)) : '–'],
    [s('count.stirling1', { n, k }), n <= 400 ? cap(() => stirling1(n, k)) : '–'],
    [s('count.bell', { n }), n <= 400 ? cap(() => bell(n)) : '–'],
    [s('count.catalan', { n }), n <= 1000 ? cap(() => catalan(n)) : '–'],
    [s('count.partitions', { n }), cap(() => partitions(n))],
    [s('count.derangements', { n }), cap(() => derangements(n))],
  ];
  const parts = (v.parts ?? '').trim() ? integers(v.parts ?? '') : null;
  if ((v.parts ?? '').trim() && !parts) return fail('list', { field: s('fields.parts') });
  if (parts) rows.push([s('count.multinomial', { parts: parts.join(', ') }), cap(() => multinomial(parts))]);
  return {
    ok: true,
    answer: s('countAnswer', { n, k, perm: rows[0][1], choose: rows[1][1] }),
    latex: `\\binom{${n}}{${k}} = \\frac{${n}!}{${k}!\\,(${n} - ${k})!} = ${rows[1][1].length < 40 ? rows[1][1] : '\\dots'}`,
    tables: [{ caption: s('table.counts'), header: [s('table.count'), s('table.value')], rows }],
  };
}

function recurrenceOutcome(v: Values): Outcome {
  const c = integers(v.coefs ?? '');
  const a = integers(v.start ?? '');
  if (!c || !a) return fail('list', { field: s('fields.coefs') });
  const count = smallOf(v, 'count', 200);
  const r = recurrence(c, a, count);
  const charPoly = `x^{${c.length}} ${c.map((ci, i) => `${ci < 0 ? '+' : '-'} ${Math.abs(ci)}x^{${c.length - 1 - i}}`).join(' ')}`;
  const steps = [s('steps.recChar', { poly: charPoly.replace(/[{}]/g, '') })];
  if (r.roots)
    steps.push(
      s('steps.recRoots', { roots: r.roots.map((x) => `${fracText(x.r)}${x.m > 1 ? ` (×${x.m})` : ''}`).join(', ') }),
    );
  else steps.push(s('steps.recIrrational'));
  if (r.closed) steps.push(s('steps.recSolve'));
  const show = r.terms.slice(0, count);
  return {
    ok: true,
    answer: r.closed
      ? s('recAnswer', { form: closedText(r.closed) })
      : s('recTerms', { n: show.length - 1, value: String(show[show.length - 1]) }),
    latex: r.closed
      ? `a_n = ${r.closed
          .filter((t) => t.c.n !== 0n)
          .map((t) => `${fracLatex(t.c)}${t.j ? `n^{${t.j}}` : ''}\\left(${fracLatex(t.r)}\\right)^{n}`)
          .join(' + ')}`
      : undefined,
    steps,
    tables: [
      {
        caption: s('table.terms'),
        header: ['n', 'a_n'],
        rows: show.map((t, i) => [
          String(i),
          t.toString().length > 60
            ? s('digits', { lead: t.toString().slice(0, 12), count: t.toString().length })
            : String(t),
        ]),
      },
    ],
  };
}

function masterOutcome(v: Values): Outcome {
  const x = (id: string) => {
    const r = numbers(v[id] ?? '');
    if (!r || r.length !== 1) return fail('number', { field: s(`fields.${id}`) });
    return r[0];
  };
  const [a, b, k, p] = [x('a'), x('b'), x('k'), x('logPower')];
  const r = master(a, b, k, p);
  const crit = num(r.crit, 6);
  const growth =
    r.case === 1
      ? `n^{${crit}}`
      : r.case === 2
        ? `n^{${num(k)}} \\log^{${num(p + 1)}} n`
        : `n^{${num(k)}}${p ? ` \\log^{${num(p)}} n` : ''}`;
  return {
    ok: true,
    answer: s(`masterCase${r.case}`, { crit, k: num(k) }),
    latex: `T(n) = \\Theta\\left(${growth}\\right)`,
    note: r.case === 3 ? s('masterRegularity') : undefined,
    steps: [s('steps.masterCrit', { a: num(a), b: num(b), crit })],
  };
}

const f = (id: string, initial: string, extra: Partial<Field> = {}): Field => ({ id, initial, ...extra });

const EUCLID: Mode = { id: 'euclid', fields: [f('a', '240'), f('b', '46')], solve: solveWith(euclidOutcome) };
const POW: Mode = {
  id: 'pow',
  fields: [f('base', '4'), f('exponent', '13'), f('modulus', '497')],
  solve: solveWith(powOutcome),
};
const CRT: Mode = {
  id: 'crt',
  fields: [f('residues', '2, 3, 2'), f('moduli', '3, 5, 7')],
  solve: solveWith(crtOutcome),
};
const NUMBER: Mode = {
  id: 'number',
  fields: [f('n', '561'), f('a', '', { help: true })],
  solve: solveWith(numberOutcome),
};
const DLOG: Mode = {
  id: 'dlog',
  fields: [f('g', '3'), f('h', '13'), f('modulus', '17')],
  solve: solveWith(dlogOutcome),
};

const CONVERT_FIELDS: Record<string, Field[]> = {
  fraction: [f('p', '415'), f('q', '93')],
  diophantine: [f('a', '240'), f('b', '46'), f('c', '4')],
  base: [f('value', '255'), f('from', '10'), f('to', '2')],
};
const CONVERT: Mode = {
  id: 'convert',
  fields: (v) => [
    { id: 'kind', kind: 'select', options: ['fraction', 'diophantine', 'base'] },
    ...(CONVERT_FIELDS[v.kind ?? 'fraction'] ?? CONVERT_FIELDS.fraction),
  ],
  solve: solveWith(convertOutcome),
};
const COUNTING: Mode = {
  id: 'counting',
  fields: [f('n', '10'), f('k', '3'), f('parts', '', { help: true })],
  solve: solveWith(countingOutcome),
};
function genfunOutcome(v: Values): Outcome {
  const count = smallOf(v, 'terms', 200);
  if (count < 1) return fail('gfTerms');
  const c = expandSeries(v.gf ?? '', count);
  const shown = c.map(fracText);
  return {
    ok: true,
    answer: s('gfAnswer', { list: shown.join(', ') }),
    latex: `${c
      .slice(0, 8)
      .map((x, i) => `${fracLatex(x)}${i === 0 ? '' : i === 1 ? 'x' : `x^{${i}}`}`)
      .join(' + ')
      .replace(/\+ -/g, '- ')} + \\dots`,
    steps: [s('steps.gfSeries')],
    tables: [
      {
        caption: s('table.coefficients'),
        header: ['n', s('table.coefficient')],
        rows: shown.map((x, i) => [String(i), x]),
      },
    ],
  };
}

function inclusionOutcome(v: Values): Outcome {
  const total = (v.universe ?? '').trim() ? bigOf(v, 'universe') : null;
  const r = inclusionExclusion(v.sizes ?? '', total);
  const signed = r.levels.map((x, k) => `${k === 0 ? '' : k % 2 === 1 ? ' − ' : ' + '}${x}`).join('');
  return {
    ok: true,
    answer:
      r.neither === null
        ? s('ieAnswer', { sets: r.sets.join(' ∪ '), union: String(r.union) })
        : s('ieAnswerNeither', { sets: r.sets.join(' ∪ '), union: String(r.union), neither: String(r.neither) }),
    latex: `|${r.sets.join(' \\cup ')}| = ${signed.replace(/−/g, '-')} = ${r.union}`,
    steps: r.levels.map((x, k) => s(k % 2 === 0 ? 'steps.ieAdd' : 'steps.ieSubtract', { k: k + 1, sum: String(x) })),
  };
}

const GENFUN: Mode = {
  id: 'genfun',
  fields: [f('gf', '1/((1 - x)(1 - x^5))', { wide: true, help: true }), f('terms', '11')],
  solve: solveWith(genfunOutcome),
};
const INCLUSION: Mode = {
  id: 'inclusion',
  fields: [
    f('sizes', 'A 12\nB 15\nC 9\nA B 5\nA C 3\nB C 4\nA B C 2', { kind: 'area', help: true }),
    f('universe', '40'),
  ],
  solve: solveWith(inclusionOutcome),
};
const RECURRENCE: Mode = {
  id: 'recurrence',
  fields: [f('coefs', '1, 2', { help: true }), f('start', '0, 1'), f('count', '11')],
  solve: solveWith(recurrenceOutcome),
};
const MASTER: Mode = {
  id: 'master',
  fields: [f('a', '2'), f('b', '2'), f('k', '1', { help: true }), f('logPower', '0')],
  solve: solveWith(masterOutcome),
};

export const DISCRETE: ToolSpec = {
  id: 'discrete',
  modes: [
    EUCLID,
    POW,
    CRT,
    NUMBER,
    DLOG,
    CONVERT,
    CIPHER,
    PUBLIC,
    COUNTING,
    GENFUN,
    INCLUSION,
    RECURRENCE,
    MASTER,
    PERM,
    GROUP,
    FIELD,
  ],
};

// The numbers, counting, and groups tool's cipher, public-key, permutation, group, and field modes as forms.
import { hasseFigure } from '../core/hasse';
import { fail, integers, matrix, num } from '../core/util';
import type { Field, Mode, Outcome, Table, Values } from '../ui/types';
import { bigOf, ds as s, smallOf, solveWith } from './common';
import {
  affine,
  caesar,
  diffieHellman,
  elGamal,
  hill,
  letterCounts,
  lfsr,
  rsa,
  substitution,
  vigenere,
} from './crypto';
import { fieldInverse, fieldMul, fieldPow, makeField, parsePoly, polyAdd, polyText, powersOfX, ringZn } from './field';
import {
  center,
  classSize,
  compose,
  cycleText,
  cycleType,
  elementOrder,
  generate,
  inversePerm,
  isAbelian,
  isNormal,
  lattice,
  leftCosets,
  makeGroup,
  parseCayley,
  parseCycles,
  permOrder,
  permSign,
  subgroups,
} from './groups';
import type { Family, Group } from './groups';

const f = (id: string, initial: string, extra: Partial<Field> = {}): Field => ({ id, initial, ...extra });

// Ciphers.

const CIPHER_FIELDS: Record<string, Field[]> = {
  caesar: [f('shift', '3')],
  affine: [f('mult', '5'), f('add', '8')],
  vigenere: [f('key', 'LEMON')],
  substitution: [f('alphabet', 'QWERTYUIOPASDFGHJKLZXCVBNM', { help: true, wide: true })],
  hill: [f('matrix', '3 3\n2 5', { kind: 'area', rows: 3, help: true })],
  frequency: [],
  lfsr: [f('seed', '1000'), f('taps', '1, 4', { help: true }), f('count', '20')],
};

function cipherOutcome(v: Values): Outcome {
  const kind = v.kind ?? 'vigenere';
  const back = v.direction === 'decrypt';
  const text = v.text ?? '';
  if (kind === 'lfsr') {
    const taps = integers(v.taps ?? '');
    if (!taps) return fail('list', { field: s('fields.taps') });
    const r = lfsr(v.seed ?? '', taps, smallOf(v, 'count', 4096));
    return {
      ok: true,
      answer: s('lfsrAnswer', { bits: r.bits }),
      note: r.period === null ? s('lfsrNoPeriod') : s('lfsrPeriod', { period: r.period }),
      steps: [s('steps.lfsr')],
    };
  }
  if (!/[A-Za-z]/.test(text)) return fail('noLetters');
  if (kind === 'frequency') {
    const counts = letterCounts(text);
    return {
      ok: true,
      answer: s('freqAnswer', {
        top: counts
          .slice(0, 5)
          .map((c) => c.letter)
          .join(', '),
      }),
      note: s('freqHint'),
      tables: [
        {
          caption: s('table.frequency'),
          header: [s('table.letter'), s('table.count'), s('table.share')],
          rows: counts.map((c) => [c.letter, String(c.count), `${num(c.share * 100, 3)}%`]),
        },
      ],
    };
  }
  let out: string;
  if (kind === 'caesar') out = caesar(text, smallOf(v, 'shift', 1000), back);
  else if (kind === 'affine') out = affine(text, smallOf(v, 'mult', 1000), smallOf(v, 'add', 1000), back);
  else if (kind === 'vigenere') out = vigenere(text, v.key ?? '', back);
  else if (kind === 'substitution') out = substitution(text, v.alphabet ?? '', back);
  else {
    const m = matrix(v.matrix ?? '');
    if (!m) return fail('matrixField', { field: s('fields.matrix') });
    out = hill(text, m, back);
  }
  return {
    ok: true,
    answer: s(back ? 'plainAnswer' : 'cipherAnswer', { text: out }),
    note: s('toyOnly'),
    steps: [s(`steps.${kind}`)],
  };
}

export const CIPHER: Mode = {
  id: 'cipher',
  fields: (v) => [
    {
      id: 'kind',
      kind: 'select',
      options: ['vigenere', 'caesar', 'affine', 'substitution', 'hill', 'frequency', 'lfsr'],
    },
    ...(v.kind === 'lfsr'
      ? []
      : [
          f('text', 'ATTACKATDAWN', { kind: 'area', rows: 3 }),
          ...(v.kind === 'frequency'
            ? []
            : [{ id: 'direction', kind: 'select' as const, options: ['encrypt', 'decrypt'] }]),
        ]),
    ...(CIPHER_FIELDS[v.kind ?? 'vigenere'] ?? CIPHER_FIELDS.vigenere),
  ],
  solve: solveWith(cipherOutcome),
};

// Public-key systems.

const PUBLIC_FIELDS: Record<string, Field[]> = {
  rsa: [f('p', '61'), f('q', '53'), f('e', '17'), f('message', '65')],
  dh: [f('prime', '23'), f('g', '5'), f('secretA', '6'), f('secretB', '15')],
  elgamal: [f('prime', '23'), f('g', '5'), f('secretA', '6'), f('ephemeral', '3'), f('message', '10')],
};

function publicOutcome(v: Values): Outcome {
  if (v.kind === 'dh') {
    const r = diffieHellman(bigOf(v, 'prime'), bigOf(v, 'g'), bigOf(v, 'secretA'), bigOf(v, 'secretB'));
    return {
      ok: true,
      answer: s('dhAnswer', { key: String(r.key) }),
      note: s('toyOnly'),
      steps: [
        s('steps.dhA', { A: String(r.A) }),
        s('steps.dhB', { B: String(r.B) }),
        s('steps.dhKey', { key: String(r.key) }),
      ],
    };
  }
  if (v.kind === 'elgamal') {
    const r = elGamal(
      bigOf(v, 'prime'),
      bigOf(v, 'g'),
      bigOf(v, 'secretA'),
      bigOf(v, 'ephemeral'),
      bigOf(v, 'message'),
    );
    return {
      ok: true,
      answer: s('elgamalAnswer', { c1: String(r.c1), c2: String(r.c2), back: String(r.back) }),
      note: s('toyOnly'),
      steps: [
        s('steps.elgamalKey', { h: String(r.h) }),
        s('steps.elgamalEncrypt', { c1: String(r.c1), c2: String(r.c2) }),
        s('steps.elgamalDecrypt', { back: String(r.back) }),
      ],
    };
  }
  const r = rsa(bigOf(v, 'p'), bigOf(v, 'q'), bigOf(v, 'e'), bigOf(v, 'message'));
  return {
    ok: true,
    answer: s('rsaAnswer', { n: String(r.n), d: String(r.d), c: String(r.c), back: String(r.back) }),
    latex: `c = m^{e} \\bmod n = ${r.c},\\quad m = c^{d} \\bmod n = ${r.back}`,
    note: s('toyOnly'),
    steps: [
      s('steps.rsaN', { n: String(r.n), phi: String(r.phi) }),
      s('steps.rsaD', { d: String(r.d) }),
      s('steps.rsaEncrypt', { c: String(r.c) }),
      s('steps.rsaSign', { sig: String(r.signature), ok: s(r.verified ? 'yes' : 'no') }),
    ],
  };
}

export const PUBLIC: Mode = {
  id: 'public',
  fields: (v) => [
    { id: 'kind', kind: 'select', options: ['rsa', 'dh', 'elgamal'] },
    ...(PUBLIC_FIELDS[v.kind ?? 'rsa'] ?? PUBLIC_FIELDS.rsa),
  ],
  solve: solveWith(publicOutcome),
};

// Permutations.

function permOutcome(v: Values): Outcome {
  const p = parseCycles(v.perm ?? '');
  const qText = (v.other ?? '').trim();
  const q = qText ? parseCycles(qText, p.length) : null;
  const n = Math.max(p.length, q?.length ?? 0);
  const pad = (x: number[]) => [...x, ...Array.from({ length: n - x.length }, (_, i) => x.length + i)];
  const P = pad(p);
  const rows: string[][] = [
    [s('row.cycles'), cycleText(P)],
    [s('row.permOrder'), String(permOrder(P))],
    [s('row.sign'), s(permSign(P) === 1 ? 'even' : 'odd')],
    [s('row.type'), cycleType(P).join(', ')],
    [s('row.inverse'), cycleText(inversePerm(P))],
    [s('row.classSize', { n }), String(classSize(P))],
  ];
  if (q) {
    const Q = pad(q);
    rows.push([s('row.pq'), cycleText(compose(P, Q))], [s('row.qp'), cycleText(compose(Q, P))]);
  }
  return {
    ok: true,
    answer: s('permAnswer', { p: cycleText(P), order: permOrder(P), sign: s(permSign(P) === 1 ? 'even' : 'odd') }),
    steps: [s('steps.permOrder'), s('steps.permSign')],
    tables: [
      { caption: s('table.perm'), header: [s('table.measure'), s('table.value')], rows },
      {
        caption: s('table.twoLine'),
        header: ['x', ...P.map((_, i) => String(i + 1))],
        rows: [['p(x)', ...P.map((y) => String(y + 1))]],
      },
    ],
  };
}

export const PERM: Mode = {
  id: 'perm',
  fields: [f('perm', '(1 2 3)(4 5)', { help: true }), f('other', '', { help: true })],
  solve: solveWith(permOutcome),
};

// Groups.

const subName = (g: Group, h: number[]) =>
  h.length === g.names.length
    ? 'G'
    : h.length <= 4
      ? `{${h.map((i) => g.names[i]).join(', ')}}`
      : s('orderLabel', { k: h.length });

function groupOutcome(v: Values): Outcome {
  const family = (v.family ?? 'dihedral') as Family | 'table';
  const g = family === 'table' ? parseCayley(v.table ?? '') : makeGroup(family, smallOf(v, 'n', 1000));
  const order = g.names.length;
  const tables: Table[] = [
    {
      caption: s('table.orders'),
      header: [s('table.element'), s('table.order'), s('table.inverse')],
      rows: g.names.map((name, a) => [name, String(elementOrder(g, a)), g.names[g.mul[a].indexOf(g.e)]]),
    },
  ];
  if (order <= 16)
    tables.push({
      caption: s('table.cayley'),
      header: ['·', ...g.names],
      rows: g.mul.map((r, a) => [g.names[a], ...r.map((x) => g.names[x])]),
    });
  const subs = order <= 120 ? subgroups(g) : [];
  const normal = subs.map((h) => isNormal(g, h));
  tables.push({
    caption: s('table.subgroups', { count: subs.length }),
    header: [s('table.order'), s('table.elements'), s('table.normal'), s('table.index')],
    rows: subs.map((h, i) => [
      String(h.length),
      h.length <= 12 ? h.map((x) => g.names[x]).join(', ') : s('orderLabel', { k: h.length }),
      normal[i] ? s('yes') : '',
      String(order / h.length),
    ]),
  });
  const notes: string[] = [];
  const genText = (v.generators ?? '').trim();
  if (genText) {
    const gens = genText
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
    const idx = gens.map((x) => {
      const k = g.names.indexOf(x);
      if (k < 0) fail('element', { name: x });
      return k;
    });
    const h = generate(g, idx);
    const cosets = leftCosets(g, h);
    notes.push(
      s('generated', { gens: gens.join(', '), order: h.length, normal: s(isNormal(g, h) ? 'isNormal' : 'notNormal') }),
    );
    tables.push({
      caption: s('table.cosets', { count: cosets.length }),
      header: [s('table.coset'), s('table.elements')],
      rows: cosets.map((c) => [`${g.names[c[0]]}H`, c.map((x) => g.names[x]).join(', ')]),
    });
  }
  const z = center(g);
  const figure =
    subs.length > 1 && subs.length <= 40
      ? {
          svg: hasseFigure(
            subs.map((h, i) => ({
              label: subName(g, h),
              rank: h.length,
              tone: normal[i] ? ('accent' as const) : undefined,
            })),
            lattice(subs),
          ),
          alt: s('latticeAlt', { count: subs.length }),
        }
      : undefined;
  if (subs.length > 40) notes.push(s('latticeLarge', { count: subs.length }));
  return {
    ok: true,
    answer: s('groupAnswer', {
      order,
      abelian: s(isAbelian(g) ? 'abelian' : 'nonabelian'),
      center: z.length <= 12 ? z.map((i) => g.names[i]).join(', ') : s('orderLabel', { k: z.length }),
      subs: subs.length,
    }),
    note: notes.join('\n') || undefined,
    steps: [s('steps.groupOrders'), s('steps.groupSubgroups'), s('steps.groupNormal')],
    tables,
    ...(figure ? { figure } : {}),
  };
}

export const GROUP: Mode = {
  id: 'group',
  fields: (v) => [
    {
      id: 'family',
      kind: 'select',
      options: ['dihedral', 'cyclic', 'units', 'symmetric', 'alternating', 'quaternion', 'table'],
    },
    ...(v.family === 'table'
      ? [f('table', 'e a b\ne a b\na b e\nb e a', { kind: 'area', rows: 5, help: true })]
      : v.family === 'quaternion'
        ? []
        : [f('n', '4')]),
    f('generators', '', { help: true }),
  ],
  solve: solveWith(groupOutcome),
};

// Rings and fields.

function fieldOutcome(v: Values): Outcome {
  if (v.kind === 'ring') {
    const n = smallOf(v, 'n', 10000);
    const r = ringZn(n);
    const list = (xs: number[]) =>
      xs.length > 40 ? s('manyElements', { count: xs.length }) : xs.join(', ') || s('none');
    return {
      ok: true,
      answer: s('ringAnswer', {
        n,
        units: r.units.length,
        field: s(r.zeroDivisors.length ? 'ringNotField' : 'ringField'),
      }),
      tables: [
        {
          caption: s('table.ring', { n }),
          header: [s('table.kind'), s('table.elements')],
          rows: [
            [s('row.units'), list(r.units)],
            [s('row.zeroDivisors'), list(r.zeroDivisors)],
            [s('row.nilpotent'), list(r.nilpotent)],
            [s('row.idempotent'), list(r.idempotent)],
          ],
        },
      ],
    };
  }
  const p = smallOf(v, 'p', 1000);
  const F = makeField(p, v.modulus ?? '');
  const a = parsePoly(v.first ?? '', p);
  const b = parsePoly(v.second ?? '', p);
  const reduce = (x: number[]) => fieldMul(F, x, [1]);
  const inv = (x: number[]) => {
    const r = fieldInverse(F, x);
    return r ? polyText(r) : s('none');
  };
  const powers = powersOfX(F);
  const name = `GF(${p}^${F.n})`;
  const rows: string[][] = [
    ['a + b', polyText(reduce(polyAdd(a, b, p)))],
    ['a · b', polyText(fieldMul(F, a, b))],
    ['a⁻¹', inv(a)],
    ['b⁻¹', inv(b)],
    ['a^2', polyText(fieldPow(F, a, 2))],
  ];
  return {
    ok: true,
    answer: s('fieldProduct', { a: polyText(a), b: polyText(b), product: polyText(fieldMul(F, a, b)) }),
    note: F.field
      ? s(powers.primitive ? 'fieldPrimitive' : 'fieldNotPrimitive', { name, size: F.size })
      : s('fieldReducible', { f: polyText(F.f) }),
    steps: [s('steps.fieldReduce', { f: polyText(F.f) })],
    tables: [
      { caption: s('table.field', { name }), header: [s('table.operation'), s('table.value')], rows },
      {
        caption: s('table.powers'),
        header: ['k', 'x^k'],
        rows: powers.powers.slice(0, 64).map((x, k) => [String(k), polyText(x)]),
      },
    ],
  };
}

export const FIELD: Mode = {
  id: 'field',
  fields: (v) => [
    { id: 'kind', kind: 'select', options: ['field', 'ring'] },
    ...(v.kind === 'ring'
      ? [f('n', '12')]
      : [f('p', '2'), f('modulus', 'x^3 + x + 1', { help: true }), f('first', 'x'), f('second', 'x^2')]),
  ],
  solve: solveWith(fieldOutcome),
};

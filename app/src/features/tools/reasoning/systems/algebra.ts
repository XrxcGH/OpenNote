// Relational algebra on small tables typed in the box. A table is a header line `Name(a, b, c)` and then a row per
// line; numbers compare as numbers and other values as text.
// Expressions use the words select, project, rename, join, cross, union, minus, and intersect, as in
// project[a, b](select[a > 1](E join F)).
// Conditions compare an attribute with a value or another attribute (=, !=, <, <=, >, >=) joined by and, or, not.
// Results are sets: duplicate rows are dropped, as in the algebra.
import { fail } from '../core/util';

export type Value = number | string;

export interface Relation {
  name: string;
  attrs: string[];
  rows: Value[][];
}

const MAX_ROWS = 5000;

const valueOf = (raw: string): Value => {
  const t = raw.trim().replace(/^'(.*)'$|^"(.*)"$/, '$1$2');
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : t;
};

export function parseTables(text: string): Map<string, Relation> {
  const out = new Map<string, Relation>();
  let cur: Relation | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const head = /^([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:?$/.exec(l);
    if (head) {
      const attrs = head[2]
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      if (!attrs.length || new Set(attrs).size !== attrs.length) fail('tableHeader', { line: l });
      cur = { name: head[1], attrs, rows: [] };
      out.set(head[1].toLowerCase(), cur);
      continue;
    }
    if (!cur) return fail('rowBeforeHeader', { line: l });
    const cells = l.split(',').map(valueOf);
    if (cells.length !== cur.attrs.length) fail('rowWidth', { line: l, table: cur.name, count: cur.attrs.length });
    cur.rows.push(cells);
  }
  if (!out.size) fail('noTables');
  return out;
}

type Tok = { k: 'word' | 'punct' | 'value'; v: string };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /\s*(?:('(?:[^']*)'|"(?:[^"]*)")|(<=|>=|!=|<>|->|[()[\],=<>])|([A-Za-z_σπρ][\w.]*)|([+-]?(?:\d+\.?\d*|\.\d+)))/y;
  let at = 0;
  const src = text.trim();
  while (at < src.length) {
    re.lastIndex = at;
    const m = re.exec(src);
    if (!m) return fail('exprAt', { at: src.slice(at, at + 12) });
    at = re.lastIndex;
    if (m[1]) out.push({ k: 'value', v: m[1].slice(1, -1) });
    else if (m[2]) out.push({ k: 'punct', v: m[2] === '<>' ? '!=' : m[2] });
    else if (m[3]) out.push({ k: 'word', v: m[3] });
    else out.push({ k: 'value', v: m[4] });
  }
  return out;
}

type Cond = (row: readonly Value[], attrs: readonly string[]) => boolean;

const BINARY = ['join', 'cross', 'union', 'minus', 'intersect'] as const;

export function evaluate(
  expr: string,
  tables: ReadonlyMap<string, Relation>,
): { result: Relation; log: { op: string; rows: number }[] } {
  const ts = tokens(expr);
  if (!ts.length) fail('noExpr');
  let i = 0;
  const log: { op: string; rows: number }[] = [];
  const peek = () => ts[i];
  const take = (v?: string): Tok => {
    const t = ts[i];
    if (!t || (v !== undefined && t.v.toLowerCase() !== v))
      fail(t ? 'exprExpected' : 'exprEnded', { what: v ?? '', at: t?.v ?? '' });
    i += 1;
    return t;
  };
  const col = (attrs: readonly string[], name: string): number => {
    const k = attrs.indexOf(name);
    return k >= 0 ? k : fail('noAttribute', { name, attrs: attrs.join(', ') });
  };
  const list = (): string[] => {
    const out: string[] = [];
    take('[');
    for (;;) {
      out.push(take().v);
      if (peek()?.v === ']') break;
      take(',');
    }
    take(']');
    return out;
  };
  const cmp = (a: Value, op: string, b: Value): boolean => {
    const x = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return op === '='
      ? x === 0
      : op === '!='
        ? x !== 0
        : op === '<'
          ? x < 0
          : op === '<='
            ? x <= 0
            : op === '>'
              ? x > 0
              : x >= 0;
  };
  const operand = (): ((row: readonly Value[], attrs: readonly string[]) => Value) => {
    const t = take();
    if (t.k === 'value') {
      const v = valueOf(t.v);
      return () => v;
    }
    return (row, attrs) => row[col(attrs, t.v)];
  };
  const atom = (): Cond => {
    if (peek()?.v.toLowerCase() === 'not') {
      take();
      const c = atom();
      return (r, a) => !c(r, a);
    }
    if (peek()?.v === '(') {
      take('(');
      const c = disj();
      take(')');
      return c;
    }
    const a = operand();
    const op = take().v;
    if (!['=', '!=', '<', '<=', '>', '>='].includes(op)) fail('exprExpected', { what: '=, <, >', at: op });
    const b = operand();
    return (r, at) => cmp(a(r, at), op, b(r, at));
  };
  const conj = (): Cond => {
    let c = atom();
    while (peek()?.v.toLowerCase() === 'and') {
      take();
      const [l, r] = [c, atom()];
      c = (x, a) => l(x, a) && r(x, a);
    }
    return c;
  };
  const disj = (): Cond => {
    let c = conj();
    while (peek()?.v.toLowerCase() === 'or') {
      take();
      const [l, r] = [c, conj()];
      c = (x, a) => l(x, a) || r(x, a);
    }
    return c;
  };
  const distinct = (rel: Relation): Relation => {
    const seen = new Set<string>();
    const rows = rel.rows.filter((r) => {
      const k = JSON.stringify(r);
      return seen.has(k) ? false : (seen.add(k), true);
    });
    if (rows.length > MAX_ROWS) fail('resultLarge', { max: MAX_ROWS });
    return { ...rel, rows };
  };
  const note = (rel: Relation, what: string): Relation => {
    log.push({ op: what, rows: rel.rows.length });
    return rel;
  };
  const sameShape = (a: Relation, b: Relation) => {
    if (a.attrs.length !== b.attrs.length || a.attrs.some((x, k) => x !== b.attrs[k]))
      fail('notCompatible', { a: a.attrs.join(', '), b: b.attrs.join(', ') });
  };
  const primary = (): Relation => {
    const t = take();
    const word = t.v.toLowerCase();
    if (t.v === '(') {
      const r = binary();
      take(')');
      return r;
    }
    if (word === 'select' || word === 'σ') {
      take('[');
      const c = disj();
      take(']');
      take('(');
      const r = binary();
      take(')');
      return note(distinct({ ...r, rows: r.rows.filter((row) => c(row, r.attrs)) }), 'select');
    }
    if (word === 'project' || word === 'π') {
      const names = list();
      take('(');
      const r = binary();
      take(')');
      const idx = names.map((n) => col(r.attrs, n));
      return note(
        distinct({ name: r.name, attrs: names, rows: r.rows.map((row) => idx.map((k) => row[k])) }),
        'project',
      );
    }
    if (word === 'rename' || word === 'ρ') {
      take('[');
      const pairs: [string, string][] = [];
      for (;;) {
        const from = take().v;
        take('->');
        pairs.push([from, take().v]);
        if (peek()?.v === ']') break;
        take(',');
      }
      take(']');
      take('(');
      const r = binary();
      take(')');
      const attrs = [...r.attrs];
      for (const [from, to] of pairs) attrs[col(r.attrs, from)] = to;
      if (new Set(attrs).size !== attrs.length) fail('renameClash');
      return { ...r, attrs };
    }
    const rel = tables.get(word);
    if (!rel) return fail('noTable', { name: t.v, tables: [...tables.values()].map((x) => x.name).join(', ') });
    return { ...rel, rows: rel.rows.map((r) => [...r]) };
  };
  const binary = (): Relation => {
    let left = primary();
    for (
      let op = peek()?.v.toLowerCase();
      op && (BINARY as readonly string[]).includes(op);
      op = peek()?.v.toLowerCase()
    ) {
      take();
      const right = primary();
      if (op === 'join') {
        const shared = left.attrs.filter((a) => right.attrs.includes(a));
        const extra = right.attrs.filter((a) => !shared.includes(a));
        const rows: Value[][] = [];
        for (const a of left.rows)
          for (const b of right.rows)
            if (shared.every((s) => a[left.attrs.indexOf(s)] === b[right.attrs.indexOf(s)]))
              rows.push([...a, ...extra.map((x) => b[right.attrs.indexOf(x)])]);
        left = note(distinct({ name: left.name, attrs: [...left.attrs, ...extra], rows }), 'join');
      } else if (op === 'cross') {
        const clash = left.attrs.find((a) => right.attrs.includes(a));
        if (clash) fail('crossClash', { name: clash });
        if (left.rows.length * right.rows.length > MAX_ROWS) fail('resultLarge', { max: MAX_ROWS });
        const rows = left.rows.flatMap((a) => right.rows.map((b) => [...a, ...b]));
        left = note(distinct({ name: left.name, attrs: [...left.attrs, ...right.attrs], rows }), 'cross');
      } else {
        sameShape(left, right);
        const keys = new Set(right.rows.map((r) => JSON.stringify(r)));
        const rows =
          op === 'union'
            ? [...left.rows, ...right.rows]
            : left.rows.filter((r) => keys.has(JSON.stringify(r)) === (op === 'intersect'));
        left = note(distinct({ ...left, rows }), op);
      }
    }
    return left;
  };
  const result = distinct(binary());
  if (i < ts.length) fail('exprTrailing', { at: ts[i].v });
  return { result, log };
}

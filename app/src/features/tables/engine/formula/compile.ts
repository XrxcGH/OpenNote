// Compiles a syntax tree into a closure over the page's column arrays, and records which cells it reads. Nothing here
// uses eval or source text, so the app's Content Security Policy stays free of unsafe-eval.
//
// Every formula evaluates to a value (ADR 0059): a scalar, an array, or a function made by LAMBDA. References are
// read where a value is needed. A reference to more than one cell becomes an array, which the engine spills.
// Operators and scalar functions broadcast over arrays. References are compiled in refs.ts, library calls in
// calls.ts, and IF, IFERROR, LET, LAMBDA, and ISOMITTED in special.ts.

import type { Node } from '../../../../core/expr';
import { err, errorFromToken, isArray, isError, isLambda, nearZero, type Scalar, type Value } from '../values';
import { makeArray, map1, map2 } from '../arrays';
import type { Box } from '../graph';
import { REGISTRY, type FnSpec2 } from './fn';
import { applyBinary, applyNegate, applyPercent, applySqrt } from './operators';
import type { ErrorOrigin } from './explain';
import { callValue, compileSpecial, ENGINE_FORMS, readLocal } from './special';
import type { TableName } from '../model';
import { compileCallRef, compileLibrary } from './calls';
import { compileRef, headers, implicit, thisRowValue } from './refs';
import {
  constant,
  isBad,
  readBox,
  type Compiled,
  type Ctx,
  type Fn,
  type Host,
  type Owner,
  type RefPart,
  type Scope,
  type SheetInfo,
} from './context';

export { colKey, newCtx, readBox } from './context';
export type { Compiled, Ctx, Fn, Owner, Runtime, Scope, SheetInfo } from './context';

const isMany = (v: Value): boolean => typeof v === 'object' && v !== null && 'kind' in v;

class Compiler implements Host {
  readonly reads: Box[] = [];
  volatile = false;
  dynamic = false;
  sheet: number;
  readonly ownSheet: number;
  readonly book: readonly SheetInfo[];
  private readonly frames: Map<string, number>[] = [];
  private readonly named = new Map<string, { fn: Fn | null; ref: RefPart | null }>();
  private readonly byName: Map<string, number>[] = [];
  private readonly byId: Map<string, number>[] = [];

  constructor(
    readonly scope: Scope,
    readonly owner: Owner,
  ) {
    this.ownSheet = scope.sheet ?? 0;
    this.sheet = this.ownSheet;
    this.book = scope.book ?? [{ name: 'Table1', columns: scope.columns, rowCount: scope.rowCount }];
  }

  columnIndex(s: number, by: 'name' | 'id', key: string): number {
    const maps = by === 'id' ? this.byId : this.byName;
    let map = maps[s];
    if (map === undefined) {
      const made = new Map<string, number>();
      this.book[s].columns.forEach((c, i) => {
        const k = by === 'id' ? c.id : c.name.trim().toLowerCase();
        if (!made.has(k)) made.set(k, i);
      });
      maps[s] = map = made;
    }
    return map.get(by === 'id' ? key : key.trim().toLowerCase()) ?? -1;
  }

  sheetNamed(name: string): number {
    const want = name.trim().toLowerCase();
    return this.book.findIndex((info) => info.name.toLowerCase() === want);
  }

  read(box: Box): void {
    this.reads.push(box);
  }

  lookup(name: string): FnSpec2 | undefined {
    return this.scope.functions?.get(name) ?? REGISTRY.get(name);
  }

  // Values.

  value(node: Node): Fn {
    switch (node.type) {
      case 'num':
      case 'str':
      case 'bool':
        return constant(node.value);
      case 'col':
        return this.columnValue(this.sheet, node.by, node.key);
      case 'cell':
        return this.cellValue(this.sheet, node.col, node.row);
      case 'unary':
        return this.unary(node);
      case 'postfix':
        return node.op === '%' ? this.lift(node.arg, applyPercent) : constant(err('VALUE'));
      case 'binary':
        return this.binary(node, false);
      case 'call':
        return this.call(node);
      case 'name':
        return this.nameValue(node);
      case 'array':
        return arrayConstant(node);
      case 'struct':
        if (node.items.includes('#Headers') && node.col1 !== undefined) return headers(this, node);
        return node.thisRow ? thisRowValue(this, node) : this.deref(compileRef(this, node));
      case 'range':
      case 'spill':
      case 'qualified':
      case 'refop':
        return this.deref(compileRef(this, node));
      default:
        return constant(err('VALUE'));
    }
  }

  cellValue(s: number, col: number, row: number): Fn {
    const info = this.book[s];
    if (col >= info.columns.length || row >= info.rowCount) return constant(err('REF'));
    this.read({ s, r1: row, c1: col, r2: row, c2: col });
    const cell = { table: s, col, row };
    const note = (ctx: Ctx, v: Value): Value => {
      if (ctx.origin === null && isError(v)) ctx.origin = { code: v.error, kind: 'cell', cell };
      return v;
    };
    if (s === this.ownSheet) {
      return (ctx) => {
        const v = ctx.cols[col][row];
        return typeof v === 'object' && v !== null ? note(ctx, v) : v;
      };
    }
    return (ctx) => {
      const v = ctx.sheets[s][col][row];
      return typeof v === 'object' && v !== null ? note(ctx, v) : v;
    };
  }

  /** [Col]: this row's value in a calculated column or a cell formula. */
  private columnValue(s: number, by: 'name' | 'id', key: string): Fn {
    const i = this.columnIndex(s, by, key);
    if (i < 0) return constant(err('REF'));
    const row = this.owner.row;
    if (row !== null) return this.cellValue(s, i, row);
    this.read({ s, r1: 0, c1: i, r2: Infinity, c2: i });
    if (s === this.ownSheet) return (ctx) => ctx.cols[i][ctx.row];
    return (ctx) => ctx.sheets[s][i][ctx.row] ?? null;
  }

  private unary(node: Extract<Node, { type: 'unary' }>): Fn {
    switch (node.op) {
      case '-':
        return this.lift(node.arg, applyNegate);
      case '√':
        return this.lift(node.arg, applySqrt);
      case '@':
        return implicit(this, node.arg);
      default:
        return this.value(node.arg);
    }
  }

  private lift(arg: Node, f: (v: Value) => Value): Fn {
    const a = this.value(arg);
    return (ctx) => {
      const v = a(ctx);
      if (isArray(v)) return map1(v, f);
      return isLambda(v) ? err('CALC') : f(v);
    };
  }

  binary(node: Extract<Node, { type: 'binary' }>, final: boolean): Fn {
    const l = this.value(node.left);
    const r = this.value(node.right);
    const op = node.op;
    const origin: ErrorOrigin = { code: 'VALUE', kind: 'operator', name: op, start: node.start, end: node.end };
    return (ctx) => {
      const a = l(ctx);
      const b = r(ctx);
      let v: Value;
      if (typeof a === 'number' && typeof b === 'number' && (op === '+' || op === '-' || op === '*')) {
        // The common case, without the general coercion: the same results as applyBinary.
        const n = op === '*' ? a * b : final ? nearZero(a, op === '+' ? b : -b) : op === '+' ? a + b : a - b;
        v = Number.isFinite(n) ? n : err('NUM');
      } else if (isMany(a) || isMany(b)) {
        if (isLambda(a) || isLambda(b)) return err('CALC');
        v = map2(a, b, (x, y) => applyBinary(op, x, y));
      } else v = applyBinary(op, a, b, final);
      if (ctx.origin === null && isError(v) && !isError(a) && !isError(b)) ctx.origin = { ...origin, code: v.error };
      return v;
    };
  }

  deref(ref: RefPart): Fn {
    return (ctx) => {
      const box = ref.fn(ctx);
      if (isBad(box)) return box;
      if (Array.isArray(box)) return err('VALUE');
      const v = readBox(ctx, box);
      if (ctx.origin === null && isError(v)) {
        ctx.origin = { code: v.error, kind: 'cell', cell: { table: box.s, col: box.c1, row: box.r1 } };
      }
      return v;
    };
  }

  /** The node as a reference, or null when it is not one. */
  refOrNull(node: Node): RefPart | null {
    switch (node.type) {
      case 'cell':
      case 'range':
      case 'col':
      case 'struct':
      case 'qualified':
      case 'spill':
      case 'refop':
        return compileRef(this, node);
      case 'name':
        return this.nameRef(node);
      case 'call': {
        if (node.callee !== undefined || ENGINE_FORMS.has(node.name) || this.local(node.name)) return null;
        return compileCallRef(this, this.lookup(node.name), node);
      }
      default:
        return null;
    }
  }

  // Names.

  local(name: string): { hops: number; slot: number } | null {
    const key = name.toUpperCase();
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const slot = this.frames[i].get(key);
      if (slot !== undefined) return { hops: this.frames.length - 1 - i, slot };
    }
    return null;
  }

  /** The defined name visible from the current table: its own table's names, then page names in table order. */
  private definedName(name: string): { s: number; def: TableName } | null {
    const want = name.toLowerCase();
    const own = this.book[this.sheet].names?.find(
      (n) => (n.scope ?? 'table') === 'table' && n.name.toLowerCase() === want,
    );
    if (own) return { s: this.sheet, def: own };
    for (let s = 0; s < this.book.length; s++) {
      const def = this.book[s].names?.find((n) => n.scope === 'page' && n.name.toLowerCase() === want);
      if (def) return { s, def };
    }
    return null;
  }

  /** Compiles a defined name once per formula. A name that uses itself, as a recursive LAMBDA does, reads late. */
  private namedEntry(name: string): { fn: Fn | null; ref: RefPart | null } | null {
    const found = this.definedName(name);
    if (found === null) return null;
    const key = `${found.s}:${found.def.name.toLowerCase()}`;
    const known = this.named.get(key);
    if (known) return known;
    const entry: { fn: Fn | null; ref: RefPart | null } = { fn: null, ref: null };
    this.named.set(key, entry);
    const node = this.scope.parse?.(found.def.ref) ?? null;
    if (node === null) {
      entry.fn = constant(err('NAME'));
      return entry;
    }
    const saved = { sheet: this.sheet, frames: this.frames.splice(0) };
    this.sheet = found.s;
    try {
      entry.ref = this.refOrNull(node);
      entry.fn = entry.ref ? this.deref(entry.ref) : this.value(node);
    } finally {
      this.sheet = saved.sheet;
      this.frames.push(...saved.frames);
    }
    return entry;
  }

  private unknown(node: { name: string; start: number; end: number }): Fn {
    const origin: ErrorOrigin = { code: 'NAME', kind: 'name', name: node.name, start: node.start, end: node.end };
    return (ctx) => {
      if (ctx.origin === null) ctx.origin = origin;
      return err('NAME');
    };
  }

  private nameValue(node: Extract<Node, { type: 'name' }>): Fn {
    if (node.name.startsWith('#')) return constant(errorFromToken(node.name) ?? err('NAME'));
    const local = this.local(node.name);
    if (local) return readLocal<Ctx>(local.hops, local.slot);
    const entry = this.namedEntry(node.name);
    if (entry) return entry.fn ?? ((ctx) => (entry.fn ? entry.fn(ctx) : err('NAME')));
    if (this.columnIndex(this.sheet, 'name', node.name) >= 0) return this.columnValue(this.sheet, 'name', node.name);
    return this.unknown(node);
  }

  private nameRef(node: Extract<Node, { type: 'name' }>): RefPart | null {
    if (node.name.startsWith('#') || this.local(node.name)) return null;
    const entry = this.namedEntry(node.name);
    if (entry) return entry.ref;
    if (this.columnIndex(this.sheet, 'name', node.name) < 0) return null;
    return compileRef(this, { ...node, type: 'col', by: 'name', key: node.name });
  }

  // Calls.

  private call(node: Extract<Node, { type: 'call' }>): Fn {
    if (node.callee !== undefined) return this.callOf(this.value(node.callee), node.args);
    const special = ENGINE_FORMS.has(node.name) ? compileSpecial<Ctx>(node.name, node.args, this.host) : null;
    if (special) return special;
    const local = this.local(node.name);
    if (local) return this.callOf(readLocal<Ctx>(local.hops, local.slot), node.args);
    const spec = this.lookup(node.name);
    if (spec) return compileLibrary(this, spec, node);
    const entry = this.namedEntry(node.name);
    if (entry) return this.callOf((ctx) => (entry.fn ? entry.fn(ctx) : err('NAME')), node.args);
    return this.unknown(node);
  }

  private callOf(callee: Fn, args: readonly Node[]): Fn {
    const parts = args.map((a) => this.value(a));
    return (ctx) => {
      const f = callee(ctx);
      return callValue(
        f,
        parts.map((p) => p(ctx)),
      );
    };
  }

  private readonly host = {
    value: (node: Node): Fn => this.value(node),
    pushFrame: (): void => {
      this.frames.push(new Map());
    },
    addName: (name: string): number => {
      const frame = this.frames[this.frames.length - 1];
      frame.set(name.toUpperCase(), frame.size);
      return frame.size - 1;
    },
    popFrame: (): void => {
      this.frames.pop();
    },
    local: (name: string) => this.local(name),
  };
}

function arrayConstant(node: Extract<Node, { type: 'array' }>): Fn {
  const data: Scalar[] = [];
  for (const item of node.items) {
    if (item.type === 'num' || item.type === 'str' || item.type === 'bool') data.push(item.value);
    else if (item.type === 'unary' && item.op === '-' && item.arg.type === 'num') data.push(-item.arg.value);
    else if (item.type === 'name' && item.name.startsWith('#')) data.push(errorFromToken(item.name) ?? err('VALUE'));
    else return constant(err('VALUE'));
  }
  return constant(makeArray(node.rows, node.cols, data));
}

/** Compiles one formula for the cell or column that owns it. */
export function compile(node: Node, scope: Scope, owner: Owner): Compiled {
  const compiler = new Compiler(scope, owner);
  // The formula's last operation adds or subtracts, where Excel sets a result within rounding error to 0.
  const final = node.type === 'binary' && (node.op === '+' || node.op === '-');
  const fn = final ? compiler.binary(node, true) : compiler.value(node);
  return { fn, reads: compiler.reads, volatile: compiler.volatile, dynamic: compiler.dynamic };
}

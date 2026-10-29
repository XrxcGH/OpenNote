// Compiles a syntax tree into a closure over typed column arrays, and records which cells it reads. Nothing here
// uses eval or source text, so the app's Content Security Policy stays free of unsafe-eval.

import { err, isError, parseCanonicalNumber, toBool, type Value } from '../values';
import type { Node } from '../../../../core/expr';
import { FUNCTIONS, SPECIAL_FORMS, type Env, type FnSpec } from './functions';
import { applyBinary, applyNegate, applyPercent, applySqrt } from './operators';

export interface Scope {
  columns: readonly { id: string; name: string }[];
  rowCount: number;
  env: Env;
}

/** What a closure reads: the current value of every column, the row being calculated, and a pass counter. */
export interface Ctx {
  cols: Value[][];
  row: number;
  epoch: number;
}

export type Fn = (ctx: Ctx) => Value;
type ListFn = (ctx: Ctx) => Value[];

/** Rows `from` to `to` of a column. A whole column is 0 to Infinity. */
export interface Dep {
  col: number;
  from: number;
  to: number;
}

/** The cell or column a formula belongs to. A row of null means a calculated column, run on every row. */
export interface Owner {
  col: number;
  row: number | null;
}

export interface Compiled {
  fn: Fn;
  deps: Dep[];
}

interface Part {
  fn: Fn;
  rowDep: boolean;
}

const constant = (value: Value): Part => ({ fn: () => value, rowDep: false });

/** An argument written directly in an aggregate counts as a number: TRUE is 1, and other text is an error. */
function direct(value: Value): Value[] {
  if (value === null) return [];
  if (typeof value === 'boolean') return [value ? 1 : 0];
  if (typeof value === 'string') return [parseCanonicalNumber(value) ?? err('VALUE')];
  return [value];
}

class Compiler {
  readonly deps: Dep[] = [];
  private readonly byId = new Map<string, number>();
  private readonly byName = new Map<string, number>();

  constructor(
    private readonly scope: Scope,
    private readonly owner: Owner,
  ) {
    scope.columns.forEach((c, i) => {
      if (!this.byId.has(c.id)) this.byId.set(c.id, i);
      const name = c.name.trim().toLowerCase();
      if (!this.byName.has(name)) this.byName.set(name, i);
    });
  }

  private index(node: Extract<Node, { type: 'col' }>): number {
    return (node.by === 'id' ? this.byId.get(node.key) : this.byName.get(node.key.trim().toLowerCase())) ?? -1;
  }

  private depend(col: number, from: number, to: number): void {
    if (!this.deps.some((d) => d.col === col && d.from === from && d.to === to)) this.deps.push({ col, from, to });
  }

  scalar(node: Node): Part {
    switch (node.type) {
      case 'num':
      case 'str':
      case 'bool':
        return constant(node.value);
      case 'col':
        return this.column(node);
      case 'cell':
        return this.cell(node.col, node.row);
      case 'unary':
        return this.unary(node);
      case 'postfix':
        return node.op === '%' ? this.map(node.arg, applyPercent) : constant(err('VALUE'));
      case 'binary': {
        const [l, r] = [this.scalar(node.left), this.scalar(node.right)];
        return { fn: (ctx) => applyBinary(node.op, l.fn(ctx), r.fn(ctx)), rowDep: l.rowDep || r.rowDep };
      }
      case 'call':
        return this.call(node.name, node.args);
      default:
        return constant(err(node.type === 'name' ? 'NAME' : 'VALUE'));
    }
  }

  private unary(node: Extract<Node, { type: 'unary' }>): Part {
    if (node.op === '-') return this.map(node.arg, applyNegate);
    return node.op === '+' ? this.map(node.arg, (v) => v) : this.map(node.arg, applySqrt);
  }

  private map(arg: Node, f: (v: Value) => Value): Part {
    const a = this.scalar(arg);
    return { fn: (ctx) => f(a.fn(ctx)), rowDep: a.rowDep };
  }

  private column(node: Extract<Node, { type: 'col' }>): Part {
    const i = this.index(node);
    if (i < 0) return constant(err('REF'));
    const row = this.owner.row;
    this.depend(i, row ?? 0, row ?? Infinity);
    return { fn: (ctx) => ctx.cols[i][ctx.row], rowDep: true };
  }

  private cell(col: number, row: number): Part {
    if (col >= this.scope.columns.length || row >= this.scope.rowCount) return constant(err('REF'));
    this.depend(col, row, row);
    return { fn: (ctx) => ctx.cols[col][row], rowDep: false };
  }

  private call(name: string, args: readonly Node[]): Part {
    const form = SPECIAL_FORMS[name];
    const spec = FUNCTIONS[name];
    const limits = form ?? spec;
    if (!limits) return constant(err('NAME'));
    if (args.length < limits.min || args.length > limits.max) return constant(err('VALUE'));
    if (form) return this.special(name, args);
    return spec.kind === 'aggregate' ? this.aggregate(spec, args) : this.plain(spec, args);
  }

  private special(name: string, args: readonly Node[]): Part {
    const parts = args.map((a) => this.scalar(a));
    const rowDep = parts.some((p) => p.rowDep);
    if (name === 'IFERROR') {
      return {
        rowDep,
        fn: (ctx) => {
          const v = parts[0].fn(ctx);
          return isError(v) ? parts[1].fn(ctx) : v;
        },
      };
    }
    return {
      rowDep,
      fn: (ctx) => {
        const cond = parts[0].fn(ctx);
        const test = isError(cond) ? cond : toBool(cond);
        if (typeof test !== 'boolean') return test;
        return test ? parts[1].fn(ctx) : parts[2] ? parts[2].fn(ctx) : false;
      },
    };
  }

  private plain(spec: FnSpec, args: readonly Node[]): Part {
    const parts = args.map((a) => this.scalar(a));
    const values: Value[] = new Array(parts.length);
    const env = this.scope.env;
    return {
      rowDep: parts.some((p) => p.rowDep),
      fn: (ctx) => {
        for (let i = 0; i < parts.length; i++) {
          const v = parts[i].fn(ctx);
          if (isError(v) && !spec.handlesErrors) return v;
          values[i] = v;
        }
        return spec.run(values, env);
      },
    };
  }

  private aggregate(spec: FnSpec, args: readonly Node[]): Part {
    const lists = args.map((a) => this.list(a, spec));
    const env = this.scope.env;
    const compute: Fn = (ctx) => {
      if (lists.length === 1) return spec.run(lists[0].fn(ctx), env);
      const items: Value[] = [];
      for (const list of lists) for (const v of list.fn(ctx)) items.push(v);
      return spec.run(items, env);
    };
    const rowDep = lists.some((l) => l.rowDep);
    if (rowDep) return { fn: compute, rowDep };
    let epoch = -1;
    let cached: Value = null;
    return {
      rowDep,
      fn: (ctx) => {
        if (ctx.epoch !== epoch) {
          cached = compute(ctx);
          epoch = ctx.epoch;
        }
        return cached;
      },
    };
  }

  /** An aggregate's argument as a list: a column or range means every cell in it. */
  private list(node: Node, spec: FnSpec): { fn: ListFn; rowDep: boolean } {
    if (node.type === 'col') {
      const i = this.index(node);
      if (i < 0) return { fn: () => [err('REF')], rowDep: false };
      this.depend(i, 0, Infinity);
      return { fn: (ctx) => ctx.cols[i], rowDep: false };
    }
    if (node.type === 'range') return this.range(node);
    const part = this.scalar(node);
    const isRef = node.type === 'cell';
    return { fn: (ctx) => (isRef || spec.raw ? [part.fn(ctx)] : direct(part.fn(ctx))), rowDep: part.rowDep };
  }

  private range(node: Extract<Node, { type: 'range' }>): { fn: ListFn; rowDep: boolean } {
    const { col1, col2, row1 } = node;
    const row2 = Math.min(node.row2, this.scope.rowCount - 1);
    if (col2 >= this.scope.columns.length) return { fn: () => [err('REF')], rowDep: false };
    for (let c = col1; c <= col2; c++) this.depend(c, row1, row2);
    return {
      rowDep: false,
      fn: (ctx) => {
        const out: Value[] = [];
        for (let r = row1; r <= row2; r++) for (let c = col1; c <= col2; c++) out.push(ctx.cols[c][r]);
        return out;
      },
    };
  }
}

/** Compiles one formula for the cell or column that owns it. */
export function compile(node: Node, scope: Scope, owner: Owner): Compiled {
  const compiler = new Compiler(scope, owner);
  return { fn: compiler.scalar(node).fn, deps: compiler.deps };
}

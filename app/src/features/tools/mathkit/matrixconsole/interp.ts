// The console's interpreter: walks the parsed tree with variables that last for the whole session. It never runs
// text as JavaScript. A step and time limit stop a script that would run for ever, and a size limit stops one that
// would use all the memory.
import { KitError } from '../types';
import { registerA, type Table } from './builtinsA';
import { registerB } from './builtinsB';
import { registerC } from './builtinsC';
import { newFigure, type Builtin, type Ctx, type Figure } from './ctx';
import { formatValue } from './format';
import { parse, type Expr, type Stmt } from './lang';
import { binary, colonRange, negate, not, transpose, type Say } from './ops';
import {
  asMat,
  asNumber,
  assignIndex,
  empty,
  fromRows,
  indexValue,
  mat,
  numel,
  scalar,
  text,
  toRows,
  toSub,
  truthy,
  type M,
  type Sub,
  type Value,
} from './values';

export type Entry =
  | { kind: 'in'; text: string }
  | { kind: 'out'; lines: string[] }
  | { kind: 'err'; code: string; detail: string }
  | { kind: 'note'; key: string; vars: Record<string, string> }
  | { kind: 'plot'; figure: Figure }
  | { kind: 'clear' };

const STEP_LIMIT = 40_000_000;
const TIME_LIMIT_MS = 3000;
const DEPTH_LIMIT = 100;

const TABLE: Table = new Map();
registerA(TABLE);
registerB(TABLE);
registerC(TABLE);

type Signal = 'break' | 'continue' | null;
interface EndFrame {
  m: M;
  pos: number;
  count: number;
}

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Session {
  vars = new Map<string, Value>();
  figure: Figure = newFigure();
  explain = false;
  private hold = { on: false };
  private format = { long: false };
  private random = seededRandom(42);
  private steps = 0;
  private started = 0;
  private depth = 0;
  private entries: Entry[] = [];
  private ends: EndFrame[] = [];

  /** Runs a script. Every statement's output and any problem come back as entries; the variables stay. */
  run(source: string): Entry[] {
    this.entries = [{ kind: 'in', text: source }];
    this.steps = 0;
    this.started = performance.now();
    this.depth = 0;
    this.ends = [];
    this.figure.changed = false;
    try {
      this.exec(parse(source), this.vars);
    } catch (error) {
      this.entries.push(
        error instanceof KitError
          ? { kind: 'err', code: error.code, detail: error.detail }
          : { kind: 'err', code: 'unknown', detail: '' },
      );
    }
    if (this.figure.changed) this.entries.push({ kind: 'plot', figure: structuredClone(this.figure) });
    return this.entries;
  }

  reset(): void {
    this.vars.clear();
    this.figure = newFigure();
    this.hold.on = false;
    this.random = seededRandom(42);
  }

  private tick = (units = 1): void => {
    this.steps += units;
    if (this.steps > STEP_LIMIT) throw new KitError('mcStepLimit');
    if ((this.steps & 0xfff) < units && performance.now() - this.started > TIME_LIMIT_MS)
      throw new KitError('mcStepLimit');
  };

  private say: Say = (key, vars = {}) => {
    if (key.startsWith('warn')) this.entries.push({ kind: 'note', key, vars });
    else if (this.explain) this.entries.push({ kind: 'note', key, vars });
  };

  private ctx(): Ctx {
    return {
      say: this.say,
      print: (lines) => this.entries.push({ kind: 'out', lines }),
      figure: this.figure,
      hold: this.hold,
      format: this.format,
      call: (f, args, nargout = 1) => this.callValue(f, args, nargout),
      random: this.random,
      tick: this.tick,
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------------------------------------------

  private exec(body: Stmt[], scope: Map<string, Value>): Signal {
    for (const s of body) {
      this.tick();
      const signal = this.statement(s, scope);
      if (signal) return signal;
    }
    return null;
  }

  private statement(s: Stmt, scope: Map<string, Value>): Signal {
    switch (s.t) {
      case 'expr':
        this.expressionStatement(s.e, s.print, scope);
        return null;
      case 'assign':
        this.assignment(s, scope);
        return null;
      case 'if':
        return this.ifStatement(s, scope);
      case 'for':
        return this.forStatement(s, scope);
      case 'while':
        return this.whileStatement(s, scope);
      case 'break':
        return 'break';
      default:
        return 'continue';
    }
  }

  private ifStatement(s: Extract<Stmt, { t: 'if' }>, scope: Map<string, Value>): Signal {
    for (const branch of s.branches) {
      if (truthy(this.value(branch.cond, scope))) return this.exec(branch.body, scope);
    }
    return this.exec(s.otherwise, scope);
  }

  private forStatement(s: Extract<Stmt, { t: 'for' }>, scope: Map<string, Value>): Signal {
    const range = asMat(this.value(s.e, scope), 'for');
    const cols = range.r === 0 ? 0 : range.c;
    for (let j = 0; j < cols; j++) {
      this.tick();
      const column = mat(
        range.r,
        1,
        toRows(range).map((row) => row[j]),
      );
      scope.set(s.name, column);
      const signal = this.exec(s.body, scope);
      if (signal === 'break') break;
    }
    return null;
  }

  private whileStatement(s: Extract<Stmt, { t: 'while' }>, scope: Map<string, Value>): Signal {
    while (truthy(this.value(s.cond, scope))) {
      this.tick();
      if (this.exec(s.body, scope) === 'break') break;
    }
    return null;
  }

  private expressionStatement(e: Expr, print: boolean, scope: Map<string, Value>): void {
    const values = this.multi(e, 0, scope);
    if (values.length === 0) return;
    const v = values[0];
    const name = e.t === 'id' && scope.has(e.name) ? e.name : 'ans';
    if (name === 'ans') scope.set('ans', v);
    if (print) this.show(name, v);
  }

  private show(name: string, v: Value): void {
    this.entries.push({ kind: 'out', lines: formatValue(name, v, this.format.long) });
  }

  private assignment(s: Extract<Stmt, { t: 'assign' }>, scope: Map<string, Value>): void {
    if (s.targets.length > 1) {
      const values = this.multi(s.e, s.targets.length, scope);
      if (values.length < s.targets.filter((t) => t.name !== '~').length) throw new KitError('mcTooFewOutputs');
      s.targets.forEach((t, i) => {
        if (t.name === '~') return;
        scope.set(t.name, values[i]);
        if (s.print) this.show(t.name, values[i]);
      });
      return;
    }
    const target = s.targets[0];
    const rhs = this.value(s.e, scope);
    if (target.index === null) {
      scope.set(target.name, rhs);
    } else {
      const current = scope.get(target.name) ?? empty();
      if (current.kind !== 'mat' || rhs.kind !== 'mat') throw new KitError('mcNotSupported', 'indexing a function');
      scope.set(target.name, assignIndex(current, this.subscripts(target.index, current, scope), rhs));
    }
    if (s.print) this.show(target.name, scope.get(target.name)!);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Expressions
  // -------------------------------------------------------------------------------------------------------------

  /** One value from an expression. */
  private value(e: Expr, scope: Map<string, Value>): Value {
    const values = this.multi(e, 1, scope);
    if (values.length === 0) throw new KitError('mcNoValue');
    return values[0];
  }

  private matrixOf(e: Expr, scope: Map<string, Value>): M {
    return asMat(this.value(e, scope), 'operand');
  }

  /** All the values an expression gives; only a call can give more than one. */
  private multi(e: Expr, nargout: number, scope: Map<string, Value>): Value[] {
    this.tick();
    switch (e.t) {
      case 'num':
        return [scalar(e.v)];
      case 'str':
        return [text(e.v)];
      case 'id':
        return this.identifier(e.name, nargout, scope);
      case 'colon':
        return [text(':')];
      case 'end':
        return [scalar(this.endValue())];
      case 'call':
        return this.callOrIndex(e, nargout, scope);
      case 'anon':
        return [{ kind: 'fn', params: e.params, body: e.body, env: new Map(scope), src: e.src }];
      case 'fh':
        return [
          { kind: 'fn', params: [], body: e as unknown as Expr, env: new Map(), src: `@${e.name}`, builtin: e.name },
        ];
      default:
        return [this.operator(e, scope)];
    }
  }

  private operator(e: Expr, scope: Map<string, Value>): Value {
    if (e.t === 'bin') return this.binaryOp(e.op, e.l, e.r, scope);
    if (e.t === 'un') {
      const v = this.matrixOf(e.e, scope);
      return e.op === '-' ? negate(v) : e.op === '~' ? not(v) : v;
    }
    if (e.t === 'post') {
      this.say('explainTranspose', { size: `${this.matrixOf(e.e, scope).r}x${this.matrixOf(e.e, scope).c}` });
      return transpose(this.matrixOf(e.e, scope));
    }
    if (e.t === 'range') return this.rangeOp(e, scope);
    if (e.t === 'mat') return this.matrixLiteral(e.rows, scope);
    throw new KitError('mcSyntax', 'unexpected expression');
  }

  private binaryOp(op: string, l: Expr, r: Expr, scope: Map<string, Value>): Value {
    if (op === '&&' || op === '||') {
      const left = truthy(this.value(l, scope));
      if (op === '&&' ? !left : left) return { ...scalar(left ? 1 : 0), logical: true };
      return { ...scalar(truthy(this.value(r, scope)) ? 1 : 0), logical: true };
    }
    const a = this.matrixOf(l, scope);
    const b = this.matrixOf(r, scope);
    this.tick(Math.min(numel(a) * Math.max(1, op === '*' ? b.c : 1), 5_000_000));
    return binary(op, a, b, this.say);
  }

  private rangeOp(e: Extract<Expr, { t: 'range' }>, scope: Map<string, Value>): Value {
    const num = (x: Expr) => asNumber(this.first(this.value(x, scope)), 'range');
    const a = num(e.a);
    const step = e.step ? num(e.step) : 1;
    const b = num(e.b);
    this.say('explainRange', { a: String(a), step: String(step), b: String(b) });
    const count = step === 0 ? 0 : Math.floor((b - a) / step + 1e-10) + 1;
    if (count > 1_000_000) throw new KitError('mcTooBig', '1000000');
    return colonRange(a, step, b);
  }

  private first(v: Value): Value {
    return v.kind === 'mat' && v.d.length > 1 ? scalar(v.d[0]) : v;
  }

  private matrixLiteral(rows: Expr[][], scope: Map<string, Value>): Value {
    const built = rows.map((row) => this.joinRow(row.map((x) => this.matrixOf(x, scope))));
    const pieces = built.filter((m) => numel(m) > 0 || m.str !== undefined);
    if (pieces.length === 0) return empty();
    if (pieces.some((m) => m.c !== pieces[0].c)) throw new KitError('mcCatDims');
    const out = fromRows(pieces.flatMap(toRows));
    if (pieces.every((m) => m.str !== undefined)) return text(pieces.map((m) => m.str).join(''));
    if (pieces.every((m) => m.logical)) out.logical = true;
    return out;
  }

  private joinRow(parts: M[]): M {
    const real = parts.filter((m) => numel(m) > 0);
    if (real.length === 0) return parts.find((m) => m.str !== undefined) ?? empty();
    if (real.some((m) => m.r !== real[0].r)) throw new KitError('mcCatDims');
    const all = real.map(toRows);
    const out = fromRows(all[0].map((_, i) => all.flatMap((rows) => rows[i])));
    if (real.every((m) => m.str !== undefined)) return text(real.map((m) => m.str).join(''));
    if (real.every((m) => m.logical)) out.logical = true;
    return out;
  }

  private endValue(): number {
    const frame = this.ends[this.ends.length - 1];
    if (!frame) throw new KitError('mcEndOutside');
    if (frame.count === 1) return numel(frame.m);
    return frame.pos === 0 ? frame.m.r : frame.m.c;
  }

  private identifier(name: string, nargout: number, scope: Map<string, Value>): Value[] {
    const v = scope.get(name);
    if (v) return [v];
    if (name === 'clear' || name === 'clc') return this.sessionCommand(name, []);
    const f = TABLE.get(name);
    if (!f) throw new KitError('mcUndefined', name);
    return f([], nargout, this.ctx());
  }

  private subscripts(args: Expr[], m: M, scope: Map<string, Value>): Sub[] {
    return args.map((a, pos) => {
      if (a.t === 'colon') return toSub('colon', 0);
      this.ends.push({ m, pos, count: args.length });
      try {
        const v = this.value(a, scope);
        if (v.kind === 'mat' && v.str === ':') return toSub('colon', 0);
        return toSub(v, args.length === 1 ? numel(m) : pos === 0 ? m.r : m.c);
      } finally {
        this.ends.pop();
      }
    });
  }

  private callOrIndex(e: Extract<Expr, { t: 'call' }>, nargout: number, scope: Map<string, Value>): Value[] {
    const fname = e.f.t === 'id' ? e.f.name : null;
    const held = fname !== null ? scope.get(fname) : e.f.t === 'id' ? undefined : this.value(e.f, scope);
    if (held && held.kind === 'mat') {
      this.say('explainIndex', { name: fname ?? 'value', size: `${held.r}x${held.c}` });
      return [indexValue(held, this.subscripts(e.args, held, scope))];
    }
    const args = e.args.map((a) => (a.t === 'colon' ? text(':') : this.value(a, scope)));
    if (held && held.kind === 'fn') return this.callValue(held, args, nargout);
    if (fname === 'clear' || fname === 'clc') return this.sessionCommand(fname, args);
    const builtin: Builtin | undefined = fname ? TABLE.get(fname) : undefined;
    if (!builtin) throw new KitError('mcUndefined', fname ?? 'function');
    this.tick(
      Math.max(
        1,
        args.reduce((s, a) => s + (a.kind === 'mat' ? numel(a) : 1), 0),
      ),
    );
    return builtin(args, nargout, this.ctx());
  }

  /** clear and clc change the session itself, so they are not in the table of functions. */
  private sessionCommand(name: string, args: Value[]): Value[] {
    if (name === 'clc') {
      this.entries.push({ kind: 'clear' });
      return [];
    }
    const names = args.flatMap((a) => (a.kind === 'mat' && a.str !== undefined ? [a.str] : []));
    if (names.length === 0 || names.includes('all')) this.vars.clear();
    else for (const n of names) this.vars.delete(n);
    return [];
  }

  private callValue(f: Value, args: Value[], nargout: number): Value[] {
    if (f.kind !== 'fn') throw new KitError('mcNotFunction');
    if (f.builtin) {
      const b = TABLE.get(f.builtin);
      if (!b) throw new KitError('mcUndefined', f.builtin);
      return b(args, nargout, this.ctx());
    }
    if (args.length > f.params.length) throw new KitError('mcArgs', f.src);
    if (++this.depth > DEPTH_LIMIT) throw new KitError('mcDepth');
    try {
      const scope = new Map(f.env);
      f.params.forEach((p, i) => args[i] && scope.set(p, args[i]));
      return this.multi(f.body, nargout, scope);
    } finally {
      this.depth--;
    }
  }

  /** The workspace for the table beside the console. */
  workspace(): { name: string; size: string; kind: string; preview: string }[] {
    return [...this.vars.entries()].map(([name, v]) => {
      if (v.kind === 'fn') return { name, size: '1x1', kind: 'function', preview: v.src };
      const kind = v.str !== undefined ? 'char' : v.logical ? 'logical' : 'double';
      const preview =
        v.str !== undefined ? v.str : v.d.length <= 6 ? v.d.map((x) => String(Number(x.toPrecision(5)))).join(' ') : '';
      return { name, size: `${v.r}x${v.c}`, kind, preview };
    });
  }
}

export type { Ctx };

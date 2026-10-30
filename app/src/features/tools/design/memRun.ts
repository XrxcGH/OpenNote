// checks-disable-file modifiability: the interpreter shares one machine state across every statement kind

// The memory and pointer tracer's interpreter. It runs a program from memParse over a simulated memory made of typed
// cells grouped in blocks (a variable, an array, a struct, or a heap allocation) and takes a snapshot of the whole
// state after each statement. Pointers carry the block they came from, so a step outside it is caught exactly.
// This is not a compiler and not full C++: the tool says so on screen.
import { BOOL, CHAR, DOUBLE, INT, ParseError, VOID, parse, sameTy, tyText } from './memParse';
import type { Declarator, Expr, Func, Program, Stmt, StructDef, Ty } from './memParse';

export const STEP_CAP = 10_000;
export const SNAPSHOT_CAP = 2_000;
const HEAP_CAP = 10_000;

// ---------- memory ----------

interface Ptr {
  b: Block | null;
  i: number;
}
type Val = number | Ptr | undefined;
type RVal = { ty: Ty; v: Val | Val[] };

interface Cell {
  ty: Ty;
  v: Val;
  block: Block;
  idx: number;
  label: string;
  offset: number;
}

type Region = 'stack' | 'heap' | 'global';

interface Block {
  id: number;
  region: Region;
  name: string;
  /** Element type (for a struct block, the struct type). */
  ty: Ty;
  isArray: boolean;
  count: number;
  cells: Cell[];
  base: number;
  live: boolean;
  freed: boolean;
  line: number;
  def?: StructDef;
  fieldStart: Map<string, number>;
  literal?: boolean;
}

type Binding = { ref: false; block: Block } | { ref: true; cell: Cell };

interface Frame {
  fn: string;
  scopes: Map<string, Binding>[];
  line: number;
}

export type WarnKind =
  | 'uninitialized'
  | 'outOfBounds'
  | 'useAfterDelete'
  | 'doubleDelete'
  | 'nullDeref'
  | 'leak'
  | 'dangling'
  | 'divideByZero'
  | 'badDelete'
  | 'overflow'
  | 'stepCap'
  | 'noReturn'
  | 'badShift'
  | 'literalWrite';

export interface Warning {
  kind: WarnKind;
  line: number;
  /** A name or number the message mentions. */
  detail?: string;
}

export interface Stop {
  line: number;
  kind: 'unsupported' | 'error';
  detail: string;
}

class Halt extends Error {
  constructor(public readonly stop: Stop | null) {
    super('halt');
  }
}

type Signal = { t: 'break' } | { t: 'continue' } | { t: 'return'; rv: RVal | null } | null;

const isNum = (t: Ty) => t.k === 'int' || t.k === 'double' || t.k === 'char' || t.k === 'bool';
const isPtr = (t: Ty): t is { k: 'ptr'; to: Ty } => t.k === 'ptr';

function sizeOf(t: Ty, structs: Map<string, StructDef>): number {
  switch (t.k) {
    case 'int':
      return 4;
    case 'double':
    case 'ptr':
      return 8;
    case 'char':
    case 'bool':
      return 1;
    case 'void':
      return 1;
    case 'struct':
      return layout(t.name, structs).size;
  }
}

function alignOf(t: Ty, structs: Map<string, StructDef>): number {
  return t.k === 'struct' ? layout(t.name, structs).align : t.k === 'void' ? 1 : sizeOf(t, structs);
}

/** A struct laid out as a C++ compiler does: each field at a multiple of its alignment, the size a multiple of the largest. */
function layout(name: string, structs: Map<string, StructDef>): { size: number; align: number; offsets: number[] } {
  const def = structs.get(name);
  if (!def) return { size: 1, align: 1, offsets: [] };
  let off = 0;
  let align = 1;
  const offsets: number[] = [];
  for (const f of def.fields) {
    const a = alignOf(f.ty, structs);
    align = Math.max(align, a);
    off = Math.ceil(off / a) * a;
    offsets.push(off);
    off += sizeOf(f.ty, structs) * (f.count ?? 1);
  }
  return { size: Math.max(1, Math.ceil(off / align) * align), align, offsets };
}

function formatG(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const exp = Number(x.toExponential(5).split('e')[1]);
  const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (exp < -4 || exp >= 6) {
    const [m, e] = x.toExponential(5).split('e');
    const n = Number(e);
    return `${trim(m!)}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  return trim(x.toFixed(Math.max(0, 5 - exp)));
}

const hex = (n: number): string => `0x${n.toString(16)}`;

// ---------- snapshots ----------

export interface CellView {
  label: string;
  addr: string;
  /** The value as text: a number, a character, `null`, `?` when uninitialized, or an address. */
  text: string;
  uninit: boolean;
  /** For a pointer, the block and cell index it points at (or why it cannot be followed). */
  points?: { block: number; index: number } | 'null' | 'dangling';
  changed: boolean;
}

export interface BlockView {
  id: number;
  region: Region;
  name: string;
  type: string;
  addr: string;
  cells: CellView[];
  live: boolean;
  freed: boolean;
  line: number;
  isArray: boolean;
  /** For a reference variable: the block and cell index it stands for. */
  refTo?: { block: number; index: number };
}

export interface FrameView {
  fn: string;
  vars: BlockView[];
}

export interface Snapshot {
  step: number;
  line: number;
  kind: 'statement' | 'condition' | 'call' | 'return' | 'end';
  frames: FrameView[];
  globals: BlockView[];
  heap: BlockView[];
  output: string;
  /** How many of the run's warnings had been raised when this snapshot was taken. */
  warnings: number;
}

export interface RunResult {
  ok: true;
  snapshots: Snapshot[];
  warnings: Warning[];
  output: string;
  steps: number;
  truncated: boolean;
  stop: Stop | null;
}

export interface RunFailure {
  ok: false;
  line: number;
  kind: 'syntax' | 'unsupported';
  detail: string;
}

// ---------- the interpreter ----------

export function run(source: string): RunResult | RunFailure {
  let program: Program;
  try {
    program = parse(source);
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, line: e.line, kind: e.kind, detail: e.detail };
    throw e;
  }
  return new Machine(program).execute();
}

class Machine {
  private nextBlock = 1;
  private stackTop = 0x7ffc3000;
  private heapNext = 0x55d0a000;
  private globalNext = 0x404000;
  private blocks: Block[] = [];
  private frames: Frame[] = [];
  private globals = new Map<string, Binding>();
  private literals = new Map<Expr, Block>();
  private out = '';
  private steps = 0;
  private warnings: Warning[] = [];
  private warned = new Set<string>();
  private snapshots: Snapshot[] = [];
  private lastText = new Map<Cell, string>();
  private truncated = false;
  private line = 1;

  constructor(private readonly p: Program) {}

  execute(): RunResult {
    let stop: Stop | null = null;
    try {
      const hasMain = this.p.funcs.has('main');
      if (hasMain) {
        for (const s of this.p.items) {
          if (s.s !== 'decl' && s.s !== 'empty')
            throw new Halt({ line: s.line, kind: 'unsupported', detail: 'a statement outside any function' });
          this.exec(s, true);
        }
        this.call(this.p.funcs.get('main')!, [], this.p.funcs.get('main')!.line);
      } else {
        this.frames.push({ fn: 'main', scopes: [new Map()], line: 1 });
        for (const s of this.p.items) {
          const sig = this.exec(s, false);
          if (sig && sig.t === 'return') break;
        }
        this.endScope();
        this.frames.pop();
      }
    } catch (e) {
      if (e instanceof Halt) stop = e.stop;
      else throw e;
    }
    // Anything left on the heap was never deleted.
    for (const b of this.blocks) {
      if (b.region === 'heap' && !b.freed) this.warn('leak', b.line, `${b.id}`);
    }
    this.frames = [];
    this.snap('end', this.line);
    return {
      ok: true,
      snapshots: this.snapshots,
      warnings: this.warnings,
      output: this.out,
      steps: this.steps,
      truncated: this.truncated,
      stop,
    };
  }

  // ---- diagnostics ----
  private warn(kind: WarnKind, line: number, detail?: string): void {
    const key = `${kind}:${line}:${detail ?? ''}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(detail === undefined ? { kind, line } : { kind, line, detail });
  }

  private fail(line: number, detail: string): never {
    throw new Halt({ line, kind: 'error', detail });
  }

  private unsupported(line: number, detail: string): never {
    throw new Halt({ line, kind: 'unsupported', detail });
  }

  private crash(kind: WarnKind, line: number, detail?: string): never {
    this.warn(kind, line, detail);
    throw new Halt(null);
  }

  // ---- allocation ----
  private alloc(region: Region, name: string, ty: Ty, count: number, isArray: boolean, line: number): Block {
    const def = ty.k === 'struct' ? this.p.structs.get(ty.name) : undefined;
    const b: Block = {
      id: this.nextBlock++,
      region,
      name,
      ty,
      isArray,
      count,
      cells: [],
      base: 0,
      live: true,
      freed: false,
      line,
      fieldStart: new Map(),
    };
    if (def) b.def = def;
    const elemSize = sizeOf(ty, this.p.structs);
    const total = Math.max(1, elemSize * count);
    if (region === 'stack') {
      this.stackTop -= Math.ceil(total / 8) * 8;
      b.base = this.stackTop;
    } else if (region === 'heap') {
      b.base = this.heapNext;
      this.heapNext += Math.ceil((total + 16) / 16) * 16;
    } else {
      b.base = this.globalNext;
      this.globalNext += Math.ceil(total / 8) * 8;
    }
    if (def) {
      const offsets = layout(def.name, this.p.structs).offsets;
      for (const [fi, f] of def.fields.entries()) {
        b.fieldStart.set(f.name, b.cells.length);
        const n = f.count ?? 1;
        for (let k = 0; k < n; k++) {
          b.cells.push({
            ty: f.ty,
            v: undefined,
            block: b,
            idx: b.cells.length,
            label: f.count ? `${f.name}[${k}]` : f.name,
            offset: (offsets[fi] ?? 0) + k * sizeOf(f.ty, this.p.structs),
          });
        }
      }
    } else {
      for (let k = 0; k < count; k++) {
        b.cells.push({ ty, v: undefined, block: b, idx: k, label: isArray ? `[${k}]` : '', offset: k * elemSize });
      }
    }
    this.blocks.push(b);
    return b;
  }

  private zero(ty: Ty): Val {
    return isPtr(ty) ? { b: null, i: 0 } : 0;
  }

  private zeroBlock(b: Block): void {
    for (const c of b.cells) c.v = this.zero(c.ty);
  }

  private addrOf(c: Cell): number {
    return c.block.base + c.offset;
  }

  // ---- scopes ----
  private get frame(): Frame {
    return this.frames[this.frames.length - 1]!;
  }

  private beginScope(): { top: number } {
    this.frame.scopes.push(new Map());
    return { top: this.stackTop };
  }

  private endScope(mark?: { top: number }): void {
    const scope = this.frame.scopes.pop();
    if (scope) {
      for (const b of scope.values()) {
        if (!b.ref && b.block.region === 'stack') b.block.live = false;
      }
    }
    if (mark) this.stackTop = mark.top;
  }

  private lookup(name: string, line: number): Binding {
    const f = this.frames[this.frames.length - 1];
    if (f) {
      for (let i = f.scopes.length - 1; i >= 0; i--) {
        const b = f.scopes[i]!.get(name);
        if (b) return b;
      }
    }
    const g = this.globals.get(name);
    if (g) return g;
    return this.fail(line, `${name} is not declared`);
  }

  // ---- reading and writing ----
  private checkLive(c: Cell, line: number): void {
    const b = c.block;
    if (b.freed) this.warn('useAfterDelete', line, b.name || `${b.id}`);
    else if (!b.live) this.warn('dangling', line, b.name);
  }

  private read(c: Cell, line: number): RVal {
    this.checkLive(c, line);
    if (c.v === undefined) {
      this.warn('uninitialized', line, c.block.name ? `${c.block.name}${c.label}` : c.label);
      return { ty: c.ty, v: this.zero(c.ty) };
    }
    return { ty: c.ty, v: c.v };
  }

  private write(c: Cell, rv: RVal, line: number): void {
    this.checkLive(c, line);
    if (c.block.literal) {
      this.warn('literalWrite', line);
      return;
    }
    c.v = this.coerce(rv, c.ty, line);
  }

  private num(rv: RVal, line: number): number {
    if (typeof rv.v === 'number') return rv.v;
    if (rv.v === undefined) return 0;
    if (isPtr(rv.ty) || (typeof rv.v === 'object' && !Array.isArray(rv.v))) {
      const p = rv.v as Ptr;
      return p.b ? p.b.base + (p.b.cells[p.i]?.offset ?? p.i * sizeOf(p.b.ty, this.p.structs)) : 0;
    }
    return this.fail(line, 'a struct where a number is needed');
  }

  private wrap(ty: Ty, n: number): number {
    switch (ty.k) {
      case 'int':
        return Number.isFinite(n) ? n | 0 : 0;
      case 'char':
        return Number.isFinite(n) ? (n << 24) >> 24 : 0;
      case 'bool':
        return n !== 0 ? 1 : 0;
      default:
        return n;
    }
  }

  /** Converts a value to a type: numbers truncate or wrap, 0 becomes a null pointer, pointers keep their block. */
  private coerce(rv: RVal, to: Ty, line: number): Val {
    if (to.k === 'struct') {
      if (rv.ty.k !== 'struct' || rv.ty.name !== to.name)
        this.fail(line, `a ${tyText(rv.ty)} cannot be stored in a ${tyText(to)}`);
      return rv.v as unknown as Val;
    }
    if (isPtr(to)) {
      if (isPtr(rv.ty)) {
        if (!sameTy(rv.ty, to) && !(rv.ty.to.k === 'void' || to.to.k === 'void')) {
          this.fail(line, `a ${tyText(rv.ty)} cannot be stored in a ${tyText(to)}`);
        }
        return rv.v as Val;
      }
      if (isNum(rv.ty) && rv.v === 0) return { b: null, i: 0 };
      return this.fail(line, `a ${tyText(rv.ty)} cannot be stored in a ${tyText(to)}`);
    }
    if (isPtr(rv.ty)) {
      if (to.k === 'bool') return (rv.v as Ptr).b ? 1 : 0;
      return this.fail(line, `a ${tyText(rv.ty)} cannot be stored in a ${tyText(to)}`);
    }
    if (rv.ty.k === 'struct') return this.fail(line, `a struct cannot be stored in a ${tyText(to)}`);
    const n = this.num(rv, line);
    if (to.k === 'double') return n;
    return this.wrap(to, Math.trunc(n));
  }

  // ---- pointer targets ----
  private cellAt(p: Ptr, offset: number, line: number, forWrite: boolean): Cell | null {
    if (!p.b) return this.crash('nullDeref', line);
    const i = p.i + offset;
    const b = p.b;
    if (i < 0 || i >= b.cells.length) {
      this.warn('outOfBounds', line, `${b.name || `#${b.id}`}[${i}]`);
      return null;
    }
    const c = b.cells[i]!;
    void forWrite;
    return c;
  }

  // ---- places (lvalues) ----
  private place(e: Expr, forWrite: boolean): Cell | null {
    switch (e.e) {
      case 'id': {
        const b = this.lookup(e.name, e.line);
        if (b.ref) return b.cell;
        if (b.block.isArray || b.block.def) return this.fail(e.line, `${e.name} is not a single value`);
        return b.block.cells[0]!;
      }
      case 'un':
        if (e.op === '*') {
          const p = this.rv(e.x);
          if (!isPtr(p.ty)) return this.fail(e.line, 'only a pointer can be dereferenced');
          return this.cellAt(p.v as Ptr, 0, e.line, forWrite);
        }
        break;
      case 'index': {
        const base = this.rv(e.x);
        if (!isPtr(base.ty)) return this.fail(e.line, 'only an array or pointer can be indexed');
        const idx = this.num(this.rv(e.i), e.line);
        return this.cellAt(base.v as Ptr, Math.trunc(idx), e.line, forWrite);
      }
      case 'member': {
        const b = this.structOf(e.x, e.arrow, e.line);
        if (!b) return null;
        const at = b.fieldStart.get(e.field);
        if (at === undefined) return this.fail(e.line, `${b.def?.name ?? 'the struct'} has no member ${e.field}`);
        return b.cells[at]!;
      }
      default:
        break;
    }
    return this.fail(e.line, 'this cannot be assigned to');
  }

  /** The block of a struct reached by `x.f` (x a struct) or `x->f` (x a pointer to a struct). */
  private structOf(x: Expr, arrow: boolean, line: number): Block | null {
    if (arrow) {
      const p = this.rv(x);
      if (!isPtr(p.ty) || p.ty.to.k !== 'struct') return this.fail(line, '-> needs a pointer to a struct');
      const ptr = p.v as Ptr;
      if (!ptr.b) return this.crash('nullDeref', line);
      this.checkLive(ptr.b.cells[0] ?? ({ block: ptr.b } as Cell), line);
      return ptr.b;
    }
    return this.structBlock(x, line);
  }

  /** The block holding a struct-valued expression: a variable or `*p`. */
  private structBlock(x: Expr, line: number): Block | null {
    if (x.e === 'id') {
      const b = this.lookup(x.name, line);
      const block = b.ref ? b.cell.block : b.block;
      if (!block.def) return this.fail(line, `${x.name} is not a struct`);
      return block;
    }
    if (x.e === 'un' && x.op === '*') {
      const p = this.rv(x.x);
      if (!isPtr(p.ty) || p.ty.to.k !== 'struct') return this.fail(line, 'this is not a struct');
      const ptr = p.v as Ptr;
      if (!ptr.b) return this.crash('nullDeref', line);
      return ptr.b;
    }
    return this.fail(line, 'this is not a struct');
  }

  private isStructExpr(e: Expr): boolean {
    if (e.e === 'id') {
      const b = this.lookup(e.name, e.line);
      return (b.ref ? b.cell.block : b.block).def !== undefined && !(b.ref ? false : b.block.isArray);
    }
    if (e.e === 'un' && e.op === '*') {
      const t = this.tyOf(e.x);
      return !!t && isPtr(t) && t.to.k === 'struct';
    }
    return false;
  }

  /** The static type of an expression, without running it (null when it is not simple to know). */
  private tyOf(e: Expr): Ty | null {
    switch (e.e) {
      case 'num':
        return e.dbl ? DOUBLE : INT;
      case 'chr':
        return CHAR;
      case 'bool':
        return BOOL;
      case 'id': {
        const b = this.lookup(e.name, e.line);
        const block = b.ref ? b.cell.block : b.block;
        if (b.ref) return b.cell.ty;
        if (block.isArray) return { k: 'ptr', to: block.ty };
        return block.def ? block.ty : block.cells[0]!.ty;
      }
      case 'un':
        if (e.op === '*') {
          const t = this.tyOf(e.x);
          return t && isPtr(t) ? t.to : null;
        }
        if (e.op === '&') {
          const t = this.tyOf(e.x);
          return t ? { k: 'ptr', to: t } : null;
        }
        return this.tyOf(e.x);
      case 'index': {
        const t = this.tyOf(e.x);
        return t && isPtr(t) ? t.to : null;
      }
      case 'member': {
        const t = this.tyOf(e.x);
        const st = e.arrow ? (t && isPtr(t) ? t.to : null) : t;
        if (!st || st.k !== 'struct') return null;
        return this.p.structs.get(st.name)?.fields.find((f) => f.name === e.field)?.ty ?? null;
      }
      case 'cast':
        return e.ty;
      default:
        return null;
    }
  }

  // ---- expressions ----
  private rv(e: Expr): RVal {
    switch (e.e) {
      case 'num':
        return { ty: e.dbl ? DOUBLE : INT, v: e.v };
      case 'chr':
        return { ty: CHAR, v: e.v };
      case 'bool':
        return { ty: BOOL, v: e.v ? 1 : 0 };
      case 'null':
        return { ty: { k: 'ptr', to: VOID }, v: { b: null, i: 0 } };
      case 'str': {
        let b = this.literals.get(e);
        if (!b) {
          b = this.alloc('global', '"literal"', CHAR, e.v.length + 1, true, e.line);
          b.literal = true;
          e.v.forEach((ch, k) => (b!.cells[k]!.v = ch));
          b.cells[e.v.length]!.v = 0;
          this.literals.set(e, b);
        }
        return { ty: { k: 'ptr', to: CHAR }, v: { b, i: 0 } };
      }
      case 'id': {
        if (e.name === 'endl') return { ty: INT, v: 0 };
        const b = this.lookup(e.name, e.line);
        if (b.ref) return this.read(b.cell, e.line);
        if (b.block.isArray) return { ty: { k: 'ptr', to: b.block.ty }, v: { b: b.block, i: 0 } };
        if (b.block.def) return { ty: b.block.ty, v: b.block.cells.map((c) => c.v) };
        return this.read(b.block.cells[0]!, e.line);
      }
      case 'un':
        return this.unary(e);
      case 'post': {
        const c = this.place(e.x, true);
        if (!c) return { ty: INT, v: 0 };
        const old = this.read(c, e.line);
        this.write(c, this.step(old, e.op === '++' ? 1 : -1, e.line), e.line);
        return old;
      }
      case 'bin':
        return this.binary(e);
      case 'assign':
        return this.assign(e);
      case 'cond':
        return this.truthy(this.rv(e.c), e.line) ? this.rv(e.a) : this.rv(e.b);
      case 'call':
        return this.callExpr(e);
      case 'index':
      case 'member': {
        if (e.e === 'member') {
          const b = this.structOf(e.x, e.arrow, e.line);
          if (b) {
            const at = b.fieldStart.get(e.field);
            if (at === undefined) return this.fail(e.line, `${b.def?.name ?? 'the struct'} has no member ${e.field}`);
            const first = b.cells[at]!;
            const def = b.def!.fields.find((f) => f.name === e.field)!;
            if (def.count) return { ty: { k: 'ptr', to: first.ty }, v: { b, i: at } };
            return this.read(first, e.line);
          }
          return { ty: INT, v: 0 };
        }
        const c = this.place(e, false);
        if (!c) return { ty: INT, v: 0 };
        return this.read(c, e.line);
      }
      case 'sizeofT':
        return { ty: INT, v: sizeOf(e.ty, this.p.structs) };
      case 'sizeofE': {
        if (e.x.e === 'id') {
          const b = this.lookup(e.x.name, e.line);
          if (!b.ref && (b.block.isArray || b.block.def)) {
            return {
              ty: INT,
              v: b.block.isArray
                ? b.block.count * sizeOf(b.block.ty, this.p.structs)
                : sizeOf(b.block.ty, this.p.structs),
            };
          }
        }
        const t = this.tyOf(e.x);
        if (!t) return this.unsupported(e.line, 'sizeof of this expression');
        return { ty: INT, v: sizeOf(t, this.p.structs) };
      }
      case 'new':
        return this.newExpr(e);
      case 'cast': {
        const v = this.rv(e.x);
        return { ty: e.ty, v: this.coerce(v, e.ty, e.line) };
      }
    }
  }

  private truthy(rv: RVal, line: number): boolean {
    if (isPtr(rv.ty)) return (rv.v as Ptr).b !== null;
    if (rv.ty.k === 'struct') return this.fail(line, 'a struct is not a condition');
    return this.num(rv, line) !== 0;
  }

  private step(rv: RVal, delta: number, line: number): RVal {
    if (isPtr(rv.ty)) {
      const p = rv.v as Ptr;
      return { ty: rv.ty, v: { b: p.b, i: p.i + delta } };
    }
    return { ty: rv.ty, v: this.arith(rv, { ty: INT, v: delta }, '+', line).v };
  }

  private unary(e: Extract<Expr, { e: 'un' }>): RVal {
    const { op } = e;
    if (op === '&') {
      if (e.x.e === 'id') {
        const b = this.lookup(e.x.name, e.line);
        if (!b.ref && (b.block.isArray || b.block.def)) {
          return { ty: { k: 'ptr', to: b.block.def ? b.block.ty : b.block.ty }, v: { b: b.block, i: 0 } };
        }
      }
      if (e.x.e === 'un' && e.x.op === '*') return this.rv(e.x.x);
      const c = this.place(e.x, false);
      if (!c) return { ty: { k: 'ptr', to: INT }, v: { b: null, i: 0 } };
      return { ty: { k: 'ptr', to: c.ty }, v: { b: c.block, i: c.idx } };
    }
    if (op === '*') {
      if (this.isStructExpr(e)) return this.fail(e.line, 'a whole struct read through a pointer is not supported here');
      const c = this.place(e, false);
      if (!c) return { ty: INT, v: 0 };
      return this.read(c, e.line);
    }
    if (op === '++' || op === '--') {
      const c = this.place(e.x, true);
      if (!c) return { ty: INT, v: 0 };
      const next = this.step(this.read(c, e.line), op === '++' ? 1 : -1, e.line);
      this.write(c, next, e.line);
      return next;
    }
    const v = this.rv(e.x);
    if (op === '!') return { ty: BOOL, v: this.truthy(v, e.line) ? 0 : 1 };
    if (isPtr(v.ty) || v.ty.k === 'struct') return this.fail(e.line, `${op} needs a number`);
    const n = this.num(v, e.line);
    if (op === '-')
      return { ty: v.ty.k === 'double' ? DOUBLE : INT, v: v.ty.k === 'double' ? -n : this.checked(-n, e.line) };
    if (op === '+') return { ty: v.ty.k === 'double' ? DOUBLE : INT, v: n };
    if (v.ty.k === 'double') return this.fail(e.line, '~ needs an integer');
    return { ty: INT, v: ~n };
  }

  private checked(n: number, line: number): number {
    if (n > 2147483647 || n < -2147483648) {
      this.warn('overflow', line);
      return n | 0;
    }
    return n;
  }

  private arith(a: RVal, b: RVal, op: string, line: number): RVal {
    const dbl = a.ty.k === 'double' || b.ty.k === 'double';
    const x = this.num(a, line);
    const y = this.num(b, line);
    let r: number;
    switch (op) {
      case '+':
        r = x + y;
        break;
      case '-':
        r = x - y;
        break;
      case '*':
        r = x * y;
        break;
      case '/':
        if (!dbl) {
          if (y === 0) return this.crash('divideByZero', line);
          r = Math.trunc(x / y);
        } else r = x / y;
        break;
      case '%':
        if (dbl) return this.fail(line, '% needs integers');
        if (y === 0) return this.crash('divideByZero', line);
        r = x % y;
        break;
      case '&':
        return { ty: INT, v: x & y };
      case '|':
        return { ty: INT, v: x | y };
      case '^':
        return { ty: INT, v: x ^ y };
      case '<<':
      case '>>':
        if (y < 0 || y >= 32) {
          this.warn('badShift', line);
          return { ty: INT, v: 0 };
        }
        return { ty: INT, v: op === '<<' ? x << y : x >> y };
      default:
        return this.fail(line, `the operator ${op}`);
    }
    if (dbl) return { ty: DOUBLE, v: r };
    if (op === '*') return { ty: INT, v: this.checked(Math.imul(x, y) === r ? r : r, line) };
    return { ty: INT, v: this.checked(r, line) };
  }

  private binary(e: Extract<Expr, { e: 'bin' }>): RVal {
    const { op } = e;
    if (op === '&&')
      return { ty: BOOL, v: this.truthy(this.rv(e.l), e.line) && this.truthy(this.rv(e.r), e.line) ? 1 : 0 };
    if (op === '||')
      return { ty: BOOL, v: this.truthy(this.rv(e.l), e.line) || this.truthy(this.rv(e.r), e.line) ? 1 : 0 };
    if (op === '<<' && this.chainsToCout(e)) return this.coutChain(e);
    const a = this.rv(e.l);
    const b = this.rv(e.r);
    if (isPtr(a.ty) || isPtr(b.ty)) return this.pointerOp(a, b, op, e.line);
    if (a.ty.k === 'struct' || b.ty.k === 'struct') return this.fail(e.line, `${op} cannot use a struct`);
    if (['<', '>', '<=', '>=', '==', '!='].includes(op)) {
      const x = this.num(a, e.line);
      const y = this.num(b, e.line);
      const r =
        op === '<'
          ? x < y
          : op === '>'
            ? x > y
            : op === '<='
              ? x <= y
              : op === '>='
                ? x >= y
                : op === '=='
                  ? x === y
                  : x !== y;
      return { ty: BOOL, v: r ? 1 : 0 };
    }
    return this.arith(a, b, op, e.line);
  }

  private pointerOp(a: RVal, b: RVal, op: string, line: number): RVal {
    const pa = isPtr(a.ty) ? (a.v as Ptr) : null;
    const pb = isPtr(b.ty) ? (b.v as Ptr) : null;
    if (op === '+' || op === '-') {
      if (pa && !pb) {
        const n = Math.trunc(this.num(b, line));
        return { ty: a.ty, v: { b: pa.b, i: pa.i + (op === '+' ? n : -n) } };
      }
      if (pb && !pa && op === '+') return { ty: b.ty, v: { b: pb.b, i: pb.i + Math.trunc(this.num(a, line)) } };
      if (pa && pb && op === '-') {
        if (pa.b !== pb.b) return this.fail(line, 'subtracting pointers into different blocks');
        return { ty: INT, v: pa.i - pb.i };
      }
      return this.fail(line, 'this pointer arithmetic is not allowed');
    }
    if (op === '==' || op === '!=') {
      const x = pa ?? ({ b: null, i: 0 } as Ptr);
      const y = pb ?? ({ b: null, i: 0 } as Ptr);
      if ((!pa && this.num(a, line) !== 0) || (!pb && this.num(b, line) !== 0))
        return this.fail(line, 'a pointer compared with a number');
      const same = x.b === y.b && (x.b === null || x.i === y.i);
      return { ty: BOOL, v: (op === '==') === same ? 1 : 0 };
    }
    if (['<', '>', '<=', '>='].includes(op) && pa && pb) {
      if (pa.b !== pb.b) return this.fail(line, 'comparing pointers into different blocks');
      const r = op === '<' ? pa.i < pb.i : op === '>' ? pa.i > pb.i : op === '<=' ? pa.i <= pb.i : pa.i >= pb.i;
      return { ty: BOOL, v: r ? 1 : 0 };
    }
    return this.fail(line, `the operator ${op} on a pointer`);
  }

  private assign(e: Extract<Expr, { e: 'assign' }>): RVal {
    if (e.op === '=' && this.isStructExpr(e.l)) {
      const dst = this.structBlock(e.l, e.line);
      const src = this.rv(e.r);
      if (!dst) return src;
      if (src.ty.k !== 'struct' || src.ty.name !== dst.ty.k) this.fail(e.line, 'the two sides are not the same struct');
      (src.v as Val[]).forEach((v, k) => (dst.cells[k]!.v = v));
      return src;
    }
    const c = this.place(e.l, true);
    // Evaluate the right side after the place so `a[i] = f()` sees the same order everywhere.
    if (e.op === '=') {
      const r = this.rv(e.r);
      if (!c) return r;
      this.write(c, r, e.line);
      return { ty: c.ty, v: c.v };
    }
    const r = this.rv(e.r);
    if (!c) return r;
    const cur = this.read(c, e.line);
    const op = e.op.slice(0, -1);
    const val = isPtr(cur.ty) ? this.pointerOp(cur, r, op, e.line) : this.arith(cur, r, op, e.line);
    this.write(c, val, e.line);
    return { ty: c.ty, v: c.v };
  }

  private newExpr(e: Extract<Expr, { e: 'new' }>): RVal {
    if (e.ty.k === 'void') return this.fail(e.line, 'new void');
    let count = 1;
    if (e.count) {
      count = Math.trunc(this.num(this.rv(e.count), e.line));
      if (count < 0 || count > HEAP_CAP) return this.fail(e.line, `an array of ${count} elements`);
    }
    if (e.count !== undefined && e.ty.k === 'struct') return this.unsupported(e.line, 'new arrays of structs');
    const b = this.alloc('heap', '', e.ty, count, e.count !== undefined, e.line);
    if (e.parens && !e.init) this.zeroBlock(b);
    if (e.init) {
      if (e.ty.k === 'struct') return this.unsupported(e.line, 'new with constructor arguments');
      b.cells[0]!.v = this.coerce(this.rv(e.init), e.ty, e.line);
    }
    return { ty: { k: 'ptr', to: e.ty }, v: { b, i: 0 } };
  }

  // ---- output ----
  private chainsToCout(e: Expr): boolean {
    let cur: Expr = e;
    while (cur.e === 'bin' && cur.op === '<<') cur = cur.l;
    return this.isCout(cur);
  }

  private isCout(e: Expr): boolean {
    return e.e === 'id' && e.name === 'cout';
  }

  private coutChain(e: Extract<Expr, { e: 'bin' }>): RVal {
    const parts: Expr[] = [];
    let cur: Expr = e;
    while (cur.e === 'bin' && cur.op === '<<') {
      parts.unshift(cur.r);
      cur = cur.l;
    }
    if (!this.isCout(cur)) return this.fail(e.line, 'only cout can be shifted with <<');
    for (const part of parts) this.put(part);
    return { ty: INT, v: 0 };
  }

  private put(e: Expr): void {
    if (e.e === 'id' && e.name === 'endl') {
      this.out += '\n';
      return;
    }
    const v = this.rv(e);
    if (isPtr(v.ty)) {
      const p = v.v as Ptr;
      if (v.ty.to.k === 'char' && p.b) {
        for (let i = p.i; i < p.b.cells.length; i++) {
          const ch = p.b.cells[i]!.v;
          if (typeof ch !== 'number' || ch === 0) break;
          this.out += String.fromCharCode(ch & 255);
        }
        return;
      }
      this.out += p.b ? hex(this.num(v, e.line)) : '0';
      return;
    }
    if (v.ty.k === 'struct') return this.fail(e.line, 'a struct cannot be printed');
    const n = this.num(v, e.line);
    if (v.ty.k === 'char') this.out += String.fromCharCode(n & 255);
    else if (v.ty.k === 'double') this.out += formatG(n);
    else this.out += String(n);
  }

  // ---- calls ----
  private callExpr(e: Extract<Expr, { e: 'call' }>): RVal {
    const f = this.p.funcs.get(e.name);
    if (!f) return this.unsupported(e.line, `the function ${e.name}`);
    if (f.params.length !== e.args.length)
      return this.fail(e.line, `${e.name} takes ${f.params.length} arguments, not ${e.args.length}`);
    const args: (RVal | Cell)[] = f.params.map((prm, k) => {
      const a = e.args[k]!;
      if (prm.ref) {
        const c = this.place(a, true);
        if (!c) return this.fail(a.line, 'a reference needs a variable');
        return c;
      }
      if (prm.ty.k === 'struct') {
        const r = this.rv(a);
        return r;
      }
      return this.rv(a);
    });
    const r = this.call(f, args, e.line);
    return r ?? { ty: VOID, v: 0 };
  }

  private call(f: Func, args: (RVal | Cell)[], line: number): RVal | null {
    if (this.frames.length > 200) {
      this.warn('stepCap', line, 'recursion');
      throw new Halt({ line, kind: 'error', detail: 'the calls nest too deeply' });
    }
    const mark = this.stackTop;
    this.frames.push({ fn: f.name, scopes: [new Map()], line });
    f.params.forEach((prm, k) => {
      const arg = args[k]!;
      if (prm.ref) {
        this.frame.scopes[0]!.set(prm.name, { ref: true, cell: arg as Cell });
        return;
      }
      const block = this.alloc('stack', prm.name, prm.ty, 1, false, line);
      const rv = arg as RVal;
      if (block.def) (rv.v as Val[]).forEach((v, i) => (block.cells[i]!.v = v));
      else block.cells[0]!.v = this.coerce(rv, prm.ty, line);
      this.frame.scopes[0]!.set(prm.name, { ref: false, block });
    });
    this.snap('call', f.line);
    let ret: RVal | null = null;
    let returned = false;
    for (const s of f.body) {
      const sig = this.exec(s, false);
      if (sig && sig.t === 'return') {
        ret = sig.rv;
        returned = true;
        break;
      }
    }
    if (!returned && f.ret.k !== 'void' && f.name !== 'main') this.warn('noReturn', line, f.name);
    if (f.ret.k !== 'void' && ret) ret = { ty: f.ret, v: this.coerce(ret, f.ret, line) };
    this.endScope();
    this.frames.pop();
    this.stackTop = mark;
    return ret;
  }

  // ---- statements ----
  private tick(line: number): void {
    this.line = line;
    if (++this.steps > STEP_CAP) {
      this.warn('stepCap', line);
      this.truncated = true;
      throw new Halt(null);
    }
  }

  private exec(s: Stmt, global: boolean): Signal {
    switch (s.s) {
      case 'empty':
        return null;
      case 'decl':
        this.tick(s.line);
        for (const d of s.decls) this.declare(d, global);
        this.snap('statement', s.line);
        return null;
      case 'expr':
        this.tick(s.line);
        this.rv(s.x);
        this.snap('statement', s.line);
        return null;
      case 'delete':
        this.tick(s.line);
        this.del(s);
        this.snap('statement', s.line);
        return null;
      case 'return': {
        this.tick(s.line);
        const rv = s.x ? this.rv(s.x) : null;
        this.snap('return', s.line);
        return { t: 'return', rv };
      }
      case 'break':
        this.tick(s.line);
        return { t: 'break' };
      case 'continue':
        this.tick(s.line);
        return { t: 'continue' };
      case 'block':
        return this.scoped(() => {
          for (const st of s.body) {
            const sig = this.exec(st, false);
            if (sig) return sig;
          }
          return null;
        });
      case 'if': {
        this.tick(s.line);
        const c = this.truthy(this.rv(s.c), s.line);
        this.snap('condition', s.line);
        if (c) return this.exec(s.a, false);
        return s.b ? this.exec(s.b, false) : null;
      }
      case 'while': {
        for (;;) {
          this.tick(s.line);
          const c = this.truthy(this.rv(s.c), s.line);
          this.snap('condition', s.line);
          if (!c) return null;
          const sig = this.exec(s.body, false);
          if (sig?.t === 'break') return null;
          if (sig?.t === 'return') return sig;
        }
      }
      case 'do': {
        for (;;) {
          const sig = this.exec(s.body, false);
          if (sig?.t === 'break') return null;
          if (sig?.t === 'return') return sig;
          this.tick(s.line);
          const c = this.truthy(this.rv(s.c), s.line);
          this.snap('condition', s.line);
          if (!c) return null;
        }
      }
      case 'for':
        return this.scoped(() => {
          if (s.init) this.exec(s.init, false);
          for (;;) {
            this.tick(s.line);
            const c = s.c ? this.truthy(this.rv(s.c), s.line) : true;
            this.snap('condition', s.line);
            if (!c) return null;
            const sig = this.exec(s.body, false);
            if (sig?.t === 'break') return null;
            if (sig?.t === 'return') return sig;
            if (s.step) {
              this.tick(s.line);
              this.rv(s.step);
            }
          }
        });
    }
  }

  private scoped(body: () => Signal): Signal {
    const mark = this.beginScope();
    try {
      return body();
    } finally {
      this.endScope(mark);
    }
  }

  private declare(d: Declarator, global: boolean): void {
    const scope = global ? this.globals : this.frame.scopes[this.frame.scopes.length - 1]!;
    if (scope.has(d.name)) this.fail(d.line, `${d.name} is already declared here`);
    if (d.ref) {
      const c = this.place(d.init!, true);
      if (!c) this.fail(d.line, 'a reference needs a variable');
      scope.set(d.name, { ref: true, cell: c });
      return;
    }
    const region: Region = global ? 'global' : 'stack';
    if (d.size !== undefined && d.ty.k === 'struct') return this.unsupported(d.line, 'arrays of structs');
    if (d.size !== undefined) {
      let count: number;
      if (d.size === 'infer') {
        if (d.list) count = d.list.length;
        else if (d.init?.e === 'str') count = d.init.v.length + 1;
        else return this.fail(d.line, 'an array needs a size');
      } else {
        count = Math.trunc(this.num(this.rv(d.size), d.line));
        if (count <= 0 || count > HEAP_CAP) return this.fail(d.line, `an array of ${count} elements`);
      }
      const b = this.alloc(region, d.name, d.ty, count, true, d.line);
      if (d.list) {
        if (d.list.length > count) this.fail(d.line, 'more values than the array holds');
        d.list.forEach((x, k) => (b.cells[k]!.v = this.coerce(this.rv(x), d.ty, d.line)));
        for (let k = d.list.length; k < count; k++) b.cells[k]!.v = this.zero(d.ty);
      } else if (d.init) {
        if (d.init.e !== 'str' || d.ty.k !== 'char') this.fail(d.line, 'this array initializer');
        const chars = d.init.v;
        if (chars.length + 1 > count) this.fail(d.line, 'the string does not fit');
        for (let k = 0; k < count; k++) b.cells[k]!.v = chars[k] ?? 0;
      } else if (global) this.zeroBlock(b);
      scope.set(d.name, { ref: false, block: b });
      return;
    }
    const b = this.alloc(region, d.name, d.ty, 1, false, d.line);
    scope.set(d.name, { ref: false, block: b });
    if (d.ty.k === 'struct') {
      if (d.list) {
        const def = b.def!;
        if (d.list.length > b.cells.length) this.fail(d.line, 'more values than the struct holds');
        d.list.forEach((x, k) => (b.cells[k]!.v = this.coerce(this.rv(x), def.fields[k]?.ty ?? INT, d.line)));
        for (let k = d.list.length; k < b.cells.length; k++) b.cells[k]!.v = this.zero(b.cells[k]!.ty);
      } else if (d.init) {
        const r = this.rv(d.init);
        if (r.ty.k !== 'struct' || r.ty.name !== d.ty.name) this.fail(d.line, 'the two sides are not the same struct');
        (r.v as Val[]).forEach((v, k) => (b.cells[k]!.v = v));
      } else if (global) this.zeroBlock(b);
      return;
    }
    if (d.list) this.fail(d.line, 'a list for a single value');
    if (d.init) b.cells[0]!.v = this.coerce(this.rv(d.init), d.ty, d.line);
    else if (global) this.zeroBlock(b);
  }

  private del(s: Extract<Stmt, { s: 'delete' }>): void {
    const v = this.rv(s.x);
    if (!isPtr(v.ty)) return this.fail(s.line, 'delete needs a pointer');
    const p = v.v as Ptr;
    if (!p.b) return;
    const b = p.b;
    if (b.freed) {
      this.warn('doubleDelete', s.line, `${b.id}`);
      return;
    }
    if (b.region !== 'heap' || p.i !== 0) {
      this.warn('badDelete', s.line);
      return;
    }
    if (b.isArray !== s.array) this.warn('badDelete', s.line, b.isArray ? 'array' : 'single');
    b.freed = true;
  }

  // ---- snapshots ----
  private snap(kind: Snapshot['kind'], line: number): void {
    this.line = line;
    if (this.snapshots.length >= SNAPSHOT_CAP) {
      this.truncated = true;
      return;
    }
    const view = (b: Block, name: string, refTo?: Cell): BlockView => {
      const cells = b.cells.map((c): CellView => {
        const text = this.text(c);
        const prev = this.lastText.get(c);
        const cv: CellView = {
          label: c.label,
          addr: hex(this.addrOf(c)),
          text,
          uninit: c.v === undefined,
          changed: prev !== undefined && prev !== text,
        };
        const v = c.v;
        if (isPtr(c.ty) && v !== undefined && typeof v === 'object') {
          const q = v as Ptr;
          if (!q.b) cv.points = 'null';
          else if (q.b.freed || !q.b.live || q.i < 0 || q.i >= q.b.cells.length) cv.points = 'dangling';
          else cv.points = { block: q.b.id, index: q.i };
        }
        return cv;
      });
      const bv: BlockView = {
        id: b.id,
        region: b.region,
        name,
        type: b.isArray ? `${tyText(b.ty)}[${b.count}]` : tyText(b.ty),
        addr: hex(b.base),
        cells,
        live: b.live,
        freed: b.freed,
        line: b.line,
        isArray: b.isArray,
      };
      if (refTo) bv.refTo = { block: refTo.block.id, index: refTo.idx };
      return bv;
    };
    const varsOf = (scopes: Map<string, Binding>[]): BlockView[] => {
      const list: BlockView[] = [];
      for (const sc of scopes) {
        for (const [name, bind] of sc) {
          if (bind.ref) {
            list.push({
              id: -1,
              region: 'stack',
              name,
              type: `${tyText(bind.cell.ty)}&`,
              addr: hex(this.addrOf(bind.cell)),
              cells: [],
              live: true,
              freed: false,
              line: 0,
              isArray: false,
              refTo: { block: bind.cell.block.id, index: bind.cell.idx },
            });
          } else list.push(view(bind.block, name));
        }
      }
      return list;
    };
    const frames = this.frames.map((f): FrameView => ({ fn: f.fn, vars: varsOf(f.scopes) }));
    const globals = varsOf([this.globals]);
    const heap = this.blocks.filter((b) => b.region === 'heap').map((b) => view(b, `#${b.id}`));
    // Literal strings are shown with the globals.
    for (const b of this.blocks) if (b.literal) globals.push(view(b, b.name));
    this.snapshots.push({
      step: this.snapshots.length,
      line,
      kind,
      frames,
      globals,
      heap,
      output: this.out,
      warnings: this.warnings.length,
    });
    this.lastText.clear();
    for (const b of this.blocks) for (const c of b.cells) this.lastText.set(c, this.text(c));
  }

  private text(c: Cell): string {
    const v = c.v;
    if (v === undefined) return '?';
    if (typeof v === 'object')
      return v.b ? hex(v.b.base + (v.b.cells[v.i]?.offset ?? v.i * sizeOf(v.b.ty, this.p.structs))) : 'null';
    if (c.ty.k === 'char') return v >= 32 && v < 127 ? `'${String.fromCharCode(v)}' ${v}` : String(v);
    if (c.ty.k === 'bool') return v ? 'true' : 'false';
    if (c.ty.k === 'double') return formatG(v);
    return String(v);
  }
}

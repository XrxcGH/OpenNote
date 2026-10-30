// Built-in functions, part one: building matrices, sizes and tests, element-wise functions, and the reductions that
// work down columns or along a vector (sum, max, mean, sort, find, and the rest).
import { KitError } from '../types';
import type { Builtin, Ctx } from './ctx';
import { elementwise } from './ops';
import {
  asInt,
  asMat,
  asNumber,
  bool,
  colVec,
  columnMajor,
  empty,
  fromRows,
  isScalar,
  MAX_ELEMENTS,
  mat,
  numel,
  rowVec,
  scalar,
  text,
  toRows,
  type M,
  type Value,
} from './values';

export type Table = Map<string, Builtin>;

export function argc(name: string, args: Value[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new KitError('mcArgs', name);
}

const fix = (x: number) => (x < 0 ? Math.ceil(x) : Math.floor(x));
const roundAway = (x: number) => (x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5));

function realOnly(x: number): number {
  if (Number.isNaN(x)) throw new KitError('mcComplex');
  return x;
}

const UNARY: Record<string, (x: number) => number> = {
  abs: Math.abs,
  sqrt: (x) => (x < 0 ? realOnly(NaN) : Math.sqrt(x)),
  exp: Math.exp,
  log: (x) => (x < 0 ? realOnly(NaN) : Math.log(x)),
  log2: (x) => (x < 0 ? realOnly(NaN) : Math.log2(x)),
  log10: (x) => (x < 0 ? realOnly(NaN) : Math.log10(x)),
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: (x) => (Math.abs(x) > 1 ? realOnly(NaN) : Math.asin(x)),
  acos: (x) => (Math.abs(x) > 1 ? realOnly(NaN) : Math.acos(x)),
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  floor: Math.floor,
  ceil: Math.ceil,
  round: roundAway,
  fix,
  sign: Math.sign,
  deg2rad: (x) => (x * Math.PI) / 180,
  rad2deg: (x) => (x * 180) / Math.PI,
  factorial: (x) => {
    if (x < 0 || !Number.isInteger(x)) throw new KitError('mcNeedInteger', 'factorial');
    let f = 1;
    for (let i = 2; i <= x; i++) f *= i;
    return f;
  },
};

const PREDICATE: Record<string, (x: number) => boolean> = {
  isnan: Number.isNaN,
  isinf: (x) => !Number.isFinite(x) && !Number.isNaN(x),
  isfinite: Number.isFinite,
  isprime: (x) => {
    if (!Number.isInteger(x) || x < 2) return false;
    for (let d = 2; d * d <= x; d++) if (x % d === 0) return false;
    return true;
  },
};

const BINARY: Record<string, (a: number, b: number) => number> = {
  atan2: Math.atan2,
  hypot: Math.hypot,
  mod: (a, b) => (b === 0 ? a : a - Math.floor(a / b) * b),
  rem: (a, b) => (b === 0 ? a : a - fix(a / b) * b),
  power: (a, b) => a ** b,
  gcd: (a, b) => {
    let [x, y] = [Math.abs(a), Math.abs(b)];
    while (y) [x, y] = [y, x % y];
    return x;
  },
  lcm: (a, b) => {
    let [x, y] = [Math.abs(a), Math.abs(b)];
    const product = x * y;
    while (y) [x, y] = [y, x % y];
    return x === 0 ? 0 : product / x;
  },
};

/** Applies f along dim (1 down the columns, 2 along the rows); a vector reduces along its length by default. */
export function reduceM(m: M, dim: number | undefined, f: (xs: number[]) => number): M {
  if (m.r === 0 && m.c === 0) return scalar(f([]));
  const d = dim ?? (m.r === 1 ? 2 : 1);
  const rows = toRows(m);
  if (d === 1) return rowVec(m.d.slice(0, m.c).map((_, j) => f(rows.map((row) => row[j]))));
  return colVec(rows.map((row) => f(row)));
}

function accumulate(m: M, dim: number | undefined, f: (acc: number, x: number) => number): M {
  const d = dim ?? (m.r === 1 ? 2 : 1);
  const rows = toRows(m);
  if (d === 1) {
    const out = rows.map((row) => row.slice());
    for (let i = 1; i < m.r; i++) for (let j = 0; j < m.c; j++) out[i][j] = f(out[i - 1][j], rows[i][j]);
    return fromRows(out);
  }
  return fromRows(rows.map((row) => row.reduce<number[]>((acc, x, j) => [...acc, j === 0 ? x : f(acc[j - 1], x)], [])));
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;
const median = (xs: number[]) => {
  if (xs.some(Number.isNaN)) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const variance = (xs: number[]) => {
  if (xs.length === 1) return 0;
  const mu = mean(xs);
  return sum(xs.map((x) => (x - mu) ** 2)) / (xs.length - 1);
};

const REDUCE: Record<string, (xs: number[]) => number> = {
  sum,
  prod: (xs) => xs.reduce((p, x) => p * x, 1),
  mean,
  median,
  var: variance,
  std: (xs) => Math.sqrt(variance(xs)),
};

function dimArg(args: Value[], at: number): number | undefined {
  return args[at] === undefined ? undefined : asInt(args[at], 'dim');
}

function sizeOf(args: Value[], nargout: number): Value[] {
  argc('size', args, 1, 2);
  const m = args[0].kind === 'mat' ? args[0] : mat(1, 1, [0]);
  if (args[1]) {
    const dim = asInt(args[1], 'dim');
    return [scalar(dim === 1 ? m.r : dim === 2 ? m.c : 1)];
  }
  if (nargout <= 1) return [rowVec([m.r, m.c])];
  return [scalar(m.r), scalar(m.c)];
}

/** Sizes given as (n), (r, c), or ([r c]). */
export function dims(name: string, args: Value[]): [number, number] {
  const nums = args.filter((a) => !(a.kind === 'mat' && a.str !== undefined));
  let size: [number, number];
  if (nums.length === 0) size = [1, 1];
  else if (nums.length === 1) {
    const m = asMat(nums[0], name);
    const n = asInt(nums[0], name);
    size = m.d.length === 2 ? [m.d[0], m.d[1]] : [n, n];
  } else size = [asInt(nums[0], name), asInt(nums[1], name)];
  if (Math.max(size[0], 0) * Math.max(size[1], 0) > MAX_ELEMENTS) throw new KitError('mcTooBig', String(MAX_ELEMENTS));
  return size;
}

function filled(name: string, value: number): Builtin {
  return (args) => {
    const [r, c] = dims(name, args);
    if (r < 0 || c < 0) return [empty()];
    return [mat(r, c, new Array<number>(r * c).fill(value))];
  };
}

function random(normal: boolean): Builtin {
  return (args, _n, ctx) => {
    const [r, c] = dims('rand', args);
    const draw = () =>
      normal ? Math.sqrt(-2 * Math.log(1 - ctx.random())) * Math.cos(2 * Math.PI * ctx.random()) : ctx.random();
    return [mat(Math.max(r, 0), Math.max(c, 0), Array.from({ length: Math.max(r, 0) * Math.max(c, 0) }, draw))];
  };
}

function maxMin(name: 'max' | 'min'): Builtin {
  const better = name === 'max' ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
  const pick = (xs: number[]): [number, number] => {
    let best = NaN;
    let at = 0;
    xs.forEach((x, i) => {
      if (!Number.isNaN(x) && (Number.isNaN(best) || better(x, best))) {
        best = x;
        at = i;
      }
    });
    return [best, at + 1];
  };
  return (args, nargout) => {
    argc(name, args, 1, 3);
    const a = asMat(args[0], name);
    if (args.length === 2 && !(args[1].kind === 'mat' && args[1].d.length === 0)) {
      const b = asMat(args[1], name);
      const f = (x: number, y: number) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : better(x, y) ? x : y);
      return [bin(a, b, f)];
    }
    const dim = dimArg(args, 2);
    const values = reduceM(a, dim, (xs) => pick(xs)[0]);
    return nargout > 1 ? [values, reduceM(a, dim, (xs) => pick(xs)[1])] : [values];
  };
}

function bin(a: M, b: M, f: (x: number, y: number) => number): M {
  const out = elementwise('+', a, b);
  const r = out.r;
  const c = out.c;
  const d = out.d.map((_, k) => {
    const i = Math.floor(k / c);
    const j = k % c;
    return f(
      a.d[(a.r === 1 ? 0 : i) * a.c + (a.c === 1 ? 0 : j)],
      b.d[(b.r === 1 ? 0 : i) * b.c + (b.c === 1 ? 0 : j)],
    );
  });
  return mat(r, c, d);
}

function sortBuiltin(args: Value[], nargout: number): Value[] {
  argc('sort', args, 1, 3);
  const m = asMat(args[0], 'sort');
  const flag = args.find((a) => a.kind === 'mat' && a.str !== undefined) as M | undefined;
  const descending = flag?.str?.toLowerCase().startsWith('desc') ?? false;
  const order = (xs: number[]) =>
    xs
      .map((x, i) => [x, i] as const)
      .sort(([a, i], [b, j]) => {
        if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? (Number.isNaN(b) ? i - j : 1) : -1;
        return (descending ? b - a : a - b) || i - j;
      });
  if (m.r === 1 || m.c === 1) {
    const sorted = order(m.d);
    const shape = (d: number[]) => (m.r === 1 ? rowVec(d) : colVec(d));
    return nargout > 1
      ? [shape(sorted.map((p) => p[0])), shape(sorted.map((p) => p[1] + 1))]
      : [shape(sorted.map((p) => p[0]))];
  }
  const rows = toRows(m);
  const cols = m.d.slice(0, m.c).map((_, j) => order(rows.map((row) => row[j])));
  const value = fromRows(rows.map((_, i) => cols.map((col) => col[i][0])));
  return nargout > 1 ? [value, fromRows(rows.map((_, i) => cols.map((col) => col[i][1] + 1)))] : [value];
}

function findBuiltin(args: Value[]): Value[] {
  argc('find', args, 1, 2);
  const m = asMat(args[0], 'find');
  const found = columnMajor(m).flatMap((x, k) => (x !== 0 ? [k + 1] : []));
  const limited = args[1] ? found.slice(0, asInt(args[1], 'n')) : found;
  return [m.r === 1 && m.c !== 1 ? rowVec(limited) : limited.length ? colVec(limited) : mat(0, 1, [])];
}

function reshapeBuiltin(args: Value[]): Value[] {
  const m = asMat(args[0], 'reshape');
  let [r, c] = args.length === 2 ? dims('reshape', [args[1]]) : [asInt(args[1], 'size'), asInt(args[2], 'size')];
  const empties = args.slice(1).filter((a) => a.kind === 'mat' && a.d.length === 0).length;
  if (empties === 1) {
    const known = args.slice(1).map((a) => (a.kind === 'mat' && a.d.length ? a.d[0] : 0));
    r = known[0] || numel(m) / known[1];
    c = known[1] || numel(m) / known[0];
  }
  if (r * c !== numel(m)) throw new KitError('mcReshape', `${numel(m)}`);
  const flat = columnMajor(m);
  const out = mat(r, c, new Array<number>(r * c));
  for (let k = 0; k < flat.length; k++) out.d[(k % r) * c + Math.floor(k / r)] = flat[k];
  return [out];
}

function linspaceBuiltin(args: Value[]): Value[] {
  argc('linspace', args, 2, 3);
  const a = asNumber(args[0], 'a');
  const b = asNumber(args[1], 'b');
  const n = args[2] ? asInt(args[2], 'n') : 100;
  if (n < 1) return [mat(1, 0, [])];
  return [rowVec(Array.from({ length: n }, (_, i) => (n === 1 ? b : a + ((b - a) * i) / (n - 1))))];
}

function repmat(args: Value[]): Value[] {
  argc('repmat', args, 2, 3);
  const m = asMat(args[0], 'repmat');
  const [a, b] = dims('repmat', args.slice(1));
  const rows = toRows(m);
  const out: number[][] = [];
  for (let i = 0; i < a; i++) for (const row of rows) out.push(Array.from({ length: b }, () => row).flat());
  return [out.length && out[0].length ? fromRows(out) : empty()];
}

function meshgrid(args: Value[]): Value[] {
  const x = asMat(args[0], 'meshgrid');
  const y = asMat(args[1] ?? args[0], 'meshgrid');
  const X = mat(
    y.d.length,
    x.d.length,
    y.d.flatMap(() => x.d),
  );
  const Y = mat(
    y.d.length,
    x.d.length,
    y.d.flatMap((v) => x.d.map(() => v)),
  );
  return [X, Y];
}

function diag(args: Value[]): Value[] {
  const m = asMat(args[0], 'diag');
  const k = args[1] ? asInt(args[1], 'k') : 0;
  if (m.r === 1 || m.c === 1) {
    const n = numel(m) + Math.abs(k);
    const out = mat(n, n, new Array<number>(n * n).fill(0));
    m.d.forEach((v, i) => (out.d[(i + Math.max(0, -k)) * n + i + Math.max(0, k)] = v));
    return [out];
  }
  const d: number[] = [];
  for (let i = 0; i < m.r; i++) {
    const j = i + k;
    if (j >= 0 && j < m.c) d.push(m.d[i * m.c + j]);
  }
  return [colVec(d)];
}

function triangle(upper: boolean): Builtin {
  return (args) => {
    const m = asMat(args[0], 'triu');
    const k = args[1] ? asInt(args[1], 'k') : 0;
    const keep = (idx: number) => {
      const offset = (idx % m.c) - Math.floor(idx / m.c);
      return upper ? offset >= k : offset <= k;
    };
    return [
      mat(
        m.r,
        m.c,
        m.d.map((v, idx) => (keep(idx) ? v : 0)),
      ),
    ];
  };
}

function cat(horizontal: boolean): Builtin {
  return (args) => {
    const parts = args.map((a) => asMat(a, 'cat')).filter((m) => numel(m) > 0);
    if (parts.length === 0) return [empty()];
    if (horizontal) {
      if (parts.some((p) => p.r !== parts[0].r)) throw new KitError('mcCatDims');
      const all = parts.map(toRows);
      return [fromRows(all[0].map((_, i) => all.flatMap((rows) => rows[i])))];
    }
    if (parts.some((p) => p.c !== parts[0].c)) throw new KitError('mcCatDims');
    return [fromRows(parts.flatMap(toRows))];
  };
}

function magic(args: Value[]): Value[] {
  const n = asInt(args[0], 'n');
  if (n < 1 || n === 2) throw new KitError('mcNotSupported', 'magic(2)');
  return [fromRows(magicRows(n))];
}

function magicRows(n: number): number[][] {
  if (n % 2 === 1) {
    return Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const I = i + 1;
        const J = j + 1;
        const a = (((I + J - (n + 3) / 2) % n) + n) % n;
        const b = (((I + 2 * J - 2) % n) + n) % n;
        return n * a + b + 1;
      }),
    );
  }
  if (n % 4 === 0) {
    return Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const v = i * n + j + 1;
        return Math.floor(((i + 1) % 4) / 2) === Math.floor(((j + 1) % 4) / 2) ? n * n + 1 - v : v;
      }),
    );
  }
  const p = n / 2;
  const base = magicRows(p);
  const M = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const v = base[i % p][j % p];
      return i < p ? (j < p ? v : v + 2 * p * p) : j < p ? v + 3 * p * p : v + p * p;
    }),
  );
  const k = (n - 2) / 4;
  const swap = (i: number, j: number) => ([M[i][j], M[i + p][j]] = [M[i + p][j], M[i][j]]);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < n; j++) {
      const left = j < k || j >= n - k + 1;
      if (left) swap(i, j);
    }
  }
  swap(k, 0);
  swap(k, k);
  return M;
}

function equalBuiltin(args: Value[]): Value[] {
  const a = args[0];
  return [
    bool(
      args.slice(1).every((b) => {
        if (a.kind !== 'mat' || b.kind !== 'mat') return a === b;
        return a.r === b.r && a.c === b.c && a.d.every((x, i) => x === b.d[i]);
      }),
    ),
  ];
}

function cumulative(name: string, f: (acc: number, x: number) => number): Builtin {
  return (args) => [accumulate(asMat(args[0], name), dimArg(args, 1), f)];
}

function nchoosek(args: Value[]): Value[] {
  const n = asInt(args[0], 'n');
  const k = asInt(args[1], 'k');
  if (k < 0 || k > n) return [scalar(0)];
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - i + 1)) / i;
  return [scalar(Math.round(r))];
}

function primes(args: Value[]): Value[] {
  const n = Math.floor(asNumber(args[0], 'n'));
  const sieve = new Array<boolean>(Math.max(n + 1, 2)).fill(true);
  const out: number[] = [];
  for (let i = 2; i <= n; i++) {
    if (!sieve[i]) continue;
    out.push(i);
    for (let j = i * i; j <= n; j += i) sieve[j] = false;
  }
  return [rowVec(out)];
}

function classOf(args: Value[]): Value[] {
  const v = args[0];
  return [text(v.kind === 'fn' ? 'function_handle' : v.str !== undefined ? 'char' : v.logical ? 'logical' : 'double')];
}

export function registerA(t: Table): void {
  const def = (name: string, f: Builtin) => t.set(name, f);
  for (const [name, f] of Object.entries(UNARY)) {
    def(name, (args) => {
      argc(name, args, 1);
      const m = asMat(args[0], name);
      return [mat(m.r, m.c, m.d.map(f))];
    });
  }
  for (const [name, f] of Object.entries(PREDICATE)) {
    def(name, (args) => {
      const m = asMat(args[0], name);
      return [
        {
          ...mat(
            m.r,
            m.c,
            m.d.map((x) => (f(x) ? 1 : 0)),
          ),
          logical: true,
        },
      ];
    });
  }
  for (const [name, f] of Object.entries(BINARY)) {
    def(name, (args) => {
      argc(name, args, 2);
      return [bin(asMat(args[0], name), asMat(args[1], name), f)];
    });
  }
  for (const [name, f] of Object.entries(REDUCE)) {
    def(name, (args) => {
      argc(name, args, 1, name === 'std' || name === 'var' ? 3 : 2);
      const dim = name === 'std' || name === 'var' ? dimArg(args, 2) : dimArg(args, 1);
      return [reduceM(asMat(args[0], name), dim, f)];
    });
  }
  registerShapes(t);
}

function registerShapes(t: Table): void {
  const def = (name: string, f: Builtin) => t.set(name, f);
  def('any', (args) => [
    { ...reduceM(asMat(args[0], 'any'), dimArg(args, 1), (xs) => (xs.some((x) => x !== 0) ? 1 : 0)), logical: true },
  ]);
  def('all', (args) => [
    { ...reduceM(asMat(args[0], 'all'), dimArg(args, 1), (xs) => (xs.every((x) => x !== 0) ? 1 : 0)), logical: true },
  ]);
  def('max', maxMin('max'));
  def('min', maxMin('min'));
  def(
    'cumsum',
    cumulative('cumsum', (a, x) => a + x),
  );
  def(
    'cumprod',
    cumulative('cumprod', (a, x) => a * x),
  );
  def('sort', sortBuiltin);
  def('find', findBuiltin);
  def('reshape', reshapeBuiltin);
  def('linspace', linspaceBuiltin);
  def('repmat', repmat);
  def('meshgrid', meshgrid);
  def('diag', diag);
  def('triu', triangle(true));
  def('tril', triangle(false));
  def('horzcat', cat(true));
  def('vertcat', cat(false));
  def('magic', magic);
  def('isequal', equalBuiltin);
  def('nchoosek', nchoosek);
  def('primes', primes);
  def('class', classOf);
  def('size', (args, nargout) => sizeOf(args, nargout));
  def('numel', (args) => [scalar(numel(asMat(args[0], 'numel')))]);
  def('length', (args) => {
    const m = args[0].kind === 'mat' ? args[0] : mat(1, 1, [0]);
    return [scalar(m.r === 0 || m.c === 0 ? 0 : Math.max(m.r, m.c))];
  });
  def('rows', (args) => [scalar(asMat(args[0], 'rows').r)]);
  def('columns', (args) => [scalar(asMat(args[0], 'columns').c)]);
  def('isempty', (args) => [bool(args[0].kind === 'mat' && numel(args[0]) === 0)]);
  def('isscalar', (args) => [bool(args[0].kind === 'mat' && isScalar(args[0]))]);
  def('isvector', (args) => [
    bool(args[0].kind === 'mat' && (args[0].r === 1 || args[0].c === 1) && numel(args[0]) > 1),
  ]);
  def('ischar', (args) => [bool(args[0].kind === 'mat' && args[0].str !== undefined)]);
  def('islogical', (args) => [bool(args[0].kind === 'mat' && args[0].logical === true)]);
  def('isnumeric', (args) => [bool(args[0].kind === 'mat' && args[0].str === undefined && !args[0].logical)]);
  def('zeros', filled('zeros', 0));
  def('ones', filled('ones', 1));
  def('nan', filled('NaN', NaN));
  def('NaN', filled('NaN', NaN));
  def('inf', filled('Inf', Infinity));
  def('Inf', filled('Inf', Infinity));
  def('rand', random(false));
  def('randn', random(true));
  def('eye', (args) => {
    const [r, c] = dims('eye', args);
    return [
      mat(
        r,
        c,
        Array.from({ length: r * c }, (_, k) => (Math.floor(k / c) === k % c ? 1 : 0)),
      ),
    ];
  });
  def('pi', () => [scalar(Math.PI)]);
  def('eps', () => [scalar(2.220446049250313e-16)]);
  def('true', () => [bool(true)]);
  def('false', () => [bool(false)]);
}

export type { Ctx };

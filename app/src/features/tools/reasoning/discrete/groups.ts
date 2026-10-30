// Permutations and small finite groups. A permutation is typed in cycle notation, such as (1 2 3)(4 5), and a
// product pq applies q first, then p. A group is a multiplication table over named elements, built from a family
// (Z_n, Z_n*, D_n, S_n, A_n, Q_8) or typed as a Cayley table and checked against the axioms. From the table come
// element orders, the centre, every subgroup with its cosets and normality, and the subgroup lattice.
import { fail, lines } from '../core/util';

export type Perm = number[];

/** A permutation of 1..n from cycle notation; n is at least the largest point named. */
export function parseCycles(text: string, degree = 0): Perm {
  const src = text.replace(/\s+/g, ' ').trim();
  if (src === '' || src === '()' || src === 'e') return Array.from({ length: Math.max(1, degree) }, (_, i) => i);
  if (!/^(\(\s*\d+(?:[\s,]+\d+)*\s*\)\s*)+$/.test(src)) fail('cycles');
  const cycles = [...src.matchAll(/\(([^)]*)\)/g)].map((m) =>
    m[1]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number),
  );
  const n = Math.max(degree, ...cycles.flat());
  if (n > 50) fail('permBig', { n: 50 });
  if (cycles.flat().some((x) => x < 1)) fail('cycles');
  // Each cycle is applied as a permutation, right to left, so (1 2)(2 3) is a product.
  let p: Perm = Array.from({ length: n }, (_, i) => i);
  for (const c of [...cycles].reverse()) {
    if (new Set(c).size !== c.length) fail('cycleRepeat');
    const q: Perm = Array.from({ length: n }, (_, i) => i);
    c.forEach((x, k) => (q[x - 1] = c[(k + 1) % c.length] - 1));
    p = compose(q, p);
  }
  return p;
}

/** p after q: x goes to p(q(x)). */
export const compose = (p: Perm, q: Perm): Perm => {
  const n = Math.max(p.length, q.length);
  return Array.from({ length: n }, (_, x) => {
    const y = q[x] ?? x;
    return p[y] ?? y;
  });
};

export const inversePerm = (p: Perm): Perm => {
  const out = [...p];
  p.forEach((y, x) => (out[y] = x));
  return out;
};

export function cycleList(p: Perm): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let x = 0; x < p.length; x += 1) {
    if (seen.has(x)) continue;
    const c: number[] = [];
    for (let y = x; !seen.has(y); y = p[y]) {
      seen.add(y);
      c.push(y + 1);
    }
    out.push(c);
  }
  return out;
}

export const cycleText = (p: Perm): string =>
  cycleList(p)
    .filter((c) => c.length > 1)
    .map((c) => `(${c.join(' ')})`)
    .join('') || 'e';

const gcdN = (a: number, b: number): number => (b ? gcdN(b, a % b) : a);
const lcmN = (a: number, b: number) => (a / gcdN(a, b)) * b;

export const permOrder = (p: Perm): number => cycleList(p).reduce((acc, c) => lcmN(acc, c.length), 1);
export const permSign = (p: Perm): 1 | -1 => ((p.length - cycleList(p).length) % 2 === 0 ? 1 : -1);
/** The cycle type, longest first, such as [3, 2]. */
export const cycleType = (p: Perm): number[] =>
  cycleList(p)
    .map((c) => c.length)
    .sort((a, b) => b - a);

/** The size of the conjugacy class of p in S_n: n! / prod(k^m_k m_k!). */
export function classSize(p: Perm): bigint {
  const n = p.length;
  const counts = new Map<number, number>();
  for (const k of cycleType(p)) counts.set(k, (counts.get(k) ?? 0) + 1);
  let f = 1n;
  for (let i = 2n; i <= BigInt(n); i += 1n) f *= i;
  for (const [k, m] of counts) {
    let mf = 1n;
    for (let i = 2n; i <= BigInt(m); i += 1n) mf *= i;
    f /= BigInt(k) ** BigInt(m) * mf;
  }
  return f;
}

export interface Group {
  names: string[];
  /** mul[a][b] is the index of a * b. */
  mul: number[][];
  e: number;
}

function fromPerms(perms: Perm[], names: string[]): Group {
  const key = (p: Perm) => p.join(',');
  const index = new Map(perms.map((p, i) => [key(p), i]));
  const mul = perms.map((a) => perms.map((b) => index.get(key(compose(a, b)))!));
  const e = perms.findIndex((p) => p.every((y, x) => y === x));
  return { names, mul, e };
}

const rotate = (n: number, k: number): Perm => Array.from({ length: n }, (_, i) => (i + k) % n);

function allPerms(n: number): Perm[] {
  if (n === 0) return [[]];
  return allPerms(n - 1).flatMap((p) =>
    Array.from({ length: n }, (_, pos) => {
      const q = [...p];
      q.splice(pos, 0, n - 1);
      return q;
    }),
  );
}

export type Family = 'cyclic' | 'units' | 'dihedral' | 'symmetric' | 'alternating' | 'quaternion';

export function makeGroup(family: Family, n: number): Group {
  if (!Number.isInteger(n) || n < 1) fail('groupN');
  if (family === 'cyclic') {
    if (n > 60) fail('groupBig', { max: 60 });
    return fromPerms(
      Array.from({ length: n }, (_, k) => rotate(n, k)),
      Array.from({ length: n }, (_, k) => String(k)),
    );
  }
  if (family === 'units') {
    if (n < 2 || n > 200) fail('unitsN');
    const units = Array.from({ length: n }, (_, k) => k).filter((k) => gcdN(k, n) === 1);
    const names = units.map(String);
    const mul = units.map((a) => units.map((b) => units.indexOf((a * b) % n)));
    return { names, mul, e: units.indexOf(1) };
  }
  if (family === 'dihedral') {
    if (n < 3 || n > 30) fail('dihedralN');
    const power = (k: number) => (k === 0 ? '' : k === 1 ? 'r' : `r^${k}`);
    const perms: Perm[] = [];
    const names: string[] = [];
    for (let k = 0; k < n; k += 1) {
      perms.push(rotate(n, k));
      names.push(k === 0 ? 'e' : power(k));
    }
    for (let k = 0; k < n; k += 1) {
      perms.push(Array.from({ length: n }, (_, i) => (((k - i) % n) + n) % n));
      names.push(`${power(k)}s`);
    }
    return fromPerms(perms, names);
  }
  if (family === 'symmetric' || family === 'alternating') {
    if (n > 5) fail('symN', { max: 5 });
    const perms = allPerms(n).filter((p) => family === 'symmetric' || permSign(p) === 1);
    return fromPerms(perms, perms.map(cycleText));
  }
  // Q_8 by its multiplication rules on +-1, +-i, +-j, +-k.
  const names = ['1', '-1', 'i', '-i', 'j', '-j', 'k', '-k'];
  const table: Record<string, [string, number]> = {
    '11': ['1', 1], '1i': ['i', 1], '1j': ['j', 1], '1k': ['k', 1],
    i1: ['i', 1], ii: ['1', -1], ij: ['k', 1], ik: ['j', -1],
    j1: ['j', 1], ji: ['k', -1], jj: ['1', -1], jk: ['i', 1],
    k1: ['k', 1], ki: ['j', 1], kj: ['i', -1], kk: ['1', -1],
  }; // prettier-ignore
  const split = (x: string): [string, number] => (x.startsWith('-') ? [x.slice(1), -1] : [x, 1]);
  const mul = names.map((a) =>
    names.map((b) => {
      const [ua, sa] = split(a);
      const [ub, sb] = split(b);
      const [u, s] = table[ua + ub];
      const sign = s * sa * sb;
      return names.indexOf(sign < 0 ? `-${u}` : u);
    }),
  );
  return { names, mul, e: 0 };
}

/** A typed Cayley table: the first line names the elements, then 1 row per element in the same order. */
export function parseCayley(text: string): Group {
  const rows = lines(text).map((l) => l.split(/[\s,]+/).filter(Boolean));
  if (rows.length < 2) fail('cayleyShape');
  const names = rows[0];
  if (new Set(names).size !== names.length) fail('cayleyNames');
  const body = rows.slice(1).map((r) => (r.length === names.length + 1 ? r.slice(1) : r));
  if (body.length !== names.length || body.some((r) => r.length !== names.length)) fail('cayleyShape');
  if (names.length > 60) fail('groupBig', { max: 60 });
  const mul = body.map((r) =>
    r.map((x) => {
      const k = names.indexOf(x);
      if (k < 0) fail('cayleyClosed', { name: x });
      return k;
    }),
  );
  const n = names.length;
  const e = names.findIndex((_, a) => mul[a].every((v, b) => v === b) && mul.every((r, b) => r[a] === b));
  if (e < 0) fail('cayleyIdentity');
  for (let a = 0; a < n; a += 1) if (!mul[a].includes(e)) fail('cayleyInverse', { name: names[a] });
  for (let a = 0; a < n; a += 1)
    for (let b = 0; b < n; b += 1)
      for (let c = 0; c < n; c += 1)
        if (mul[mul[a][b]][c] !== mul[a][mul[b][c]]) fail('cayleyAssoc', { a: names[a], b: names[b], c: names[c] });
  return { names, mul, e };
}

export const inverse = (g: Group, a: number): number => g.mul[a].indexOf(g.e);

export function elementOrder(g: Group, a: number): number {
  let k = 1;
  for (let x = a; x !== g.e; x = g.mul[x][a]) k += 1;
  return k;
}

export const isAbelian = (g: Group): boolean => g.mul.every((r, a) => r.every((v, b) => v === g.mul[b][a]));

export const centre = (g: Group): number[] =>
  g.names.flatMap((_, a) => (g.mul[a].every((v, b) => v === g.mul[b][a]) ? [a] : []));

/** The subgroup generated by some elements, sorted. */
export function generate(g: Group, gens: number[]): number[] {
  const seen = new Set([g.e]);
  const queue = [g.e];
  while (queue.length) {
    const x = queue.shift()!;
    for (const s of gens) {
      const y = g.mul[x][s];
      if (!seen.has(y)) {
        seen.add(y);
        queue.push(y);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Every subgroup: the cyclic ones, then joins of pairs until nothing new appears. */
export function subgroups(g: Group): number[][] {
  const n = g.names.length;
  if (n > 120) fail('groupBig', { max: 120 });
  const found = new Map<string, { h: number[]; gens: number[] }>();
  const keep = (h: number[], gens: number[]) => {
    const key = h.join(',');
    if (found.has(key)) return false;
    found.set(key, { h, gens });
    return true;
  };
  keep([g.e], []);
  for (let a = 0; a < n; a += 1) keep(generate(g, [a]), [a]);
  const list = [...found.values()];
  for (let i = 0; i < list.length; i += 1)
    for (let j = i + 1; j < list.length; j += 1) {
      const [x, y] = [list[i], list[j]];
      const inX = new Set(x.h);
      if (y.h.every((v) => inX.has(v)) || x.h.every((v) => y.h.includes(v))) continue;
      const gens = [...new Set([...x.gens, ...y.gens])];
      const h = generate(g, gens);
      if (keep(h, gens)) list.push(found.get(h.join(','))!);
      if (found.size > 400) fail('tooManySubgroups');
    }
  return [...found.values()].map((v) => v.h).sort((a, b) => a.length - b.length || a[0] - b[0] || a[1] - b[1]);
}

export const isNormal = (g: Group, h: number[]): boolean => {
  const set = new Set(h);
  return g.names.every((_, x) => h.every((y) => set.has(g.mul[g.mul[x][y]][inverse(g, x)])));
};

/** The left cosets xH, each as a sorted list. */
export function leftCosets(g: Group, h: number[]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let x = 0; x < g.names.length; x += 1) {
    if (seen.has(x)) continue;
    const c = h.map((y) => g.mul[x][y]).sort((a, b) => a - b);
    c.forEach((v) => seen.add(v));
    out.push(c);
  }
  return out;
}

/** The covering pairs of the subgroup lattice: K below H with nothing strictly between. */
export function lattice(subs: number[][]): [number, number][] {
  const contains = (big: number[], small: number[]) => {
    const s = new Set(big);
    return small.every((x) => s.has(x));
  };
  const below = (i: number, j: number) => subs[i].length < subs[j].length && contains(subs[j], subs[i]);
  const edges: [number, number][] = [];
  for (let i = 0; i < subs.length; i += 1)
    for (let j = 0; j < subs.length; j += 1)
      if (below(i, j) && !subs.some((_, k) => below(i, k) && below(k, j))) edges.push([i, j]);
  return edges;
}

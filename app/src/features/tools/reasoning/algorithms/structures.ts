// Data structures driven by a list of operations, such as "insert 5, insert 3, delete 5": stacks, queues, binary
// search trees, AVL trees with their rotations, binary min-heaps, B-trees of order m (insert and split), and hash
// tables with chaining, linear or quadratic probing, or double hashing. Each operation logs what it did.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail } from '../core/util';

export interface Op {
  verb: string;
  value?: number;
}

const VERBS = new Set(['insert', 'delete', 'push', 'pop', 'peek', 'enqueue', 'dequeue', 'extract', 'search', 'find']);
export const MAX_OPS = 500;

/** Operations separated by commas or new lines; a bare number means insert (or push). */
export function parseOps(text: string): Op[] {
  const parts = text
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) fail('noOps');
  if (parts.length > MAX_OPS) fail('tooManyOps', { max: MAX_OPS });
  return parts.map((p) => {
    const m = /^([a-z]+)?\s*(-?\d+(?:\.\d+)?)?$/i.exec(p);
    if (!m || (!m[1] && !m[2])) return fail('opWord', { op: p });
    const verb = (m[1] ?? 'insert').toLowerCase();
    if (!VERBS.has(verb)) fail('opWord', { op: p });
    return { verb: verb === 'find' ? 'search' : verb, value: m[2] === undefined ? undefined : Number(m[2]) };
  });
}

const need = (op: Op): number => (op.value === undefined ? fail('opValue', { op: op.verb }) : op.value);

/* ---------- Stack and queue ---------- */

export function linear(kind: 'stack' | 'queue', ops: readonly Op[]): { items: number[]; log: Step[] } {
  const items: number[] = [];
  const log: Step[] = [];
  for (const op of ops) {
    if (['insert', 'push', 'enqueue'].includes(op.verb)) {
      items.push(need(op));
      log.push(step(kind === 'stack' ? 'push' : 'enqueue', { value: need(op), items: items.join(' ') || '∅' }));
    } else if (['pop', 'dequeue', 'delete', 'extract'].includes(op.verb)) {
      if (!items.length) log.push(step('underflow', { op: op.verb }));
      else {
        const v = kind === 'stack' ? items.pop()! : items.shift()!;
        log.push(step(kind === 'stack' ? 'pop' : 'dequeue', { value: v, items: items.join(' ') || '∅' }));
      }
    } else if (op.verb === 'peek')
      log.push(
        items.length
          ? step('peek', { value: kind === 'stack' ? items.at(-1)! : items[0] })
          : step('underflow', { op: 'peek' }),
      );
    else fail('opFor', { op: op.verb, kind });
  }
  return { items, log };
}

/* ---------- Binary search trees and AVL trees ---------- */

export interface Bst {
  key: number;
  left: Bst | null;
  right: Bst | null;
  height: number;
}

const h = (t: Bst | null) => (t ? t.height : 0);
const fix = (t: Bst): Bst => {
  t.height = 1 + Math.max(h(t.left), h(t.right));
  return t;
};
const node = (key: number): Bst => ({ key, left: null, right: null, height: 1 });

function rotateRight(y: Bst): Bst {
  const x = y.left!;
  y.left = x.right;
  x.right = fix(y);
  return fix(x);
}
function rotateLeft(x: Bst): Bst {
  const y = x.right!;
  x.right = y.left;
  y.left = fix(x);
  return fix(y);
}

function balance(t: Bst, log: Step[]): Bst {
  fix(t);
  const b = h(t.left) - h(t.right);
  if (b > 1) {
    if (h(t.left!.left) < h(t.left!.right)) {
      log.push(step('rotateLR', { at: t.key }));
      t.left = rotateLeft(t.left!);
    } else log.push(step('rotateRight', { at: t.key }));
    return rotateRight(t);
  }
  if (b < -1) {
    if (h(t.right!.right) < h(t.right!.left)) {
      log.push(step('rotateRL', { at: t.key }));
      t.right = rotateRight(t.right!);
    } else log.push(step('rotateLeft', { at: t.key }));
    return rotateLeft(t);
  }
  return t;
}

export function treeOps(avl: boolean, ops: readonly Op[]): { root: Bst | null; log: Step[]; rotations: number } {
  const log: Step[] = [];
  let root: Bst | null = null;
  const done = (t: Bst) => (avl ? balance(t, log) : fix(t));
  const insert = (t: Bst | null, k: number, path: number[]): Bst => {
    if (!t) return node(k);
    path.push(t.key);
    if (k < t.key) t.left = insert(t.left, k, path);
    else if (k > t.key) t.right = insert(t.right, k, path);
    else return t;
    return done(t);
  };
  const remove = (t: Bst | null, k: number): Bst | null => {
    if (!t) return null;
    if (k < t.key) t.left = remove(t.left, k);
    else if (k > t.key) t.right = remove(t.right, k);
    else {
      if (!t.left || !t.right) return t.left ?? t.right;
      let s = t.right;
      while (s.left) s = s.left;
      log.push(step('successor', { key: k, by: s.key }));
      t.key = s.key;
      t.right = remove(t.right, s.key);
    }
    return done(t);
  };
  const has = (t: Bst | null, k: number, path: number[]): boolean => {
    if (!t) return false;
    path.push(t.key);
    return k === t.key || has(k < t.key ? t.left : t.right, k, path);
  };
  for (const op of ops) {
    const k = need(op);
    if (op.verb === 'insert' || op.verb === 'push') {
      const path: number[] = [];
      const exists = has(root, k, []);
      root = insert(root, k, path);
      log.push(exists ? step('duplicate', { key: k }) : step('bstInsert', { key: k, path: path.join(' → ') || '—' }));
    } else if (op.verb === 'delete') {
      const exists = has(root, k, []);
      root = remove(root, k);
      log.push(step(exists ? 'bstDelete' : 'missing', { key: k }));
    } else if (op.verb === 'search') {
      const path: number[] = [];
      log.push(step(has(root, k, path) ? 'found' : 'notFound', { key: k, path: path.join(' → ') || '—' }));
    } else fail('opFor', { op: op.verb, kind: avl ? 'AVL' : 'BST' });
  }
  const rotations = log
    .filter((s) => s.key.startsWith('rotate'))
    .reduce((n, s) => n + (s.key === 'rotateLR' || s.key === 'rotateRL' ? 2 : 1), 0);
  return { root, log, rotations };
}

/** The keys in order, for checking a tree. */
export const inorder = (t: Bst | null): number[] => (t ? [...inorder(t.left), t.key, ...inorder(t.right)] : []);

/* ---------- Binary min-heap ---------- */

export function heapOps(ops: readonly Op[]): { heap: number[]; log: Step[] } {
  const a: number[] = [];
  const log: Step[] = [];
  const up = (i: number) => {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (a[p] <= a[i]) return;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < a.length && a[l] < a[m]) m = l;
      if (r < a.length && a[r] < a[m]) m = r;
      if (m === i) return;
      [a[m], a[i]] = [a[i], a[m]];
      i = m;
    }
  };
  for (const op of ops) {
    if (op.verb === 'insert' || op.verb === 'push') {
      a.push(need(op));
      up(a.length - 1);
      log.push(step('heapInsert', { key: need(op), heap: a.join(' ') }));
    } else if (['extract', 'pop', 'delete'].includes(op.verb)) {
      if (!a.length) {
        log.push(step('underflow', { op: op.verb }));
        continue;
      }
      const top = a[0];
      const last = a.pop()!;
      if (a.length) {
        a[0] = last;
        down(0);
      }
      log.push(step('heapExtract', { key: top, heap: a.join(' ') || '∅' }));
    } else if (op.verb === 'peek')
      log.push(a.length ? step('peek', { value: a[0] }) : step('underflow', { op: 'peek' }));
    else fail('opFor', { op: op.verb, kind: 'heap' });
  }
  return { heap: a, log };
}

/* ---------- B-trees ---------- */

export interface BNode {
  keys: number[];
  kids: BNode[];
}

/** Inserts into a B-tree of order m (at most m children and m − 1 keys); a full node splits at its median. */
export function bTreeOps(order: number, ops: readonly Op[]): { root: BNode; log: Step[]; splits: number } {
  if (!Number.isInteger(order) || order < 3 || order > 20) fail('bOrder');
  let root: BNode = { keys: [], kids: [] };
  const log: Step[] = [];
  let splits = 0;
  const insert = (n: BNode, k: number): { up: number; right: BNode } | null => {
    let i = 0;
    while (i < n.keys.length && n.keys[i] < k) i += 1;
    if (n.keys[i] === k) return null;
    if (n.kids.length === 0) n.keys.splice(i, 0, k);
    else {
      const r = insert(n.kids[i], k);
      if (r) {
        n.keys.splice(i, 0, r.up);
        n.kids.splice(i + 1, 0, r.right);
      }
    }
    if (n.keys.length < order) return null;
    const mid = Math.floor((order - 1) / 2);
    const up = n.keys[mid];
    const right: BNode = { keys: n.keys.slice(mid + 1), kids: n.kids.slice(mid + 1) };
    n.keys = n.keys.slice(0, mid);
    n.kids = n.kids.slice(0, mid + 1);
    splits += 1;
    log.push(step('bSplit', { key: up, left: n.keys.join(' '), right: right.keys.join(' ') }));
    return { up, right };
  };
  for (const op of ops) {
    if (op.verb !== 'insert' && op.verb !== 'push') fail('opFor', { op: op.verb, kind: 'B-tree' });
    const k = need(op);
    const r = insert(root, k);
    if (r) {
      root = { keys: [r.up], kids: [root, r.right] };
      log.push(step('bNewRoot', { key: r.up }));
    }
    log.push(step('bInsert', { key: k }));
  }
  return { root, log, splits };
}

/* ---------- Hash tables ---------- */

export const PROBES = ['chaining', 'linear', 'quadratic', 'double'] as const;
export type Probe = (typeof PROBES)[number];

export function hashOps(
  m: number,
  probe: Probe,
  ops: readonly Op[],
): { slots: number[][]; log: Step[]; probes: number } {
  if (!Number.isInteger(m) || m < 2 || m > 1000) fail('hashSize', { max: 1000 });
  const slots: number[][] = Array.from({ length: m }, () => []);
  const log: Step[] = [];
  let probes = 0;
  const mod = (x: number) => ((x % m) + m) % m;
  const h2 = (k: number) => 1 + (((k % (m - 1)) + (m - 1)) % (m - 1));
  const at = (k: number, i: number) =>
    probe === 'linear' ? mod(k + i) : probe === 'quadratic' ? mod(k + i * i) : mod(k + i * h2(k));
  for (const op of ops) {
    const k = need(op);
    if (!Number.isInteger(k)) fail('hashWhole');
    if (op.verb === 'insert' || op.verb === 'push') {
      if (probe === 'chaining') {
        slots[mod(k)].push(k);
        probes += 1;
        log.push(step('chain', { key: k, slot: mod(k), h: `${k} mod ${m}` }));
        continue;
      }
      const tried: number[] = [];
      let placed = -1;
      for (let i = 0; i < m; i += 1) {
        const j = at(k, i);
        tried.push(j);
        probes += 1;
        if (slots[j].length === 0) {
          placed = j;
          break;
        }
      }
      if (placed < 0) log.push(step('noSlot', { key: k, tried: tried.join(', ') }));
      else {
        slots[placed].push(k);
        log.push(step('probed', { key: k, tried: tried.join(', '), slot: placed }));
      }
    } else if (op.verb === 'search') {
      const found = slots.findIndex((s) => s.includes(k));
      log.push(step(found >= 0 ? 'hashFound' : 'notFound', { key: k, slot: found, path: '—' }));
    } else fail('opFor', { op: op.verb, kind: 'hash' });
  }
  return { slots, log, probes };
}

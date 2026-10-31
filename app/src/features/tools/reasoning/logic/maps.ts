// Argument maps and fault trees. An argument map is an outline: the conclusion first, then lines starting with +
// (supports) or - (objects), indented 2 spaces under what they bear on. A fault tree is a set of gates such as
// `TOP = A AND (B OR G1)`; minimal cut sets come by MOCUS, and the top event's probability is exact by
// inclusion-exclusion for up to 16 cut sets, with the rare-event approximation beyond that.
import { fail, lines } from '../core/util';

export interface Claim {
  text: string;
  kind: 'root' | 'support' | 'objection';
  number: string;
  children: Claim[];
}

export function parseArgument(text: string): Claim {
  const raw = text.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (!raw.length) fail('emptyArgument');
  if (raw.length > 200) fail('argumentLong', { max: 200 });
  const root: Claim = {
    text: raw[0].trim().replace(/^(claim|conclusion|c)\s*:\s*/i, ''),
    kind: 'root',
    number: '1',
    children: [],
  };
  const stack: { claim: Claim; level: number }[] = [{ claim: root, level: 0 }];
  for (const line of raw.slice(1)) {
    const indent = line.replace(/\t/g, '  ').search(/\S/);
    const body = line.trim();
    const m = /^([+-])\s*(.+)$/.exec(body);
    if (!m) fail('argumentLine', { line: body });
    const level = Math.floor(indent / 2) + 1;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent || level > parent.level + 1) fail('argumentIndent', { line: body });
    const claim: Claim = {
      text: m![2],
      kind: m![1] === '+' ? 'support' : 'objection',
      number: `${parent.claim.number}.${parent.claim.children.length + 1}`,
      children: [],
    };
    parent.claim.children.push(claim);
    stack.push({ claim, level });
  }
  return root;
}

export const flatten = (c: Claim): Claim[] => [c, ...c.children.flatMap(flatten)];

/* ---------- Fault trees ---------- */

type Expr = { k: 'event'; name: string } | { k: 'and' | 'or'; items: Expr[] };

function parseExpr(text: string): Expr {
  const toks = text.match(/\(|\)|,|&|\||[A-Za-z_][A-Za-z0-9_]*|\S/g) ?? [];
  let i = 0;
  const or = (): Expr => {
    const items = [and()];
    while (toks[i] && (/^or$/i.test(toks[i]) || toks[i] === '|')) {
      i += 1;
      items.push(and());
    }
    return items.length === 1 ? items[0] : { k: 'or', items };
  };
  const and = (): Expr => {
    const items = [atom()];
    while (toks[i] && (/^and$/i.test(toks[i]) || toks[i] === '&')) {
      i += 1;
      items.push(atom());
    }
    return items.length === 1 ? items[0] : { k: 'and', items };
  };
  const atom = (): Expr => {
    const t = toks[i++];
    if (t === undefined) return fail('gateEnd');
    if (t === '(') {
      const e = or();
      if (toks[i++] !== ')') fail('gateParen');
      return e;
    }
    if (/^(and|or)$/i.test(t) && toks[i] === '(') {
      i += 1;
      const items = [or()];
      while (toks[i] === ',') {
        i += 1;
        items.push(or());
      }
      if (toks[i++] !== ')') fail('gateParen');
      return { k: t.toLowerCase() as 'and' | 'or', items };
    }
    if (/^[A-Za-z_]/.test(t)) return { k: 'event', name: t };
    return fail('gateChar', { c: t });
  };
  const e = or();
  if (i < toks.length) fail('gateChar', { c: toks[i] });
  return e;
}

export interface FaultTree {
  top: string;
  gates: Map<string, Expr>;
  prob: Map<string, number>;
}

/** Gate lines `NAME = expression`, and probability lines `A 0.1`, `A = 0.1`, or `P(A) = 0.1`. The first gate is the top. */
export function parseFaultTree(text: string): FaultTree {
  const gates = new Map<string, Expr>();
  const prob = new Map<string, number>();
  let top: string | null = null;
  for (const line of lines(text)) {
    for (const part of line
      .split(/;/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const p = /^(?:P\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*[=:]?\s*(\d*\.?\d+(?:e-?\d+)?)$/i.exec(part);
      if (p) {
        const v = Number(p[2]);
        if (!(v >= 0 && v <= 1)) fail('probability', { name: p[1] });
        prob.set(p[1], v);
        continue;
      }
      const g = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(part);
      if (!g) fail('gateLine', { line: part });
      gates.set(g![1], parseExpr(g![2]));
      top ??= g![1];
    }
  }
  if (!top) fail('noGates');
  return { top: top!, gates, prob };
}

export const MAX_CUTS = 5000;

/** Minimal cut sets by top-down expansion (MOCUS), each sorted, in order of size. */
export function cutSets(t: FaultTree): string[][] {
  const visiting = new Set<string>();
  const expand = (e: Expr): string[][] => {
    if (e.k === 'event') {
      const g = t.gates.get(e.name);
      if (!g) return [[e.name]];
      if (visiting.has(e.name)) return fail('gateCycle', { name: e.name });
      visiting.add(e.name);
      const out = expand(g);
      visiting.delete(e.name);
      return out;
    }
    const parts = e.items.map(expand);
    if (e.k === 'or') return minimal(parts.flat());
    let acc: string[][] = [[]];
    for (const p of parts) {
      const next: string[][] = [];
      for (const a of acc) for (const b of p) next.push([...new Set([...a, ...b])]);
      if (next.length > MAX_CUTS) fail('cutsBig', { max: MAX_CUTS });
      acc = minimal(next);
    }
    return acc;
  };
  return expand({ k: 'event', name: t.top })
    .map((c) => c.sort())
    .sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

function minimal(sets: string[][]): string[][] {
  const uniq = [...new Map(sets.map((s) => [[...s].sort().join('\u0000'), s])).values()];
  return uniq.filter((s) => !uniq.some((o) => o !== s && o.length < s.length && o.every((x) => s.includes(x))));
}

export const MAX_EXACT = 16;

/** The top event's probability for independent basic events. */
export function topProbability(cuts: readonly string[][], prob: ReadonlyMap<string, number>) {
  for (const c of cuts) for (const e of c) if (!prob.has(e)) fail('noProbability', { name: e });
  const pOf = (events: Iterable<string>) => [...events].reduce((a, e) => a * prob.get(e)!, 1);
  const rare = cuts.reduce((a, c) => a + pOf(c), 0);
  const upper = 1 - cuts.reduce((a, c) => a * (1 - pOf(c)), 1);
  if (cuts.length > MAX_EXACT) return { exact: null, rare, upper };
  let exact = 0;
  for (let m = 1; m < 1 << cuts.length; m += 1) {
    const events = new Set<string>();
    let k = 0;
    cuts.forEach((c, i) => {
      if (m & (1 << i)) {
        k += 1;
        c.forEach((e) => events.add(e));
      }
    });
    exact += (k % 2 ? 1 : -1) * pOf(events);
  }
  return { exact, rare, upper };
}

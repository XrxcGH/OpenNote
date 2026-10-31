// Models. A finite first-order structure has a domain, predicates as sets of tuples, functions as tables, and
// constants; a formula gets its truth and a witness or counterexample for each quantifier. A Kripke model for modal
// logic has its frame closed under the conditions of K, T, S4, or S5.
import { fail, lines } from '../core/util';
import { show } from './formula';
import type { Formula, Term } from './formula';

export interface Structure {
  domain: string[];
  preds: Map<string, Set<string>>;
  fns: Map<string, Map<string, string>>;
  consts: Map<string, string>;
}

const items = (text: string) =>
  text
    .replace(/^\{|\}$/g, '')
    .split(/\)\s*,?\s*\(|,(?![^(]*\))/)
    .map((x) => x.replace(/[()]/g, '').trim())
    .filter(Boolean);

/** Lines such as `domain 1 2 3`, `P = {1, 2}`, `R = {(1,2), (2,3)}`, `f = {1->2, 2->3}`, and `c = 1`. */
export function parseStructure(text: string): Structure {
  const s: Structure = { domain: [], preds: new Map(), fns: new Map(), consts: new Map() };
  for (const line of lines(text)) {
    const d = /^domain\s*[:=]?\s*(.*)$/i.exec(line);
    if (d) {
      s.domain = d[1]
        .replace(/[{}]/g, '')
        .split(/[\s,]+/)
        .filter(Boolean);
      continue;
    }
    const m = /^(\w+)\s*=\s*(.*)$/.exec(line);
    if (!m) fail('structureLine', { line });
    const [, name, body] = m!;
    if (/->|→|↦|:/.test(body)) {
      const table = new Map<string, string>();
      for (const pair of body.replace(/[{}]/g, '').split(/,(?![^(]*\))/)) {
        const p = /^\s*\(?([^)]*?)\)?\s*(?:->|→|↦|:)\s*(\S+?)\s*$/.exec(pair);
        if (!p) fail('structureLine', { line });
        table.set(
          p![1]
            .split(/[\s,]+/)
            .filter(Boolean)
            .join(','),
          p![2],
        );
      }
      s.fns.set(name, table);
    } else if (/^[A-Z]/.test(name))
      s.preds.set(
        name,
        new Set(
          items(body).map((x) =>
            x
              .split(/[\s,]+/)
              .filter(Boolean)
              .join(','),
          ),
        ),
      );
    else s.consts.set(name, body.trim());
  }
  if (s.domain.length === 0) fail('noDomain');
  if (s.domain.length > 200) fail('domainBig', { max: 200 });
  for (const v of s.consts.values()) if (!s.domain.includes(v)) fail('notInDomain', { value: v });
  return s;
}

export interface Explained {
  value: boolean;
  /** Why, for the quantifiers met at the top: the witness or the counterexample. */
  notes: string[];
}

export function holds(s: Structure, f: Formula): Explained {
  const notes: string[] = [];
  let work = 0;
  const term = (t: Term, env: Map<string, string>): string => {
    if (t.k === 'var') {
      const v = env.get(t.name) ?? s.consts.get(t.name);
      if (v === undefined) {
        if (s.domain.includes(t.name)) return t.name;
        return fail('unknownName', { name: t.name });
      }
      return v;
    }
    const table = s.fns.get(t.name) ?? fail('unknownFunction', { name: t.name });
    const key = t.args.map((a) => term(a, env)).join(',');
    return table.get(key) ?? fail('functionGap', { name: t.name, args: key });
  };
  const go = (g: Formula, env: Map<string, string>, depth: number): boolean => {
    if ((work += 1) > 2_000_000) fail('modelWork');
    switch (g.k) {
      case 'top':
        return true;
      case 'bot':
        return false;
      case 'atom': {
        const p = s.preds.get(g.name);
        if (!p) return fail('unknownPredicate', { name: g.name });
        return p.has('') || p.has('true') || p.has('T');
      }
      case 'pred': {
        const p = s.preds.get(g.name) ?? fail('unknownPredicate', { name: g.name });
        return p.has(g.args.map((a) => term(a, env)).join(','));
      }
      case 'eq':
        return term(g.a, env) === term(g.b, env);
      case 'not':
        return !go(g.f, env, depth);
      case 'and':
        return go(g.a, env, depth) && go(g.b, env, depth);
      case 'or':
        return go(g.a, env, depth) || go(g.b, env, depth);
      case 'imp':
        return !go(g.a, env, depth) || go(g.b, env, depth);
      case 'iff':
        return go(g.a, env, depth) === go(g.b, env, depth);
      case 'all':
      case 'some': {
        for (const d of s.domain) {
          const r = go(g.f, new Map(env).set(g.v, d), depth + 1);
          if (r !== (g.k === 'all')) {
            if (depth < 3)
              notes.push(`${g.k}|${g.v}|${d}|${show(g)}|${[...env].map(([k, v]) => `${k} = ${v}`).join(', ')}`);
            return r;
          }
        }
        return g.k === 'all';
      }
      default:
        return fail('notFirstOrder');
    }
  };
  const value = go(f, new Map(), 0);
  return { value, notes };
}

/* ---------- Kripke models ---------- */

export type Frame = 'K' | 'T' | 'S4' | 'S5';

export interface Kripke {
  worlds: string[];
  rel: Set<string>;
  val: Map<string, Set<string>>;
}

const pair = (a: string, b: string) => `${a}\u0000${b}`;

/** Worlds `w1 w2`, arrows `w1 R w2` or `w1 -> w2`, and valuations `w2: p, q`. */
export function parseKripke(worldsText: string, relText: string, valText: string): Kripke {
  const worlds = worldsText.split(/[\s,]+/).filter(Boolean);
  if (!worlds.length) fail('noWorlds');
  if (worlds.length > 100) fail('domainBig', { max: 100 });
  const rel = new Set<string>();
  for (const part of relText
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^(\S+?)\s*(?:R|->|→|\s)\s*(\S+)$/.exec(part);
    if (!m) fail('relationLine', { line: part });
    for (const w of [m![1], m![2]]) if (!worlds.includes(w)) fail('noWorld', { world: w });
    rel.add(pair(m![1], m![2]));
  }
  const val = new Map(worlds.map((w) => [w, new Set<string>()]));
  for (const line of lines(valText)) {
    for (const chunk of line.split(';')) {
      const m = /^\s*(\S+?)\s*:\s*(.*)$/.exec(chunk);
      if (!m) fail('valuationLine', { line: chunk });
      if (!val.has(m![1])) fail('noWorld', { world: m![1] });
      for (const p of m![2].split(/[\s,]+/).filter(Boolean)) val.get(m![1])!.add(p);
    }
  }
  return { worlds, rel, val };
}

/** The relation closed under the frame's conditions: reflexive (T), and transitive (S4), and symmetric (S5). */
export function closeFrame(k: Kripke, frame: Frame): Set<string> {
  const r = new Set(k.rel);
  if (frame === 'K') return r;
  for (const w of k.worlds) r.add(pair(w, w));
  if (frame === 'T') return r;
  if (frame === 'S5') for (const p of [...r]) r.add(p.split('\u0000').reverse().join('\u0000'));
  for (const m of k.worlds)
    for (const a of k.worlds) for (const b of k.worlds) if (r.has(pair(a, m)) && r.has(pair(m, b))) r.add(pair(a, b));
  return r;
}

export function truthAt(k: Kripke, rel: Set<string>, f: Formula): Map<string, boolean> {
  const memo = new Map<string, Map<string, boolean>>();
  const go = (g: Formula): Map<string, boolean> => {
    const key = show(g);
    const hit = memo.get(key);
    if (hit) return hit;
    let out: Map<string, boolean>;
    const each = (fn: (w: string) => boolean) => new Map(k.worlds.map((w) => [w, fn(w)]));
    switch (g.k) {
      case 'atom':
        out = each((w) => k.val.get(w)!.has(g.name));
        break;
      case 'pred':
        if (g.args.length) return fail('notModal');
        out = each((w) => k.val.get(w)!.has(g.name));
        break;
      case 'top':
      case 'bot':
        out = each(() => g.k === 'top');
        break;
      case 'not': {
        const a = go(g.f);
        out = each((w) => !a.get(w));
        break;
      }
      case 'and':
      case 'or':
      case 'imp':
      case 'iff': {
        const a = go(g.a);
        const b = go(g.b);
        const op = {
          and: (x: boolean, y: boolean) => x && y,
          or: (x: boolean, y: boolean) => x || y,
          imp: (x: boolean, y: boolean) => !x || y,
          iff: (x: boolean, y: boolean) => x === y,
        }[g.k];
        out = each((w) => op(a.get(w)!, b.get(w)!));
        break;
      }
      case 'box':
      case 'dia': {
        const a = go(g.f);
        const next = (w: string) => k.worlds.filter((v) => rel.has(pair(w, v)));
        out = each((w) => (g.k === 'box' ? next(w).every((v) => a.get(v)) : next(w).some((v) => a.get(v))));
        break;
      }
      default:
        return fail('notModal');
    }
    memo.set(key, out);
    return out;
  };
  return go(f);
}

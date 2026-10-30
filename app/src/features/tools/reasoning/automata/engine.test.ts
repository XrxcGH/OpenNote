// Automata and grammars: each validation case from the plan with its expected value worked by hand, checks against
// a second method (JavaScript's own regular expressions, brute force over every short string, Catalan numbers), and
// the edge cases each error message covers.
import { describe, expect, it } from 'vitest';
import { KitError } from '../core/util';
import {
  cyk,
  firstFollow,
  leftmost,
  ll1,
  ll1Parse,
  parseGrammar,
  parseTrees,
  slr,
  slrParse,
  toCnf,
  tokensOf,
} from './cfg';
import {
  complement,
  equivalent,
  minimize,
  parseFa,
  product,
  run,
  subset,
  symbolsOfInput,
  thompson,
  toRegex,
} from './fa';
import type { Fa } from './fa';
import { compose, parseFst, parsePda, parseTm, runPda, runTm, tapeText, transduce } from './machines';
import { playPumping } from './pumping';
import { parseRegex, print } from './regex';

const DIV3 = `start r0
accept r0
r0 0 r0
r0 1 r1
r1 0 r2
r1 1 r0
r2 0 r1
r2 1 r2`;

/** Every string over the alphabet up to the length, the empty one first. */
function strings(alphabet: string, max: number): string[] {
  const out = [''];
  for (let i = 0; i < out.length; i += 1) if (out[i].length < max) for (const c of alphabet) out.push(out[i] + c);
  return out;
}

const accepts = (fa: Fa, s: string) => run(fa, symbolsOfInput(s)).accepted;
const jsRegex = (re: string) => new RegExp(`^(?:${re.replace(/ε/g, '(?:)').replace(/∅/g, '[^\\s\\S]')})$`);
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof KitError ? e.key : 'other';
  }
  return 'none';
};

describe('finite automata', () => {
  it('accepts 110 and 0 and rejects 111 with the divisible-by-3 machine', () => {
    const fa = parseFa(DIV3);
    expect(fa.states).toHaveLength(3);
    expect(accepts(fa, '110')).toBe(true);
    expect(accepts(fa, '0')).toBe(true);
    expect(accepts(fa, '111')).toBe(false);
    for (const s of strings('01', 9).slice(1)) expect(accepts(fa, s), s).toBe(parseInt(s, 2) % 3 === 0);
  });

  it('builds 11 Thompson states, 5 subset states, and 4 minimal states for (a|b)*abb', () => {
    const nfa = thompson(parseRegex('(a|b)*abb'));
    expect(nfa.states).toHaveLength(11);
    const { dfa, rows } = subset(nfa);
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.accept)).toHaveLength(1);
    const min = minimize(dfa);
    expect(min.dfa.states).toHaveLength(4);
    const js = /^(a|b)*abb$/;
    for (const s of strings('ab', 8)) {
      expect(accepts(nfa, s), s).toBe(js.test(s));
      expect(accepts(min.dfa, s), s).toBe(js.test(s));
    }
  });

  it('agrees with JavaScript on +, ?, ε, and escapes', () => {
    for (const re of ['a+b?', '(ab|ε)*a', 'a(b|c)*c+', '(a|bc)?b*']) {
      const fa = thompson(parseRegex(re));
      const js = new RegExp(`^(?:${re.replace(/ε/g, '')})$`);
      for (const s of strings('abc', 6)) expect(accepts(fa, s), `${re} ${s}`).toBe(js.test(s));
    }
    expect(accepts(thompson(parseRegex('a\\*')), 'a*')).toBe(true);
  });

  it('turns a machine back into an expression for the same language', () => {
    for (const re of ['(a|b)*abb', 'a*b*', '(ab)*|b']) {
      const back = toRegex(minimize(thompson(parseRegex(re))).dfa).re;
      const js = jsRegex(print(back));
      const orig = new RegExp(`^(?:${re})$`);
      for (const s of strings('ab', 8)) expect(js.test(s), `${re} → ${print(back)} on ${s}`).toBe(orig.test(s));
      expect(equivalent(thompson(back), thompson(parseRegex(re))).equal).toBe(true);
    }
    expect(print(toRegex(parseFa(DIV3)).re)).toMatch(/0/);
  });

  it('finds equal languages and a shortest string that tells others apart', () => {
    expect(equivalent(thompson(parseRegex('(a|b)*')), thompson(parseRegex('(a*b*)*'))).equal).toBe(true);
    const r = equivalent(thompson(parseRegex('a*')), thompson(parseRegex('a+')));
    expect(r).toEqual({ equal: false, witness: '', first: true });
    const r2 = equivalent(thompson(parseRegex('(a|b)*abb')), thompson(parseRegex('(a|b)*bb')));
    expect(r2.equal).toBe(false);
    if (!r2.equal) expect(r2.witness).toBe('bb');
  });

  it('builds products and complements that match brute force', () => {
    const a = parseFa(DIV3);
    const even = thompson(parseRegex('((0|1)(0|1))*'));
    const tests: [string, (x: boolean, y: boolean) => boolean][] = [
      ['union', (x, y) => x || y],
      ['intersection', (x, y) => x && y],
      ['difference', (x, y) => x && !y],
    ];
    for (const [op, fn] of tests) {
      const p = product(a, even, op as 'union');
      for (const s of strings('01', 7)) expect(accepts(p, s), `${op} ${s}`).toBe(fn(accepts(a, s), accepts(even, s)));
    }
    const c = complement(a);
    for (const s of strings('01', 7)) expect(accepts(c, s)).toBe(!accepts(a, s));
  });

  it('drops unreachable states and fills in a dead state when minimizing', () => {
    const fa = parseFa('start p\naccept q\np a q\nq a q\nz a p');
    const m = minimize(fa);
    expect(m.removed).toEqual(['z']);
    expect(m.dfa.states).toHaveLength(2);
  });

  it('words bad machines and expressions', () => {
    expect(codeOf(() => parseFa(''))).toBe('emptyMachine');
    expect(codeOf(() => parseFa('p q'))).toBe('faLine');
    expect(codeOf(() => parseFa('p ab q'))).toBe('symbolLength');
    expect(codeOf(() => parseRegex('(ab'))).toBe('regexParen');
    expect(codeOf(() => parseRegex('*a'))).toBe('regexAt');
    expect(codeOf(() => parseRegex('  '))).toBe('regexEmpty');
    expect(accepts(parseFa('start p\np a p'), '')).toBe(false);
  });
});

describe('grammars', () => {
  const CNF = 'S -> AB | BC\nA -> BA | a\nB -> CC | b\nC -> AB | a';
  const EXPR = "E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id";
  const LR = 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';

  it('accepts baaba by CYK with S in the top cell', () => {
    const g = parseGrammar(CNF);
    expect(g.prods).toHaveLength(8);
    const r = cyk(toCnf(g).cnf, tokensOf(g, 'baaba'));
    expect(r.accepted).toBe(true);
    expect(r.table[4][0]).toContain('S');
    // The textbook table: the bottom row is B, A C, A C, B, A C.
    expect(r.table[0]).toEqual([['B'], ['A', 'C'], ['A', 'C'], ['B'], ['A', 'C']]);
  });

  it('gives FIRST and FOLLOW for the expression grammar and an LL(1) table with no conflicts', () => {
    const g = parseGrammar(EXPR);
    const { first, follow, nullable } = firstFollow(g);
    expect([...first.get('E')!].sort()).toEqual(['(', 'id']);
    expect([...follow.get('E')!].sort()).toEqual(['$', ')']);
    expect([...follow.get('T')!].sort()).toEqual(['$', ')', '+']);
    expect([...follow.get('F')!].sort()).toEqual(['$', ')', '*', '+']);
    expect([...nullable].sort()).toEqual(["E'", "T'"]);
    const t = ll1(g);
    expect(t.conflicts).toEqual([]);
    expect(ll1Parse(g, t, tokensOf(g, 'id+id*id')).ok).toBe(true);
    expect(ll1Parse(g, t, tokensOf(g, 'id + * id')).ok).toBe(false);
  });

  it('builds the 12 LR(0) states of the expression grammar and parses by SLR', () => {
    const g = parseGrammar(LR);
    const lr = slr(g);
    expect(lr.states).toHaveLength(12);
    expect(lr.conflicts).toEqual([]);
    expect(slrParse(lr, tokensOf(g, 'id * id + id')).ok).toBe(true);
    expect(slrParse(lr, tokensOf(g, '( id')).ok).toBe(false);
    expect(ll1(g).conflicts.length).toBeGreaterThan(0);
  });

  it('counts Catalan-many parse trees for an ambiguous grammar', () => {
    const g = parseGrammar('E -> E + E | id');
    const catalan = [1, 1, 2, 5, 14, 42];
    for (let n = 1; n <= 6; n += 1) {
      const input = Array.from({ length: n }, () => 'id').join(' + ');
      expect(parseTrees(g, tokensOf(g, input)).count, input).toBe(catalan[n - 1]);
    }
    expect(slr(g).conflicts.length).toBeGreaterThan(0);
    const two = parseTrees(parseGrammar('E -> E + E | E * E | id'), ['id', '+', 'id', '*', 'id']);
    expect(two.count).toBe(2);
    expect(two.trees).toHaveLength(2);
  });

  it('agrees on membership by CYK after normal form and by parse trees', () => {
    const balanced = (s: string) => {
      let d = 0;
      for (const c of s) if ((d += c === 'a' ? 1 : -1) < 0) return false;
      return d === 0;
    };
    const g = parseGrammar('S -> aSb | SS | ε');
    const { cnf, stages } = toCnf(g);
    expect(stages.map((s) => s.key)).toEqual(['start', 'term', 'bin', 'del', 'unit']);
    for (const s of strings('ab', 8)) {
      const tokens = tokensOf(g, s);
      expect(cyk(cnf, tokens).accepted, s).toBe(balanced(s));
      expect(parseTrees(g, tokens).count > 0, s).toBe(balanced(s));
      for (const p of cnf.prods)
        expect(p.rhs.length === 0 ? p.lhs === cnf.start : p.rhs.length <= 2, JSON.stringify(p)).toBe(true);
    }
  });

  it('writes the leftmost derivation from a parse tree', () => {
    const g = parseGrammar('S -> aSb | ε');
    const { trees } = parseTrees(g, tokensOf(g, 'aabb'));
    expect(leftmost(g, trees[0])).toEqual(['S', 'a S b', 'a a S b b', 'a a b b']);
  });

  it('words bad grammars', () => {
    expect(codeOf(() => parseGrammar(''))).toBe('emptyGrammar');
    expect(codeOf(() => parseGrammar('S = a'))).toBe('grammarLine');
  });
});

describe('machines with memory', () => {
  it('increments 1011 to 1100 and halts', () => {
    const tm = parseTm(`start q0
accept qh
q0 0 q0 0 R
q0 1 q0 1 R
q0 _ q1 _ L
q1 1 q1 0 L
q1 0 qh 1 S
q1 _ qh 1 S`);
    const r = runTm(tm, [...'1011']);
    expect(r.end).toBe('accept');
    expect(tapeText(tm, r.final)).toBe('1100');
    expect(tapeText(tm, runTm(tm, [...'111']).final)).toBe('1000');
    const loop = parseTm('start q\nq _ q _ R');
    expect(runTm(loop, [], 500).end).toBe('limit');
  });

  it('runs a nondeterministic pushdown automaton for a^n b^n', () => {
    const pda = parsePda(`start q0
accept q2
q0 a Z -> q0 AZ
q0 a A -> q0 AA
q0 ε Z -> q1 Z
q0 ε A -> q1 A
q1 b A -> q1 ε
q1 ε Z -> q2 Z`);
    for (const s of strings('ab', 8)) {
      const ok = /^a*b*$/.test(s) && s.split('a').length === s.split('b').length;
      expect(runPda(pda, [...s], false).accepted, s).toBe(ok);
    }
    expect(runPda(pda, [...'aabb'], false).path.at(-1)).toEqual({ state: 'q2', pos: 4, stack: 'Z' });
  });

  it('transduces with e-insertion and composes two transducers', () => {
    const plural = parseFst(`start q0
final q3
q0 a:a q0
q0 b:b q0
q0 x:x q1
q0 +:ε q2
q1 a:a q0
q1 b:b q0
q1 x:x q1
q1 +:e q2
q2 s:s q3`);
    expect(transduce(plural, [...'bax+s']).outputs).toEqual(['baxes']);
    expect(transduce(plural, [...'ba+s']).outputs).toEqual(['bas']);
    const sound = parseFst('start p\nfinal p\np a:a p\np b:p p\np x:ks p\np e:e p\np s:s p');
    const both = compose(plural, sound);
    for (const w of ['bax+s', 'ba+s', 'xx+s', 'b+x']) {
      const once = transduce(plural, [...w]).outputs.flatMap((o) => transduce(sound, [...o]).outputs);
      expect(transduce(both, [...w]).outputs, w).toEqual([...new Set(once)].sort());
    }
    expect(transduce(both, [...'bax+s']).outputs).toEqual(['pakses']);
  });

  it('plays the pumping game', () => {
    expect(playPumping('anbn', 'regular', 3, 'aaabbb').survivor).toBeNull();
    expect(playPumping('anbn', 'cfl', 2, 'aabb').survivor).not.toBeNull();
    expect(playPumping('anbncn', 'cfl', 2, 'aabbcc').survivor).toBeNull();
    expect(playPumping('palindrome', 'regular', 2, 'aabaa').survivor).toBeNull();
    expect(codeOf(() => playPumping('anbn', 'regular', 3, 'aabbb'))).toBe('pumpNotIn');
    expect(codeOf(() => playPumping('anbn', 'regular', 9, 'aabb'))).toBe('pumpShort');
    expect(codeOf(() => playPumping('anbn', 'regular', 0, 'ab'))).toBe('pumpLength');
  });
});

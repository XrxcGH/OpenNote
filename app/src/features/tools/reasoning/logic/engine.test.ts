// The logic workbench: each validation case from the plan with its expected value worked by hand, second methods
// (truth tables against normal forms, resolution against DPLL, counts of the classical valid forms), and the edge
// cases each error message covers.
import { describe, expect, it } from 'vitest';
import { KitError, seeded } from '../core/util';
import { evaluate, letters, parseFormula, show } from './formula';
import type { Formula } from './formula';
import { boolean, numeral, parseProgram, print, reduce } from './lambda';
import { cutSets, flatten, parseArgument, parseFaultTree, topProbability } from './maps';
import { closeFrame, holds, parseKripke, parseStructure, truthAt } from './models';
import { classify, normalForm, truthTable } from './normal';
import { checkProof } from './proof';
import { dpll, resolution } from './sat';
import { formStatements, judge, parseStatement, vennFigure } from './syllogism';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof KitError ? e.key : 'other';
  }
  return 'none';
};

describe('formulas and truth tables', () => {
  it('finds ((p -> q) and (q -> r)) -> (p -> r) true in all 8 rows', () => {
    const f = parseFormula('((p -> q) and (q -> r)) -> (p -> r)');
    const t = truthTable([f]);
    expect(t.rows).toHaveLength(8);
    expect(classify(t)).toBe('tautology');
    expect(classify(truthTable([parseFormula('p & ~p')]))).toBe('contradiction');
    expect(classify(truthTable([parseFormula('p | q')]))).toBe('contingent');
  });

  it('reads words and symbols alike, with the usual precedence', () => {
    expect(show(parseFormula('not p and q or r implies s iff t'))).toBe('((¬p ∧ q) ∨ r → s) ↔ t');
    expect(show(parseFormula('p -> q -> r'))).toBe('p → q → r');
    expect(show(parseFormula('(p -> q) -> r'))).toBe('(p → q) → r');
    expect(show(parseFormula('~(p /\\ q) <-> ~p \\/ ~q'))).toBe('¬(p ∧ q) ↔ ¬p ∨ ¬q');
    expect(show(parseFormula('forall x (Fx -> exists y Rxy)'))).toBe('∀x (Fx → ∃y Rxy)');
    expect(show(parseFormula('a = b & f(a) != c'))).toBe('a = b ∧ f(a) ≠ c');
    expect(codeOf(() => parseFormula('p ->'))).toBe('unexpectedEnd');
    expect(codeOf(() => parseFormula('(p'))).toBe('expected');
    expect(codeOf(() => parseFormula('p $ q'))).toBe('badChar');
    expect(codeOf(() => parseFormula(''))).toBe('emptyFormula');
  });

  it('gives the CNF (p ∨ r) ∧ (q ∨ r) for (p and q) or r', () => {
    const r = normalForm(parseFormula('(p and q) or r'), true);
    expect(r.text).toBe('(p ∨ r) ∧ (q ∨ r)');
    expect(normalForm(parseFormula('(p or q) and r'), false).text).toBe('(p ∧ r) ∨ (q ∧ r)');
  });

  it('keeps every normal form equivalent to its formula on every row', () => {
    const rand = seeded(11);
    const atoms = ['p', 'q', 'r', 's'];
    const gen = (d: number): string => {
      if (d === 0 || rand() < 0.2) return atoms[Math.floor(rand() * 4)];
      const ops = ['&', '|', '->', '<->'];
      return rand() < 0.2 ? `~(${gen(d - 1)})` : `(${gen(d - 1)} ${ops[Math.floor(rand() * 4)]} ${gen(d - 1)})`;
    };
    for (let k = 0; k < 40; k += 1) {
      const f = parseFormula(gen(4));
      for (const cnf of [true, false]) {
        const nf = parseFormula(normalForm(f, cnf).text.replace(/⊤/g, 'true').replace(/⊥/g, 'false'));
        const t = truthTable([f, nf]);
        for (const row of t.rows) expect(row.results[1], `${show(f)} ${cnf}`).toBe(row.results[0]);
      }
    }
  });
});

describe('natural deduction', () => {
  it('accepts ¬p from p → q and ¬q by modus tollens, and rejects modus ponens there', () => {
    const good = checkProof('1. p -> q  premise\n2. ~q  premise\n3. ~p  MT 1, 2');
    expect(good.ok).toBe(true);
    const badProof = checkProof('1. p -> q  premise\n2. ~q  premise\n3. ~p  MP 1, 2');
    expect(badProof.ok).toBe(false);
    expect(badProof.problems[2]?.key).toBe('rule_impE');
  });

  it('checks subproofs, conditional proof, and reach', () => {
    const cp = checkProof(`1. p -> q  premise
2. q -> r  premise
3. | p  assumption
4. | q  ->E 1, 3
5. | r  ->E 2, 4
6. p -> r  ->I 3-5`);
    expect(cp.ok).toBe(true);
    const out = checkProof(`1. p  premise
2. | q  assumption
3. | p & q  &I 1, 2
4. q  R 2`);
    expect(out.problems[3]?.key).toBe('notAccessible');
    const neg = checkProof(`1. p -> q  premise
2. p -> ~q  premise
3. | p  as
4. | q  ->E 1, 3
5. | ~q  ->E 2, 3
6. | ⊥  ~E 4, 5
7. ~p  ~I 3-6`);
    expect(neg.ok).toBe(true);
    const cases = checkProof(`1. p | q  premise
2. | p  as
3. | q | p  orI 2
4. | q  as
5. | q | p  orI 4
6. q | p  orE 1, 2-3, 4-5`);
    expect(cases.ok).toBe(true);
  });

  it('enforces the scope rules for ∀I and ∃E', () => {
    const ok = checkProof(`1. forall x (Fx -> Gx)  premise
2. forall x Fx  premise
3. Fa -> Ga  ∀E 1
4. Fa  ∀E 2
5. Ga  ->E 3, 4
6. forall x Gx  ∀I 5`);
    expect(ok.ok).toBe(true);
    const badGen = checkProof(`1. Fa  premise
2. forall x Fx  ∀I 1`);
    expect(badGen.problems[1]?.key).toBe('allIScope');
    const ex = checkProof(`1. exists x Fx  premise
2. forall x (Fx -> Gx)  premise
3. | Fa  as
4. | Fa -> Ga  ∀E 2
5. | Ga  ->E 4, 3
6. | exists x Gx  ∃I 5
7. exists x Gx  ∃E 1, 3-6`);
    expect(ex.ok).toBe(true);
    const leak = checkProof(`1. exists x Fx  premise
2. | Fa  as
3. | Fa  R 2
4. Fa  ∃E 1, 2-3`);
    expect(leak.problems[3]?.key).toBe('someEScope');
    const eq = checkProof(`1. a = b  premise
2. Fa  premise
3. Fb  =E 1, 2
4. a = a  =I`);
    expect(eq.ok).toBe(true);
  });

  it('words lines it cannot read', () => {
    expect(codeOf(() => checkProof(''))).toBe('emptyProof');
    expect(codeOf(() => checkProof('1. p  frobnicate'))).toBe('noRule');
    expect(checkProof('1. | p  premise').ok).toBe(true);
    expect(checkProof('1. p  premise\n2. q  MP 1, 7').problems[1]?.key).toBe('noSuchLine');
  });
});

describe('syllogisms', () => {
  const st = (a: string, b: string, c: string, imp = false) =>
    judge(parseStatement(a), parseStatement(b), parseStatement(c), imp);

  it('finds AAA-1 (Barbara) valid and AAA-2 invalid by undistributed middle', () => {
    const barbara = st('All mammals are animals', 'All dogs are mammals', 'All dogs are animals');
    expect(barbara.form).toBe('AAA-1');
    expect(barbara.valid).toBe(true);
    expect(barbara.name).toBe('Barbara');
    const aaa2 = st('All cats are mammals', 'All dogs are mammals', 'All dogs are cats');
    expect(aaa2.form).toBe('AAA-2');
    expect(aaa2.broken).toEqual(['undistributedMiddle']);
  });

  it('counts 15 valid forms without existential import and 24 with it', () => {
    const moods = ['A', 'E', 'I', 'O'];
    const count = (imp: boolean) => {
      let n = 0;
      for (const a of moods)
        for (const b of moods)
          for (const c of moods)
            for (let fig = 1; fig <= 4; fig += 1) {
              const [x, y, z] = formStatements(`${a}${b}${c}-${fig}`);
              if (judge(x, y, z, imp).valid) n += 1;
            }
      return n;
    };
    expect(count(false)).toBe(15);
    expect(count(true)).toBe(24);
  });

  it('shades and marks the Venn diagram regions', () => {
    const [x, y, z] = formStatements('AAA-1');
    const v = judge(x, y, z, false);
    const fig = vennFigure(x, y, v.terms);
    // S is bit 1, P bit 2, M bit 4: All M are P empties M without P (4, 5); All S are M empties S without M (1, 3).
    expect(fig.shaded).toEqual([1, 3, 4, 5]);
    expect(codeOf(() => parseStatement('Most dogs bark'))).toBe('statement');
  });
});

describe('models', () => {
  it('evaluates first-order formulas on a finite structure', () => {
    const s = parseStructure('domain 1 2 3\nR = {(1,2), (2,3), (3,1)}\nP = {1, 2}\nf = {1->2, 2->3, 3->1}\nc = 1');
    expect(holds(s, parseFormula('forall x exists y R(x, y)')).value).toBe(true);
    expect(holds(s, parseFormula('forall x P(x)')).value).toBe(false);
    expect(holds(s, parseFormula('forall x R(x, f(x))')).value).toBe(true);
    expect(holds(s, parseFormula('P(c) & f(f(c)) = 3')).value).toBe(true);
    expect(codeOf(() => holds(s, parseFormula('Q(c)')))).toBe('unknownPredicate');
  });

  it('gives ◇p and □p true at w1 in K, and □p false there once T makes the frame reflexive', () => {
    const k = parseKripke('w1 w2', 'w1 R w2', 'w2: p');
    const dia = parseFormula('<>p');
    const box = parseFormula('[]p');
    expect(truthAt(k, closeFrame(k, 'K'), dia).get('w1')).toBe(true);
    expect(truthAt(k, closeFrame(k, 'K'), box).get('w1')).toBe(true);
    expect(truthAt(k, closeFrame(k, 'T'), box).get('w1')).toBe(false);
    expect(truthAt(k, closeFrame(k, 'S5'), box).get('w2')).toBe(false);
  });
});

describe('resolution and DPLL', () => {
  it('refutes premises with the negated goal and agrees with DPLL and truth tables', () => {
    const cnf = (text: string) => normalForm(parseFormula(text), true).clauses;
    const r = resolution(cnf('(p -> q) & p & ~q'));
    expect(r.refuted).toBe(true);
    expect(r.all[r.proof.at(-1)!].clause).toEqual([]);
    const rand = seeded(5);
    for (let k = 0; k < 30; k += 1) {
      const clauses = Array.from({ length: 2 + Math.floor(rand() * 5) }, () =>
        Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({
          name: 'pqrs'[Math.floor(rand() * 4)],
          neg: rand() < 0.5,
        })),
      );
      const text = clauses.map((c) => `(${c.map((l) => (l.neg ? '~' : '') + l.name).join(' | ')})`).join(' & ');
      const f: Formula = parseFormula(text);
      const sat = truthTable([f]).rows.some((row) => row.results[0]);
      expect(dpll(clauses).sat, text).toBe(sat);
      expect(resolution(clauses).refuted, text).toBe(!sat);
      const model = dpll(clauses).model;
      if (model) expect(evaluate(f, (n) => model.get(n) ?? false)).toBe(true);
    }
    expect(letters(parseFormula('p & q | p'))).toEqual(['p', 'q']);
  });
});

describe('lambda calculus', () => {
  it('reduces (\\x. x x)(\\y. y) to \\y. y', () => {
    const r = reduce(parseProgram('(\\x. x x)(\\y. y)'), 100);
    expect(r.normal).toBe(true);
    expect(print(r.terms.at(-1)!)).toBe('λy. y');
    expect(r.steps).toBe(2);
  });

  it('adds and multiplies Church numerals, and stops a loop at the limit', () => {
    expect(numeral(reduce(parseProgram('plus 2 3'), 1000).terms.at(-1)!)).toBe(5);
    expect(numeral(reduce(parseProgram('times 3 4'), 1000).terms.at(-1)!)).toBe(12);
    expect(numeral(reduce(parseProgram('pred 3'), 1000).terms.at(-1)!)).toBe(2);
    expect(boolean(reduce(parseProgram('iszero 0'), 1000).terms.at(-1)!)).toBe(true);
    expect(boolean(reduce(parseProgram('and true false'), 1000).terms.at(-1)!)).toBe(false);
    expect(reduce(parseProgram('omega'), 50).normal).toBe(false);
    const two = parseProgram('double = \\n. plus n n\ndouble 3');
    expect(numeral(reduce(two, 1000).terms.at(-1)!)).toBe(6);
  });

  it('renames a binder rather than capture a free name', () => {
    const r = reduce(parseProgram('(\\x y. x) y'), 10);
    expect(print(r.terms.at(-1)!)).toBe('λy′. y');
    expect(codeOf(() => parseProgram('\\. x'))).toBe('lambdaBinder');
  });
});

describe('argument maps and fault trees', () => {
  it('numbers an outline of supports and objections', () => {
    const root = parseArgument(
      'Claim: Build the park.\n+ Children need space.\n  + Two schools are near.\n- It costs too much.',
    );
    const all = flatten(root);
    expect(all.map((c) => `${c.number} ${c.kind}`)).toEqual([
      '1 root',
      '1.1 support',
      '1.1.1 support',
      '1.2 objection',
    ]);
    expect(codeOf(() => parseArgument('A\n    + skipped a level'))).toBe('argumentIndent');
  });

  it('gives cut sets {A, B} and {A, C} and P(top) 0.044 for A AND (B OR C)', () => {
    const t = parseFaultTree('top = A AND (B OR C)\nA 0.1\nB 0.2\nC 0.3');
    const cuts = cutSets(t);
    expect(cuts).toEqual([
      ['A', 'B'],
      ['A', 'C'],
    ]);
    const p = topProbability(cuts, t.prob);
    expect(p.exact).toBeCloseTo(0.044, 12);
    // Checked by the formula P(A) (1 − (1 − P(B)) (1 − P(C))).
    expect(p.exact).toBeCloseTo(0.1 * (1 - 0.8 * 0.7), 12);
    const nested = cutSets(parseFaultTree('T = OR(G1, D)\nG1 = AND(A, B)\nD = OR(A, E) & B'));
    expect(nested).toEqual([
      ['A', 'B'],
      ['B', 'E'],
    ]);
    expect(codeOf(() => cutSets(parseFaultTree('T = G\nG = T')))).toBe('gateCycle');
  });
});

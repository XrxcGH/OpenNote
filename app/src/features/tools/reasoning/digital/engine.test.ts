// Digital logic design: each validation case from the plan with its expected value worked by hand, plus the edge
// cases each error message covers.
import { describe, expect, it } from 'vitest';
import { KitError } from '../core/util';
import { dynamicPower, elmore, logicalEffort, parseRcTree } from './cmos';
import { design } from './design';
import { counter, detector, minimizeMachine, parseMachine, run, symbolsOf } from './fsm';
import { evalBool, mintermsOf, parseBool, showBool, varsOf } from './expr';
import { simulate, twoLevel } from './gates';
import { maxterms, minimize, sumText, termText } from './qm';

const ABCD = ['A', 'B', 'C', 'D'];
const errorKey = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    if (e instanceof KitError) return e.key;
    throw e;
  }
  throw new Error('No error was raised.');
};

describe('Boolean expressions', () => {
  it('read primes, juxtaposition, symbols, and words with the usual precedence', () => {
    const e = parseBool("A'B + C ^ D NAND 1");
    expect(varsOf(e)).toEqual(ABCD);
    expect(showBool(parseBool("(A + B)'C"))).toBe("(A + B)'·C");
    expect(evalBool(parseBool('A and not B or C'), { A: 1, B: 0, C: 0 })).toBe(1);
    expect(mintermsOf(parseBool('A ⊕ B'), ['A', 'B'])).toEqual([1, 2]);
  });

  it('say what is wrong with text that is not an expression', () => {
    expect(errorKey(() => parseBool(''))).toBe('empty');
    expect(errorKey(() => parseBool('A + (B'))).toBe('unclosed');
    expect(errorKey(() => parseBool('A + $'))).toBe('badChar');
    expect(errorKey(() => parseBool('A +'))).toBe('endEarly');
  });
});

describe('Quine-McCluskey minimization', () => {
  it('finds the primes and the unique minimal SOP of sum m(0, 1, 2, 5, 6, 7, 8, 9, 10, 14)', () => {
    const result = minimize(4, [0, 1, 2, 5, 6, 7, 8, 9, 10, 14]);
    expect(result.primes.map((p) => termText(p, ABCD)).sort()).toEqual(
      ["A'BC", "A'BD", "A'C'D", "B'C'", "B'D'", "CD'"].sort(),
    );
    expect(result.covers).toHaveLength(1);
    const cover = result.covers[0].map((c) => termText(c, ABCD));
    expect(cover.sort()).toEqual(["A'BD", "B'C'", "CD'"].sort());
    expect(cover.join('').replace(/'/g, '').length).toBe(7);
  });

  it('reads a 3-variable map of sum m(1, 3, 5, 7) as f = C', () => {
    const result = minimize(3, [1, 3, 5, 7]);
    expect(result.covers[0].map((c) => termText(c, ['A', 'B', 'C']))).toEqual(['C']);
  });

  it('uses don’t cares and lists every minimal cover', () => {
    // f = sum m(1, 3, 7, 11, 15) + d(0, 2, 5): CD + A'B' and CD + A'D are both minimal.
    const result = minimize(4, [1, 3, 7, 11, 15], [0, 2, 5]);
    const texts = result.covers.map((cover) =>
      cover
        .map((c) => termText(c, ABCD))
        .sort()
        .join(' + '),
    );
    expect(texts.sort()).toEqual(["A'B' + CD", "A'D + CD"].sort());
  });

  it('gives a minimal POS from the maxterms', () => {
    const offs = maxterms(3, [1, 3, 5, 7], []);
    const pos = minimize(3, offs).covers[0].map((c) => sumText(c, ['A', 'B', 'C']));
    expect(pos).toEqual(['C']);
  });

  it('handles constant functions and checks the terms', () => {
    expect(minimize(2, []).covers).toEqual([[]]);
    expect(termText(minimize(2, [0, 1, 2, 3]).covers[0][0], ['A', 'B'])).toBe('1');
    expect(errorKey(() => minimize(7, [0]))).toBe('varCount');
    expect(errorKey(() => minimize(3, [8]))).toBe('termRange');
    expect(errorKey(() => minimize(3, [1], [1]))).toBe('termTwice');
  });
});

describe('gate-level circuits', () => {
  it('builds two-level NAND and NOR forms and counts the gates', () => {
    const sop = minimize(3, [3, 5, 6, 7]).covers[0];
    const nand = twoLevel(sop, ['A', 'B', 'C'], 'NAND');
    expect(nand.text).toBe('NAND(NAND(A, B), NAND(A, C), NAND(B, C))');
    expect(nand.gates).toBe(4);
    const pos = minimize(3, maxterms(3, [1, 3, 5, 7], [])).covers[0];
    expect(twoLevel(pos, ['A', 'B', 'C'], 'NOR')).toEqual({ text: 'C', gates: 0 });
    const xor = minimize(2, maxterms(2, [1, 2], [])).covers[0];
    expect(twoLevel(xor, ['A', 'B'], 'NOR').text).toBe('NOR(NOR(A, B), NOR(NOR(A, A), NOR(B, B)))');
  });

  it("shows the static-1 hazard of AB + A'C when A falls", () => {
    const e = parseBool("AB + A'C");
    // A B C = 111 then 011: the output should stay 1 but dips for one gate delay.
    const sim = simulate(e, ['A', 'B', 'C'], [0b111, 0b011], 1, 6);
    expect(sim.output.slice(0, 6).every((v) => v === 1)).toBe(true);
    expect(sim.output.slice(6)).toContain(0);
    expect(sim.glitches).toEqual([1]);
    const fixed = simulate(parseBool("AB + A'C + BC"), ['A', 'B', 'C'], [0b111, 0b011], 1, 6);
    expect(fixed.glitches).toEqual([]);
  });
});

describe('finite-state machines', () => {
  it('builds the overlapping Mealy detector for 101 with 3 states', () => {
    const m = detector('101', true, 'mealy');
    expect(m.states).toHaveLength(3);
    expect(run(m, symbolsOf(m, '10101')).outputs.join('')).toBe('00101');
    expect(run(detector('101', false, 'mealy'), [...'10101']).outputs.join('')).toBe('00100');
    const moore = detector('101', true, 'moore');
    expect(moore.states).toHaveLength(4);
    expect(run(moore, [...'10101']).outputs.join('')).toBe('00101');
  });

  it('reads a table, merges equivalent states, and designs D flip-flop equations', () => {
    const m = parseMachine('A: 0 -> B / 0, 1 -> C / 0\nB: 0 -> B / 0, 1 -> A / 1\nC: 0 -> B / 0, 1 -> A / 1');
    const { machine, blocks } = minimizeMachine(m);
    expect(blocks).toEqual([['A'], ['B', 'C']]);
    expect(machine.states).toEqual(['A', 'B']);
    const d = design(detector('101', true, 'mealy'), 'binary', 'D');
    expect(d.codes).toEqual({ S0: '00', S1: '01', S2: '10' });
    const eq = Object.fromEntries(d.equations.map((e) => [e.name, e.sop]));
    expect(eq.D1).toBe("Q0·X'");
    expect(eq.D0).toBe('X');
    expect(eq.Z).toBe('Q1·X');
  });

  it('designs a 2-bit up counter with T flip-flops', () => {
    const d = design(counter('up', 2), 'named', 'T');
    const eq = Object.fromEntries(d.equations.map((e) => [e.name, e.sop]));
    expect(eq.T0).toBe('X');
    expect(eq.T1).toBe('Q0·X');
    expect(counter('johnson', 3).states).toEqual(['000', '100', '110', '111', '011', '001']);
  });

  it('says what is wrong with a table', () => {
    expect(errorKey(() => parseMachine('A: 0 -> B / 0'))).toBe('fsmUnknown');
    expect(errorKey(() => parseMachine('A: 0 -> A / 0\nB: 1 -> A / 0'))).toBe('fsmMissing');
    expect(errorKey(() => parseMachine('A: 0 -> A'))).toBe('fsmNoOutput');
    expect(errorKey(() => detector('12', true, 'mealy'))).toBe('pattern');
  });
});

describe('CMOS timing and power', () => {
  it('gives 3 ns for a two-stage RC ladder of 1 kΩ and 1 pF, and 0.1 W of switching power', () => {
    const tree = parseRcTree('n1 in 1 1\nn2 n1 1 1');
    expect(elmore(tree, 'n2').tau).toBeCloseTo(3, 12);
    expect(elmore(tree, 'n1').tau).toBeCloseTo(2, 12);
    expect(dynamicPower(0.1, 1e-9, 1, 1e9)).toBeCloseTo(0.1, 12);
  });

  it('sizes a path by logical effort', () => {
    // Three inverters driving 64 times their input: F = 64, stage effort 4, delay 3 * 4 + 3 = 15.
    const e = logicalEffort([1, 1, 1], [1, 1, 1], [], 1, 64);
    expect(e.stageEffort).toBeCloseTo(4, 12);
    expect(e.delay).toBeCloseTo(15, 12);
    expect(e.sizes.map((s) => Number(s.toFixed(9)))).toEqual([1, 4, 16]);
  });

  it('rejects trees with loops or unknown parents', () => {
    expect(errorKey(() => parseRcTree('a b 1 1\nb a 1 1'))).toBe('rcLoop');
    expect(errorKey(() => parseRcTree('a x 1 1'))).toBe('rcParent');
    expect(errorKey(() => dynamicPower(2, 1, 1, 1))).toBe('alpha');
  });
});

// Typed inputs that students write as the help lines suggest: percents, nested decisions, utility answers, and the
// notes that say when a tie was broken by input order. Expected values are worked by hand in each comment.
import { describe, expect, it } from 'vitest';
import { loadTool } from '../kit';
import type { ReasoningToolId } from '../meta';
import type { Field, Mode, Outcome, Values } from './types';

async function solve(tool: ReasoningToolId, mode: string, values: Values): Promise<Outcome> {
  const spec = await loadTool(tool);
  const m = spec.modes.find((x) => x.id === mode) as Mode;
  const out: Record<string, string> = { ...values };
  for (let pass = 0; pass < 3; pass += 1) {
    const fields: readonly Field[] = typeof m.fields === 'function' ? m.fields(out) : m.fields;
    for (const f of fields) if (out[f.id] === undefined) out[f.id] = f.initial ?? f.options?.[0] ?? '';
  }
  return m.solve(out);
}

const answer = (o: Outcome) => (o.ok ? o.answer : `error: ${o.message}`);
const note = (o: Outcome) => (o.ok ? (o.note ?? '') : `error: ${o.message}`);

describe('typed inputs in the reasoning tools', () => {
  it('reads a decision nested under a chance node in a decision tree', async () => {
    // good: max(100, 10) = 100; wait = 0.4 * 100 + 0.6 * 20 = 52 > sell 40.
    const o = await solve('optimize', 'tree', {
      tree: 'Choose\n  wait: chance\n    good [0.4]: decision\n      build: 100\n      skip: 10\n    bad [0.6]: 20\n  sell: 40',
    });
    expect(answer(o)).toContain('52');
    expect(o.ok && o.steps?.join(' ')).toContain('build');
  });

  it('recommends by certainty equivalent when a risk tolerance is given', async () => {
    // Gamble 120 or 0 at 1/2, R = 100: CE = -100 ln(0.5 + 0.5 e^-1.2) = 42.985 < sure 50, while its EMV is 60.
    const o = await solve('optimize', 'decision', { tolerance: '100' });
    expect(answer(o)).toMatch(/^Choose sure for the highest certainty equivalent, 50;/);
    expect(answer(o)).toContain('gamble gives 60');
    expect(answer(await solve('optimize', 'decision', {}))).toMatch(/^Choose gamble for an expected value of 60/);
  });

  it('takes a miss rate and an instruction share written with %', async () => {
    // AMAT = 1 + 0.05 * 100 = 6.
    expect(answer(await solve('systems', 'amat', { levels: '1 5%', memory: '100' }))).toBe('AMAT = 6 cycles.');
    // CPI = 0.5 * 1 + 0.5 * 3 = 2.
    const cpi = await solve('systems', 'performance', { perf: 'cpi', mix: 'alu 50% 1\nload 50% 3' });
    expect(answer(cpi)).toMatch(/^CPI 2,/);
  });

  it('says when apportionment breaks a tie for the last seat by order', async () => {
    // Quotas 4/3 each: floors 1, 1, 1 and three equal remainders for the 1 seat left.
    const ham = await solve('games', 'apportion', { parties: 'A 1\nB 1\nC 1', seats: '4' });
    expect(answer(ham)).toContain('2, 1, 1');
    expect(note(ham)).toMatch(/Hamilton[^\n]*: A, B, C have equal claims[^\n]*to A/);
    // D'Hondt 6, 6, 2: quotients 6 6 3 3 2 2 2 1.5 1.5, then 1.2 for both A and B at the 10th seat.
    // Sainte-Laguë: 12 12 4 4 4 2.4 2.4 1.71 1.71, then 1.33 for A, B, and C at the 10th seat.
    const div = note(await solve('games', 'apportion', { parties: 'A 6\nB 6\nC 2', seats: '10' }));
    expect(div).toMatch(/Jefferson[^\n]*: A, B have equal claims/);
    expect(div).toMatch(/Webster[^\n]*: A, B, C have equal claims/);
    expect(note(await solve('games', 'apportion', { parties: 'A 53\nB 31\nC 16', seats: '10' }))).not.toContain(
      'equal claims',
    );
  });

  it('says when STV and the top-2 runoff break a tie by order', async () => {
    // Quota 4 for 6 voters and 1 seat; A and B both hold 3, so A drops and B wins.
    const stv = await solve('games', 'stv', { ballots: '3: A > B\n3: B > A', seats: '1' });
    expect(answer(stv)).toBe('Elected: B');
    expect(note(stv)).toContain('A, B tie for last; the tool drops A');
    // Each candidate has 1 first choice; A and B go on, and A beats B 2 to 1.
    const run = await solve('games', 'voting', { ballots: '1: A > B > C\n1: B > C > A\n1: C > A > B' });
    expect(note(run)).toContain('A, B, C tie in first choices, so the finalists A, B');
  });
});

describe('crash limits in the project network', () => {
  it('crashes to a target and reports the cost', async () => {
    // A-C-D 9 days; C at 30 a day comes off twice to 7, then both paths need D (40): 30 + 30 + 40 = 100.
    const o = await solve('optimize', 'project', { crash: 'C 2 30\nD 1 40', target: '6' });
    expect(note(o)).toContain('Crashed to 6 days for an extra 100.');
    expect(note(await solve('optimize', 'project', { target: '6' }))).toMatch(/^error: /);
  });
});

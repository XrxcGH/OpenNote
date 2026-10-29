// The tutor's pure parts: the linear-equation steps, the answer guard, the plan and its ladder, and the engine
// choice with its fallbacks. Expected values are worked by hand, never read back from the code under test.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadMathKit, type MathKit } from './kit';
import { equationSteps, numberText } from './equation';
import { leaks, normalizeMath } from './guard';
import { guardedRuleHint, planFor, ruleExplain, ruleHint, ruleSolution, secrets, type Plan } from './ladder';
import { acceptable, buildPrompt, tutorReply, type TutorRequest } from './engine';

let kit: MathKit;
// Math's door loads the grapher and the equation editor too, which takes a while on a busy machine.
beforeAll(async () => {
  kit = await loadMathKit();
}, 120_000);

const lines = (...texts: string[]) => texts.map((text) => ({ text }));
const plan = (...texts: string[]): Plan => planFor(lines(...texts), kit.checkSteps(lines(...texts)));
const request = (p: Plan, extra: Partial<TutorRequest> = {}): TutorRequest => ({
  mode: 'hint',
  rung: 1,
  plan: p,
  context: '2x + 3 = 7',
  ...extra,
});

describe('equation steps', () => {
  it('gathers the letter, then divides', () => {
    expect(equationSteps('2x + 3 = 7')).toMatchObject({
      letter: 'x',
      stage: 'collect',
      next: '2x = 4',
      answer: 'x = 2',
      lines: ['2x + 3 = 7', '2x = 4', 'x = 2'],
    });
    expect(equationSteps('2x = 4')).toMatchObject({ stage: 'divide', next: 'x = 2', coefficient: '2' });
    expect(equationSteps('x = 2')).toMatchObject({ stage: 'solved', answer: 'x = 2' });
  });

  it('handles letters on both sides, fractions, and a negative multiplier', () => {
    // 5y - 1 = 3y + 6  ->  2y = 7  ->  y = 7/2
    expect(equationSteps('5y - 1 = 3y + 6')).toMatchObject({ next: '2y = 7', answer: 'y = 7/2' });
    // 4 - x = 10  ->  -x = 6  ->  x = -6
    expect(equationSteps('4 - x = 10')).toMatchObject({ next: '-x = 6', answer: 'x = -6' });
  });

  it('refuses what is not a linear equation in one letter', () => {
    for (const text of ['x^2 = 4', 'x + y = 3', '2 + 3 = 5', 'x < 4', 'hello there', '', '=', 'x = = 2', '0x = 3'])
      expect(equationSteps(text)).toBeNull();
    expect(equationSteps(`${'1 + '.repeat(200)}x = 2`)).toBeNull();
  });

  it('writes numbers as a student would', () => {
    expect(numberText(3)).toBe('3');
    expect(numberText(-0)).toBe('0');
    expect(numberText(2.5)).toBe('5/2');
    expect(numberText(1 / 3)).toBe('1/3');
    expect(numberText(Math.PI)).toBe('3.1416');
  });
});

describe('answer guard', () => {
  it('writes math one way', () => {
    expect(normalizeMath(' X  =  −2 ')).toBe('x=-2');
    expect(normalizeMath('\\frac{1}{2} \\cdot x')).toBe('\\frac12*x');
  });

  it('catches the answer written as math or in words', () => {
    expect(leaks('So x = 2, well done.', ['x = 2'])).toBe(true);
    expect(leaks('Now x is 2.', ['x = 2'])).toBe(true);
    expect(leaks('The answer is 2.', ['x = 2'])).toBe(true);
    expect(leaks('Try dividing to get 2x = 4 first.', ['2x = 4'])).toBe(true);
  });

  it('does not trip on longer numbers, other lines, or what the student wrote', () => {
    expect(leaks('Look at 2x = 24 again.', ['x = 2'])).toBe(false);
    expect(leaks('Look at line 2.', ['x = 2'])).toBe(false);
    expect(leaks('What is x times 2?', ['x = 2'])).toBe(false);
    expect(leaks('You wrote x = 2 here.', ['x = 2'], 'x = 2')).toBe(false);
    expect(leaks('Anything', [null, undefined, ''])).toBe(false);
  });
});

describe('plan and ladder', () => {
  it('finds the broken step and climbs from where to look to the step', () => {
    const p = plan('2x + 3 = 7', '2x = 10', 'x = 5');
    expect(p).toMatchObject({ kind: 'mistake', index: 1, suggestion: '2x = 4', answer: 'x = 2' });
    expect(ruleHint(p, 1)).toContain('line 2');
    expect(ruleHint(p, 1)).toContain('line 1');
    expect(ruleHint(p, 4)).toContain('2x = 4');
    expect(ruleExplain(p)).toMatch(/^Line 2 does not follow from line 1\./);
    expect(ruleExplain(p)).not.toContain('2x = 4');
    expect(secrets(p)).toEqual({ answer: 'x = 2', next: '2x = 4' });
    // The rungs before the last never show the corrected line or the answer.
    for (const rung of [1, 2, 3] as const) {
      expect(ruleHint(p, rung)).not.toContain('2x = 4');
      expect(ruleHint(p, rung)).not.toContain('x = 2');
    }
    expect(ruleSolution(p)).toEqual(['2x = 4', 'x = 2']);
  });

  it('explains a sign that should have changed', () => {
    const p = plan('x + 3 = 7', 'x = 7 + 3');
    expect(p.kind).toBe('mistake');
    if (p.kind !== 'mistake') return;
    expect(p.family).toBe('sign');
    expect(ruleHint(p, 3)).toMatch(/3 moved across the equals sign/);
  });

  it('gives the next step of an unfinished equation', () => {
    const p = plan('3x - 2 = 10');
    expect(p).toMatchObject({ kind: 'equation' });
    expect(ruleHint(p, 3)).toMatch(/add or take away/);
    expect(ruleHint(p, 4)).toBe('The next line could be: 3x = 12');
    expect(ruleSolution(p)).toEqual(['3x - 2 = 10', '3x = 12', 'x = 4']);
  });

  it('says the step is the answer instead of showing it at the last rung', () => {
    const p = plan('3x = 12');
    expect(ruleHint(p, 4)).toContain('x = 4');
    expect(guardedRuleHint(p, 4, '3x = 12')).toBe(
      'Fixing this step gets you to the answer. Try it, or ask for the full solution.',
    );
  });

  it('praises finished working', () => {
    const p = plan('2x + 3 = 7', '2x = 4', 'x = 2');
    expect(p).toEqual({ kind: 'done', answer: 'x = 2' });
  });

  it('uses the calculus steps for a derivative', () => {
    const p = plan('d/dx(x^3 + 5x)');
    expect(p.kind).toBe('calculus');
    if (p.kind !== 'calculus') return;
    expect(p.calc).toBe('derivative');
    // d/dx (x^3 + 5x) = 3x^2 + 5
    expect(normalizeMath(p.answer)).toBe('3x^2+5');
    expect(ruleHint(p, 1)).toMatch(/sum, a product/);
  });

  it('asks guided questions for words', () => {
    const p = plan('Why did the Roman Empire fall?');
    expect(p).toEqual({ kind: 'general', math: false });
    expect(ruleHint(p, 3)).toMatch(/one sentence/);
    expect(ruleSolution(p)).toBeNull();
  });

  it('never throws on hostile input', () => {
    for (const text of ['', '))))((((', '='.repeat(5000), 'x'.repeat(10_000), '\u0000‮', '1/0 = x'])
      expect(() => ruleHint(plan(text), 2)).not.toThrow();
  });
});

describe('engine', () => {
  const p = (): Plan => plan('2x + 3 = 7', '2x = 10', 'x = 5');

  it('uses the built-in hints with no model', async () => {
    const reply = await tutorReply(request(p()), {});
    expect(reply).toEqual({ text: expect.stringContaining('line 2'), where: 'rules', fellBack: false });
  });

  it('shows a model hint that keeps the answer back', async () => {
    const device = vi.fn().mockResolvedValue('Check what happened to the 3 on line 2.');
    expect(await tutorReply(request(p()), { device })).toMatchObject({ where: 'device', fellBack: false });
  });

  it('asks again once, then falls back, when the model leaks the answer', async () => {
    const device = vi.fn().mockResolvedValue('It should be 2x = 4, so x = 2.');
    const reply = await tutorReply(request(p(), { rung: 2 }), { device });
    expect(device).toHaveBeenCalledTimes(2);
    expect(reply.where).toBe('rules');
    expect(reply.fellBack).toBe(true);
    expect(reply.text).not.toContain('x = 2');
  });

  it('falls back when the model fails or rambles', async () => {
    expect((await tutorReply(request(p()), { device: () => Promise.reject(new Error('gone')) })).where).toBe('rules');
    expect((await tutorReply(request(p()), { device: () => Promise.resolve('a'.repeat(5000)) })).where).toBe('rules');
  });

  it('sends nothing to the cloud without consent, and only the text shown', async () => {
    const send = vi.fn().mockResolvedValue('Look at the 3.');
    const no = await tutorReply(request(p()), { cloud: { send, consent: () => Promise.resolve(false) } });
    expect(send).not.toHaveBeenCalled();
    expect(no.where).toBe('rules');
    const shown: string[] = [];
    const yes = await tutorReply(request(p()), {
      cloud: {
        send,
        consent: (prompt) => {
          shown.push(prompt.system + prompt.prompt);
          return Promise.resolve(true);
        },
      },
    });
    expect(yes.where).toBe('cloud');
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]?.[0] as { system: string; prompt: string };
    expect(shown).toEqual([sent.system + sent.prompt]);
    expect(sent.prompt).toContain('2x + 3 = 7');
  });

  it('never retries a cloud request with different text', async () => {
    const send = vi.fn().mockResolvedValue('x = 2');
    const reply = await tutorReply(request(p()), { cloud: { send, consent: () => Promise.resolve(true) } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(reply).toMatchObject({ where: 'rules', fellBack: true });
  });

  it('keeps the exact working for a math solution, and lets the last rung show the next step', async () => {
    const device = vi.fn();
    const reply = await tutorReply(request(p(), { mode: 'solution' }), { device });
    expect(device).not.toHaveBeenCalled();
    expect(reply.text.split('\n').slice(1)).toEqual(['2x = 4', 'x = 2']);
    expect(acceptable(request(p(), { rung: 4 }), 'The step is 2x = 4.')).toBe(true);
    expect(acceptable(request(p(), { rung: 3 }), 'The step is 2x = 4.')).toBe(false);
  });

  it('puts the context and the task in the prompt', () => {
    const prompt = buildPrompt(request(p(), { mode: 'ask', question: 'Why is line 2 wrong?' }));
    expect(prompt.prompt).toContain('<text>\n2x + 3 = 7\n</text>');
    expect(prompt.prompt).toContain('The student asks: Why is line 2 wrong?');
  });
});

// The tutor's pure parts: the linear-equation steps, the answer guard, the plan and its ladder, and the engine
// choice with its fallbacks. Expected values are worked by hand, never read back from the code under test.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadMathKit, type MathKit } from './kit';
import { equationSteps, numberText } from './equation';
import { claimsAnswer, leaks, normalizeMath } from './guard';
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

describe('answer guard, written another way', () => {
  it('catches a secret that starts with a sign, a bracket or a root', () => {
    expect(leaks('The derivative is -sin(x).', ['-sin(x)'])).toBe(true);
    expect(leaks('It comes to (x+1)^2 here.', ['(x + 1)^2'])).toBe(true);
    expect(leaks('So the length is √2.', ['√2'])).toBe(true);
  });

  it('reads x^(2), superscripts and a times sign as plain powers and products', () => {
    expect(leaks('Write 3x^(2) + 5 next.', ['3x^2 + 5'])).toBe(true);
    expect(leaks('That gives 3x² + 5.', ['3x^2 + 5'])).toBe(true);
    expect(leaks('Try 2·x = 4.', ['2x = 4'])).toBe(true);
  });

  it('catches terms in another order and sides swapped', () => {
    expect(leaks('You get 5 + 3x^2.', ['3x^2 + 5'])).toBe(true);
    expect(leaks('Now 4 = 2x.', ['2x = 4'])).toBe(true);
  });

  it('catches the value written as another number or in other words', () => {
    // 7/2 is 3.5.
    expect(leaks('So y = 3.5.', ['y = 7/2'])).toBe(true);
    expect(leaks('Then y is 3.5.', ['y = 7/2'])).toBe(true);
    for (const hint of [
      'x = 2.0',
      'x = 4/2',
      'x should equal 2',
      'x turns out to be 2',
      'x equals two',
      'The answer: 2',
    ])
      expect(leaks(hint, ['x = 2']), hint).toBe(true);
    // 4/2 is 2, not 3, and line 2 is not a value of x.
    expect(leaks('x = 4/2', ['x = 3'])).toBe(false);
    expect(leaks('Look again at line 2, where x is.', ['x = 2'])).toBe(false);
  });

  it('catches an antiderivative without its constant', () => {
    expect(leaks('It is x^(2).', ['x^2 + C'])).toBe(true);
  });

  it('flags a stated result when the answer is unknown, but not numbers the student gave', () => {
    const given = 'F = m a, m = 2 kg, a = 3 m/s^2. F = ?';
    expect(claimsAnswer('F = 6 N', given)).toBe(true);
    expect(claimsAnswer('The answer is 36 g.', '2 H2 + O2 -> 2 H2O. 4 g of H2. mass = ?')).toBe(true);
    expect(claimsAnswer('Start from m = 2 kg and a = 3 m/s^2.', given)).toBe(false);
    expect(claimsAnswer('Which law links force, mass and acceleration?', given)).toBe(false);
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

  it('says a one-step derivative or integral is the answer instead of showing it', () => {
    const stepIsAnswer = 'Fixing this step gets you to the answer. Try it, or ask for the full solution.';
    // d/dx (x^3 + 5x) = 3x^2 + 5 in one step.
    const derivative = plan('d/dx(x^3 + 5x)');
    expect(guardedRuleHint(derivative, 4, 'd/dx(x^3 + 5x)')).toBe(stepIsAnswer);
    // The integral of 2x is x^2 + C in one step.
    const integral = plan('∫ 2x dx');
    expect(guardedRuleHint(integral, 4, '∫ 2x dx')).toBe(stepIsAnswer);
    for (const rung of [1, 2, 3] as const) {
      expect(normalizeMath(guardedRuleHint(derivative, rung, ''))).not.toContain('3x^2');
      expect(normalizeMath(guardedRuleHint(integral, rung, ''))).not.toContain('x^2');
    }
  });

  it('lists a one-step solution once', () => {
    expect(ruleSolution(plan('d/dx(x^3 + 5x)'))).toEqual(['d/dx [x^3 + 5x ] = 3x^2 + 5']);
    expect(ruleSolution(plan('∫ 2x dx'))).toEqual(['∫ 2x dx = x^2 + C']);
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

  it('refuses a model hint that gives the answer away', async () => {
    // d/dx (cos x) = -sin x.
    const cosine = plan('d/dx(cos x)');
    const device = vi.fn().mockResolvedValue('The derivative is -sin(x).');
    const reply = await tutorReply(request(cosine, { rung: 2, context: 'd/dx(cos x)' }), { device });
    expect(reply).toMatchObject({ where: 'rules', fellBack: true });
    const cubic = plan('d/dx(x^3 + 5x)');
    expect(acceptable(request(cubic, { rung: 2, context: 'd/dx(x^3 + 5x)' }), 'You get 3x^(2) + 5.')).toBe(false);
  });

  it('refuses a stated result for a problem with no known answer, before the last rung', () => {
    const context = 'F = m a, m = 2 kg, a = 3 m/s^2. What is F?';
    const physics = planFor(lines(context), null);
    expect(physics.kind).toBe('general');
    expect(acceptable(request(physics, { rung: 1, context }), 'F = 6 N')).toBe(false);
    expect(acceptable(request(physics, { rung: 1, context }), 'Which rule links F, m and a?')).toBe(true);
    expect(acceptable(request(physics, { mode: 'ask', rung: 4, context }), 'The answer is 6 N.')).toBe(false);
  });

  it('puts the context and the task in the prompt', () => {
    const prompt = buildPrompt(request(p(), { mode: 'ask', question: 'Why is line 2 wrong?' }));
    expect(prompt.prompt).toContain('<text>\n2x + 3 = 7\n</text>');
    expect(prompt.prompt).toContain('The student asks: Why is line 2 wrong?');
  });
});

describe('answer guard, numbers and plain words', () => {
  const stepIsAnswer = 'Fixing this step gets you to the answer. Try it, or ask for the full solution.';
  const before = [1, 2, 3] as const;

  it('keeps back a limit that comes to a bare number', () => {
    // lim x->0 sin(x)/x = 1.
    const context = 'lim x->0 sin(x)/x';
    const limit = plan(context);
    expect(limit.kind).toBe('calculus');
    expect(guardedRuleHint(limit, 4, context)).toBe(stepIsAnswer);
    for (const rung of before) {
      for (const reply of ['The limit is 1.', 'It equals 1.', 'The answer is 1', 'One.', 'it comes to one'])
        expect(acceptable(request(limit, { rung, context }), reply), reply).toBe(false);
      expect(acceptable(request(limit, { rung, context }), 'Put x = 0 in. What form do you get?')).toBe(true);
    }
  });

  it('keeps back a geometric sum, but not the n = 1 the student wrote', () => {
    // 1/2 + 1/4 + 1/8 + ... = (1/2) / (1 - 1/2) = 1.
    const context = 'Σ_(n=1)^∞ 1/2^n';
    const sum = plan(context);
    expect(sum.kind).toBe('calculus');
    expect(guardedRuleHint(sum, 4, context)).toBe(stepIsAnswer);
    for (const reply of ['The sum comes to 1.', 'It adds up to one.', 'So the series = 1'])
      expect(acceptable(request(sum, { rung: 2, context }), reply), reply).toBe(false);
    expect(acceptable(request(sum, { rung: 2, context }), 'Start at n = 1 and write out three terms.')).toBe(true);
  });

  it('keeps back a derivative at a point', () => {
    // f(x) = x^2 has f'(x) = 2x, so f'(3) = 6.
    const given = "f(x) = x^2. Find f'(3).";
    for (const reply of ['The slope there is 6.', "f'(3) = 6", 'It works out to six.', '6'])
      expect(leaks(reply, ['6'], given), reply).toBe(true);
    expect(leaks("Find f'(x) first, then put in x = 3.", ['6'], given)).toBe(false);
    // The rules cannot work this one out, so the general heuristic guards it.
    expect(claimsAnswer('The slope there is 6.', given)).toBe(true);
  });
});

describe('answer guard, other notations', () => {
  const stepIsAnswer = 'Fixing this step gets you to the answer. Try it, or ask for the full solution.';

  it('says an integral is the answer, not its antiderivative without + C', () => {
    // ∫ x^2 dx = x^3/3 + C.
    const context = '∫ x^2 dx';
    const integral = plan(context);
    expect(guardedRuleHint(integral, 4, context)).toBe(stepIsAnswer);
    expect(ruleSolution(integral)).toEqual(['∫ x^2 dx = x^3/3 + C']);
    for (const reply of ['(1/3)x^3 + C', 'It is x³/3.', 'You get x^3 over 3 plus C.'])
      expect(acceptable(request(integral, { rung: 2, context }), reply), reply).toBe(false);
    expect(acceptable(request(integral, { rung: 2, context }), 'Raise the power by one, then divide by it.')).toBe(
      true,
    );
  });

  it('catches a value said with other words, signs or notations', () => {
    for (const hint of [
      'x must equal 2',
      'x will equal 2',
      'x should come to 2',
      'x ends up as 2',
      'so x → 2',
      'x ≈ 2',
      'x ~ 2',
      'x ∈ {2}',
      'ｘ＝２',
      'x = ２',
      'x = 2.000000001',
    ])
      expect(leaks(hint, ['x = 2']), hint).toBe(true);
    // 7/2 is 3.5.
    for (const hint of ['y is three and a half', 'y is seven halves', 'y = 3 1/2', 'y = 3,5'])
      expect(leaks(hint, ['y = 7/2']), hint).toBe(true);
    for (const hint of ['three x squared', 'x^2 * 3', '(3)(x^2)']) expect(leaks(hint, ['3x^2']), hint).toBe(true);
    expect(leaks('That gives cos x.', ['cos(x)'])).toBe(true);
    // 2.1 is not 2, and x squared is not 3x^2.
    expect(leaks('x ≈ 2.1', ['x = 2'])).toBe(false);
    expect(leaks('Think about x squared.', ['3x^2'])).toBe(false);
  });
});

describe('answer guard, results said in words', () => {
  it('catches the value of a next line said in words', () => {
    // 2x + 3 = 7: take 3 from both sides, 2x = 4.
    const given = '2x + 3 = 7';
    for (const hint of ['2x is 4', '2x should be 4', 'the right side becomes 4', '7 - 3 = 4'])
      expect(leaks(hint, ['2x = 4'], given), hint).toBe(true);
    // 15 / 3 is 5: 3x = 15, x = 5.
    expect(leaks('so 3x is 15', ['3x = 15'], '3x - 2 = 13')).toBe(true);
    expect(leaks('Take 3 from both sides.', ['2x = 4'], given)).toBe(false);
  });

  it('flags plain-English results with no known answer', () => {
    const chemistry = '2 H2 + O2 -> 2 H2O. 4 g of H2. mass of water = ?';
    for (const reply of [
      'You get 36 grams of water.',
      'so 36 g of water forms',
      'Yields 36 grams.',
      'it produces 36 grams',
      'thirty-six grams',
    ])
      expect(claimsAnswer(reply, chemistry), reply).toBe(true);
    const physics = 'F = m a, m = 2 kg, a = 3 m/s^2. F = ?';
    for (const reply of ['The force is 6 newtons', 'so F equals 6', 'F is 6 N', 'F = 6', 'six newtons'])
      expect(claimsAnswer(reply, physics), reply).toBe(true);
    const trip = 'A car goes 120 miles in 3 hours. How fast is it?';
    for (const reply of ['40 mph', 'The speed is 40 mph']) expect(claimsAnswer(reply, trip), reply).toBe(true);
  });

  it('reads only real units after a stated number', () => {
    const given = 'Find n so that 3n + 1 is even.';
    expect(claimsAnswer('Pick n = 1 or n = 2 and test it.', given)).toBe(false);
    expect(claimsAnswer('Try n = 5 in the formula.', given)).toBe(false);
    expect(claimsAnswer('That makes n = 5 m.', given)).toBe(true);
  });

  it('asks about a constant slip without giving the number', () => {
    // (x + 1)^2 = x^2 + 2x + 1, so x^2 + 2x + 2 is off by 1.
    const p = plan('(x + 1)^2', 'x^2 + 2x + 2');
    expect(p).toMatchObject({ kind: 'mistake', family: 'constant' });
    expect(ruleHint(p, 3)).not.toMatch(/\d/);
  });
});

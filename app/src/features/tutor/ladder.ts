// The rules tutor (ADR 0050): a plan for the text the student chose, and the hint ladder over it. It needs no model.
// The plan comes from Check my work's verdicts (a step that needs a look), the worked steps of a linear equation, the
// calculus engine's derivation steps, or, for anything else, guided questions. Each plan has four rungs. They are
// where to look, the idea or rule involved, the next step as a question, and the next step shown. The full solution
// comes after them, and the panel offers it only after the student has tried, with a confirmation.
// `secrets` lists what a rung must not give away: the answer guard (guard.ts) checks every rung against them.
import type { CalculusKind, ReasonCode, Step, StepLine, StepResult } from '../math';
import type { MessageKey } from '../../strings/t';
import { t } from '../../strings/t';
import { equationSteps, type EquationSteps } from './equation';
import { leaks, normalizeMath } from './guard';
import { mathKit } from './kit';

export type Rung = 1 | 2 | 3 | 4;
export const LAST_RUNG: Rung = 4;

type Family =
  | 'sign'
  | 'signFlip'
  | 'inequality'
  | 'factor'
  | 'constant'
  | 'value'
  | 'derivative'
  | 'antiderivative'
  | 'units'
  | 'matrixEntry'
  | 'matrixShape'
  | 'general';

const FAMILY: Partial<Record<ReasonCode, Family>> = {
  signMoved: 'sign',
  signFlipped: 'signFlip',
  inequalityFlip: 'inequality',
  factorOff: 'factor',
  constantOff: 'constant',
  notEqual: 'value',
  differentSolutions: 'value',
  notAtSolution: 'value',
  valueOff: 'value',
  inequalitySet: 'value',
  derivativeOff: 'derivative',
  antiderivativeOff: 'antiderivative',
  unitsAdd: 'units',
  unitKind: 'units',
  unitValue: 'units',
  matrixEntry: 'matrixEntry',
  matrixShape: 'matrixShape',
};

export type Plan =
  | {
      kind: 'mistake';
      /** The line that needs a look, from 0. */
      index: number;
      family: Family;
      params: Readonly<Record<string, string>>;
      suggestion: string | null;
      /** The answer of the whole problem, when it can be worked out. */
      answer: string | null;
      /** The steps from the corrected line to the answer, when the corrected line is a linear equation. */
      rest: EquationSteps | null;
    }
  | { kind: 'equation'; steps: EquationSteps }
  | { kind: 'calculus'; calc: CalculusKind; step: Step | null; next: string; answer: string; lines: string[] }
  | { kind: 'done'; answer: string }
  | { kind: 'general'; math: boolean };

const ASIDE = new Set<ReasonCode>(['notMath', 'unreadable', 'note']);

function lineText(line: StepLine): string {
  const kit = mathKit();
  return (line.format === 'latex' && kit ? kit.latexToLine(line.text) : line.text).trim();
}

function solve(line: StepLine) {
  const kit = mathKit();
  try {
    return kit?.calculusAnswer(line.text, { mode: line.format === 'latex' ? 'latex' : 'text' }) ?? null;
  } catch {
    return null;
  }
}

/** A line as the student would write it: x^2, not x^(2). */
const tidy = (line: string) => line.replace(/\^\((-?\w+)\)/g, '^$1');

/** Whether two results are the same, however the powers are written, with or without "+ C". */
function sameResult(a: string, b: string): boolean {
  const plain = (text: string) => normalizeMath(text).replace(/\+c$/, '');
  return plain(a) === plain(b);
}

/** The right-hand side of a step such as "d/dx [x^3] = 3x^2". */
const resultOf = (line: string) => line.slice(line.lastIndexOf('=') + 1);

function calculusPlan(line: StepLine, written: number): Plan | null {
  const kit = mathKit();
  const found = solve(line);
  if (!kit || !found?.solved.ok) return null;
  const { kind, steps, answer } = found.solved;
  const shown = steps.map((one) => tidy(kit.latexToLine(one.latex)));
  const at = Math.min(written, steps.length);
  const step = steps[at] ?? null;
  const next = shown[at];
  // A step that already reaches the answer is the answer: the last rung says so instead of showing it.
  const reaches = (text: string) => sameResult(resultOf(text), answer.text);
  // Working that reaches the answer is one line, written with the answer as the engine gives it.
  const lines: string[] = [];
  for (const text of shown) {
    if (!reaches(text)) lines.push(text);
    else {
      lines.push(`${text.slice(0, text.lastIndexOf('=')).trimEnd()} = ${answer.text}`);
      break;
    }
  }
  if (lines.length === 0 || !reaches(lines[lines.length - 1] ?? '')) lines.push(answer.text);
  return {
    kind: 'calculus',
    calc: kind,
    step,
    next: next === undefined || reaches(next) ? answer.text : next,
    answer: answer.text,
    lines,
  };
}

/**
 * The plan for the chosen lines. `results` are Check my work's verdicts for the same lines (null for text that is not
 * math, or when checking was skipped), and `focus` is a flagged line the student picked.
 */
export function planFor(lines: readonly StepLine[], results: readonly StepResult[] | null, focus?: number): Plan {
  const texts = lines.map(lineText);
  const firstLine = texts.findIndex((text, i) => text !== '' && !ASIDE.has(results?.[i]?.reason ?? 'start'));
  const whole = firstLine >= 0 ? (equationSteps(texts[firstLine] ?? '') ?? null) : null;
  const firstCalc = firstLine >= 0 ? calculusPlan(lines[firstLine] as StepLine, 0) : null;
  const answer = whole?.answer ?? (firstCalc?.kind === 'calculus' ? firstCalc.answer : null);

  if (results) {
    const picked = focus !== undefined && results[focus]?.verdict === 'broken' ? focus : undefined;
    const index = picked ?? results.findIndex((r) => r.verdict === 'broken');
    const broken = index >= 0 ? results[index] : undefined;
    if (broken) {
      const suggestion = broken.suggestion?.trim() || null;
      return {
        kind: 'mistake',
        index,
        family: FAMILY[broken.reason] ?? 'general',
        params: broken.params,
        suggestion,
        answer,
        rest: suggestion ? equationSteps(suggestion) : null,
      };
    }
  }
  if (firstLine < 0) return { kind: 'general', math: false };
  const mathLines = texts
    .map((text, i) => ({ text, i }))
    .filter((one) => one.text !== '' && !ASIDE.has(results?.[one.i]?.reason ?? 'start'));
  const last = mathLines[mathLines.length - 1] ?? { text: '', i: firstLine };
  const fromLast = equationSteps(last.text);
  if (fromLast?.stage === 'solved') return { kind: 'done', answer: fromLast.answer };
  if (fromLast) return { kind: 'equation', steps: fromLast };
  const calc = calculusPlan(lines[firstLine] as StepLine, mathLines.length - 1);
  if (calc) return calc;
  // Text with no math at all reads as words: generic guided questions. Math the engines cannot work: the same.
  const math = results ? results.some((r) => !ASIDE.has(r.reason)) && /[=\d^]/.test(texts.join(' ')) : false;
  return { kind: 'general', math };
}

/** What the rungs before the full solution must not give away. The last rung may show `next` but never `answer`. */
export function secrets(plan: Plan): { answer: string | null; next: string | null } {
  switch (plan.kind) {
    case 'mistake':
      return { answer: plan.answer ?? plan.rest?.answer ?? null, next: plan.suggestion };
    case 'equation':
      return { answer: plan.steps.answer, next: plan.steps.next };
    case 'calculus':
      return { answer: plan.answer, next: plan.next };
    case 'done':
    case 'general':
      return { answer: null, next: null };
  }
}

type Say = (key: MessageKey, values?: Record<string, string | number>) => string;
const say = t as unknown as Say;

function familyText(kind: 'ideas' | 'questions', plan: Extract<Plan, { kind: 'mistake' }>): string {
  const values = { ...plan.params, number: plan.index + 1, previous: Math.max(1, plan.index) };
  let family: string = plan.family;
  if (kind === 'questions' && family === 'value') family = plan.params.at ? 'valueAt' : 'value';
  const needs: Record<string, string> = { sign: 'term', factor: 'factor', constant: 'offset', matrixEntry: 'row' };
  const need = needs[family];
  if (kind === 'questions' && need && !plan.params[need]) family = 'general';
  return say(`tutor.${kind}.${family}` as MessageKey, values);
}

/** The name of a hint rung, for its label. */
export function rungName(rung: Rung): string {
  return t((['tutor.rungs.where', 'tutor.rungs.idea', 'tutor.rungs.question', 'tutor.rungs.step'] as const)[rung - 1]);
}

function calculusRule(step: Step | null): string {
  if (!step) return t('tutor.calculus.ideaPlain');
  try {
    return t('tutor.calculus.idea', { rule: say(`mathTools.steps.rules.${step.rule}` as MessageKey) });
  } catch {
    return t('tutor.calculus.ideaPlain');
  }
}

/** The built-in hint at one rung. */
export function ruleHint(plan: Plan, rung: Rung): string {
  switch (plan.kind) {
    case 'mistake': {
      const number = plan.index + 1;
      const previous = Math.max(1, plan.index);
      if (rung === 1) return t('tutor.mistake.where', { number, previous });
      if (rung === 2) return familyText('ideas', plan);
      if (rung === 3) return familyText('questions', plan);
      if (!plan.suggestion) return t('tutor.mistake.stepUnknown', { number, previous });
      return t('tutor.mistake.step', { line: plan.suggestion });
    }
    case 'equation': {
      const { letter, stage, coefficient, next } = plan.steps;
      if (rung === 1) return t('tutor.equation.where', { letter });
      if (rung === 2) return t('tutor.equation.idea', { letter });
      if (rung === 3)
        return stage === 'divide'
          ? t('tutor.equation.divide', { letter, coefficient })
          : t('tutor.equation.collect', { letter });
      return t('tutor.equation.step', { line: next });
    }
    case 'calculus': {
      if (rung === 1) return t(`tutor.calculus.where.${plan.calc}`);
      if (rung === 2) return calculusRule(plan.step);
      if (rung === 3) return t(`tutor.calculus.question.${plan.calc}`);
      return t('tutor.calculus.step', { line: plan.next });
    }
    case 'done':
      return t('tutor.done.hint');
    case 'general':
      return t(
        (['tutor.general.where', 'tutor.general.idea', 'tutor.general.question', 'tutor.general.step'] as const)[
          rung - 1
        ],
      );
  }
}

/**
 * The built-in hint, checked by the answer guard like any other. The last rung may show the next step, but when that
 * step is the answer itself it says so instead; an earlier rung that would leak falls back to the general idea.
 */
export function guardedRuleHint(plan: Plan, rung: Rung, given: string): string {
  const hint = ruleHint(plan, rung);
  const { answer, next } = secrets(plan);
  const hidden = rung === LAST_RUNG ? [answer] : [answer, next];
  if (!leaks(hint, hidden, given)) return hint;
  return rung === LAST_RUNG ? t('tutor.mistake.stepIsAnswer') : t('tutor.ideas.general');
}

/** The built-in explanation of a flagged step: what went wrong and the rule, without the corrected line. */
export function ruleExplain(plan: Plan): string {
  if (plan.kind !== 'mistake') return t('tutor.errors.noMistake');
  return t('tutor.mistake.explain', {
    number: plan.index + 1,
    previous: Math.max(1, plan.index),
    idea: familyText('ideas', plan),
  });
}

/** The full worked solution, one line each, or null when the rules cannot work one out. */
export function ruleSolution(plan: Plan): string[] | null {
  switch (plan.kind) {
    case 'mistake': {
      if (!plan.suggestion) return null;
      const rest = plan.rest?.lines.slice(1) ?? [];
      const lines = [plan.suggestion, ...rest];
      if (plan.answer && !lines.includes(plan.answer) && !plan.rest) lines.push(plan.answer);
      return lines;
    }
    case 'equation':
      return plan.steps.lines;
    case 'calculus':
      return plan.lines;
    case 'done':
      return [plan.answer];
    case 'general':
      return null;
  }
}

// Practice mode for worked problems (flag doc.practice): the page's problem stays in view and its solution steps stay
// hidden until asked for, one at a time. This file reads a page's Markdown into the problem, the steps, and the
// answer, and holds the small state of how many steps are shown. The window is in PracticeTool.tsx.

export interface Problem {
  /** What comes before the solution: the title, the given, and what to find. */
  readonly problem: string;
  /** The solution, one step each, as Markdown. */
  readonly steps: readonly string[];
  /** The final answer, as Markdown, or an empty string when the page has none. */
  readonly answer: string;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SOLUTION = /^(?:worked\s+)?(?:solution|steps?|work)\b/i;
const ANSWER = /^(?:final\s+)?answer\b/i;
const NUMBERED = /^\d+[.)]\s+/;
const STEP_LABEL = /^(?:\*\*|__)?step\s+\d+\s*[:.)-]?(?:\*\*|__)?\s*[:.)-]?\s*/i;
const BULLET = /^[-*+]\s+/;

const join = (lines: readonly string[]): string => lines.join('\n').trim();

/** Breaks the lines of a solution into steps: numbered items, "Step n" lines, bullets, or else paragraphs. */
export function splitSteps(lines: readonly string[]): string[] {
  const starts = (pattern: RegExp) => lines.some((line) => pattern.test(line));
  let marker: RegExp | null = null;
  if (starts(NUMBERED)) marker = NUMBERED;
  else if (starts(STEP_LABEL)) marker = STEP_LABEL;
  else if (starts(BULLET)) marker = BULLET;
  const steps: string[][] = [];
  if (marker) {
    for (const line of lines) {
      if (marker.test(line)) steps.push([line.replace(marker, '')]);
      else if (steps.length > 0) steps[steps.length - 1].push(line.replace(/^ {1,4}/, ''));
    }
  } else {
    let open = false;
    for (const line of lines) {
      if (line.trim() === '') open = false;
      else if (open) steps[steps.length - 1].push(line);
      else {
        steps.push([line]);
        open = true;
      }
    }
  }
  return steps.map(join).filter((step) => step !== '');
}

/** The problem, steps, and answer a page's Markdown holds, or null when it holds no steps. */
export function parseProblem(markdown: string): Problem | null {
  const lines = markdown.split('\n');
  const heads = lines.flatMap((line, i) => {
    const m = HEADING.exec(line);
    return m ? [{ i, level: m[1].length, text: m[2] }] : [];
  });
  const solution = heads.find((h) => SOLUTION.test(h.text));
  if (solution) {
    const after = heads.find((h) => h.i > solution.i && (ANSWER.test(h.text) || h.level <= solution.level));
    const body = lines.slice(solution.i + 1, after ? after.i : lines.length);
    const steps = splitSteps(body);
    if (steps.length === 0) return null;
    const answerHead = heads.find((h) => h.i > solution.i && ANSWER.test(h.text));
    let answer = '';
    if (answerHead) {
      const end = heads.find((h) => h.i > answerHead.i && h.level <= answerHead.level);
      answer = join(lines.slice(answerHead.i + 1, end ? end.i : lines.length));
    }
    return { problem: join(lines.slice(0, solution.i)), steps, answer };
  }
  // No solution heading: the first numbered list of two or more items is the solution.
  const first = lines.findIndex((line) => NUMBERED.test(line));
  if (first === -1) return null;
  let last = first;
  while (last + 1 < lines.length && (NUMBERED.test(lines[last + 1]) || /^\s{2,}\S/.test(lines[last + 1]))) last += 1;
  const steps = splitSteps(lines.slice(first, last + 1));
  if (steps.length < 2) return null;
  const inline = lines.slice(last + 1).findIndex((line) => /^\**answer\**\s*:/i.test(line.trim()));
  const answer = inline === -1 ? '' : lines[last + 1 + inline].replace(/^\**answer\**\s*:\**\s*/i, '').trim();
  return { problem: join(lines.slice(0, first)), steps, answer };
}

export interface Practice {
  readonly total: number;
  /** How many steps are shown, from the first. */
  readonly shown: number;
  /** Whether the answer is shown. It comes after the last step. */
  readonly answered: boolean;
}

export const startPractice = (total: number): Practice => ({ total, shown: 0, answered: false });

/** Shows the next step, and after the last step, the answer. */
export function revealNext(state: Practice): Practice {
  if (state.shown < state.total) return { ...state, shown: state.shown + 1 };
  return state.answered ? state : { ...state, answered: true };
}

/** Hides the last thing shown. */
export function hideLast(state: Practice): Practice {
  if (state.answered) return { ...state, answered: false };
  return state.shown > 0 ? { ...state, shown: state.shown - 1 } : state;
}

export const isDone = (state: Practice): boolean => state.shown >= state.total && state.answered;

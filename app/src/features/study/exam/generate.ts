// Practice exam questions by rules (ADR 0052), the way the flashcard maker reads notes (deck/generate.ts): a
// "Term: meaning" line, a heading with the paragraph under it, a sentence with a bold word, a "Question :: Answer"
// line, and a worked problem with its steps. From these come short answers, multiple choice (the other meanings are
// the wrong options), true or false (a meaning swapped for another one is false), fill-in blanks, and worked
// problems with new numbers. The same notes and seed always give the same paper.
import { t } from '../../../strings/t';
import { generateCards } from '../deck/generate';
import { blanksOf } from '../deck/cloze';
import { shuffled } from '../deck/quiz';
import type { ExamSource } from './sources';
import { numericVariant, readAnswer } from './variant';
import { examLength } from './basics';
import { QUESTION_KINDS } from './types';
import type { Difficulty, ExamSettings, Question, QuestionKind, SourceRef } from './types';

/** One thing the notes state, which questions can be asked about. */
interface Fact {
  key: string;
  kind: 'definition' | 'heading' | 'bold' | 'inline' | 'worked';
  term: string;
  meaning: string;
  steps?: string[];
  source: SourceRef;
}

/** A small seeded random source (mulberry32), so a seed gives the same paper again. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const MAX_LINES = 20_000;

/** The heading above the line that holds the text, or the page title. */
function topicOf(lines: readonly string[], needle: string, title: string): string {
  const at = lines.findIndex((line) => line.includes(needle));
  for (let index = at; index >= 0; index -= 1) {
    const heading = HEADING.exec((lines[index] ?? '').trim());
    if (heading) return (heading[1] ?? '').replace(/[*_`]/g, '').trim() || title;
  }
  return title;
}

const SOLUTION = /^#{1,6}\s+(?:worked\s+)?(?:solution|steps?|working)\b/i;
const ANSWER = /^(?:#{1,6}\s+|\**)(?:final\s+)?answer\**\s*:?\**\s*(.*)$/i;
const LABEL = /^(?:(?:final\s+)?answer|(?:worked\s+)?solution|steps?|working|given|find)$/i;
const STEP = /^(?:\d+[.)]|[-*+])\s+(.+)$/;

/** Worked problems: a "Solution" heading with numbered steps, and an answer under an "Answer" heading or line. */
function workedFacts(lines: readonly string[], source: ExamSource): Fact[] {
  const found: Fact[] = [];
  lines.forEach((line, index) => {
    if (!SOLUTION.test(line.trim())) return;
    // The problem is the paragraph lines just above the solution heading, under their own heading.
    const above: string[] = [];
    for (let back = index - 1; back >= 0 && above.length < 12; back -= 1) {
      const text = (lines[back] ?? '').trim();
      if (HEADING.test(text)) break;
      if (text !== '') above.unshift(text);
    }
    const steps: string[] = [];
    let answer = '';
    for (let next = index + 1; next < lines.length && next < index + 40; next += 1) {
      const text = (lines[next] ?? '').trim();
      const final = ANSWER.exec(text);
      if (final) {
        answer = (final[1] ?? '').trim() || (lines[next + 1] ?? '').trim();
        break;
      }
      if (HEADING.test(text)) break;
      const step = STEP.exec(text);
      if (step) steps.push((step[1] ?? '').trim());
    }
    const problem = above.join('\n');
    if (problem.length < 12 || steps.length === 0) return;
    if (!answer) answer = steps[steps.length - 1]?.split('=').pop()?.trim() ?? '';
    if (!answer) return;
    found.push({
      key: `worked:${source.pageId}:${index}`,
      kind: 'worked',
      term: problem,
      meaning: answer,
      steps,
      source: { pageId: source.pageId, title: source.title, topic: topicOf(lines, above[0] ?? '', source.title) },
    });
  });
  return found;
}

/** Everything the notes state that a question can test, page by page. */
export function factsOf(sources: readonly ExamSource[]): Fact[] {
  const facts: Fact[] = [];
  for (const source of sources) {
    const lines = source.text.split('\n').slice(0, MAX_LINES);
    for (const candidate of generateCards(lines.join('\n'))) {
      const { card } = candidate;
      const reason = candidate.reason;
      // The labels of a worked problem are not facts to test.
      if (LABEL.test(card.front.trim())) continue;
      const needle = card.kind === 'cloze' ? (blanksOf(card.front)[0] ?? card.front) : card.front;
      const topic = reason === 'heading' ? card.front : topicOf(lines, needle, source.title);
      facts.push({
        key: `${reason}:${card.front.toLowerCase()}`,
        kind: reason === 'inline' && card.kind === 'cloze' ? 'bold' : reason,
        term: card.front,
        meaning: card.back,
        source: { pageId: source.pageId, title: source.title, topic },
      });
    }
    facts.push(...workedFacts(lines, source));
  }
  return facts;
}

/** How often each kind is asked at each difficulty: easier papers lean on recognition, harder ones on recall. */
const WEIGHTS: Record<Difficulty, Record<QuestionKind, number>> = {
  easier: { truefalse: 3, choice: 3, fill: 2, short: 1, worked: 1 },
  standard: { truefalse: 1, choice: 2, fill: 2, short: 2, worked: 2 },
  harder: { truefalse: 0.5, choice: 1, fill: 2, short: 3, worked: 3 },
};

const OPTIONS: Record<Difficulty, number> = { easier: 3, standard: 4, harder: 5 };

/** The paper runs from quick questions to long ones, as exam papers do. */
const ORDER: Record<QuestionKind, number> = { truefalse: 0, choice: 1, fill: 2, short: 3, worked: 4 };

/** The parts of a meaning a marker looks for: its clauses, as many as the marks, or the whole meaning. */
function guidePoints(meaning: string, marks: number): string[] {
  const parts = meaning
    .split(/[;:]\s+|,\s+(?:and\s+)?|\.\s+|\s+and\s+/)
    .map((part) => part.trim().replace(/[.]$/, ''))
    .filter((part) => part.split(/\s+/).length >= 2);
  return parts.length >= 2 ? parts.slice(0, Math.max(marks, 2)) : [meaning.trim()];
}

const lowerFirst = (text: string): string => (/^[A-Z][a-z]/.test(text) ? text[0]?.toLowerCase() + text.slice(1) : text);

interface Build {
  difficulty: Difficulty;
  random: () => number;
  others: readonly Fact[];
  next(): string;
}

function shortQuestion(fact: Fact, build: Build): Question | null {
  if (fact.kind === 'worked' || fact.kind === 'bold' || fact.meaning.length < 8) return null;
  const marks = build.difficulty === 'harder' ? 3 : 2;
  const prompt =
    fact.kind === 'inline'
      ? fact.term
      : fact.kind === 'heading'
        ? t('exams.q.explainTopic', { topic: fact.term })
        : t(build.difficulty === 'harder' ? 'exams.q.explainTerm' : 'exams.q.define', { term: fact.term });
  const math = readAnswer(fact.meaning)?.text === fact.meaning.trim();
  return {
    id: build.next(),
    kind: 'short',
    prompt,
    marks: math ? 1 : marks,
    answer: fact.meaning,
    guide: math ? [fact.meaning] : guidePoints(fact.meaning, marks),
    ...(math ? { math: true, tolerance: 0.001 } : {}),
    source: fact.source,
  };
}

function choiceQuestion(fact: Fact, build: Build): Question | null {
  if (fact.kind !== 'definition' && fact.kind !== 'heading' && fact.kind !== 'inline') return null;
  const pool = build.others.filter(
    (other) =>
      other.key !== fact.key &&
      other.kind === fact.kind &&
      other.meaning.toLowerCase() !== fact.meaning.toLowerCase() &&
      other.term.toLowerCase() !== fact.term.toLowerCase(),
  );
  const count = Math.min(OPTIONS[build.difficulty], pool.length + 1);
  if (count < 3) return null;
  // On a harder paper, a definition can be asked the other way round: which term has this meaning.
  const reverse = fact.kind === 'definition' && build.difficulty === 'harder' && build.random() < 0.5;
  const wrong = shuffled(pool, build.random)
    .slice(0, count - 1)
    .map((other) => (reverse ? other.term : other.meaning));
  const right = reverse ? fact.term : fact.meaning;
  const choices = shuffled([right, ...wrong], build.random);
  const prompt =
    fact.kind === 'inline'
      ? fact.term
      : reverse
        ? t('exams.q.choiceMeaning', { meaning: fact.meaning })
        : t('exams.q.choiceTerm', { term: fact.term });
  return {
    id: build.next(),
    kind: 'choice',
    prompt,
    marks: 1,
    answer: right,
    choices,
    correct: choices.indexOf(right),
    guide: [right],
    source: fact.source,
  };
}

function trueFalseQuestion(fact: Fact, build: Build): Question | null {
  if (fact.kind !== 'definition') return null;
  const swap = build.others.filter(
    (other) =>
      other.kind === 'definition' &&
      other.key !== fact.key &&
      other.meaning.toLowerCase() !== fact.meaning.toLowerCase(),
  );
  const makeFalse = swap.length > 0 && build.random() < 0.5;
  const shown = makeFalse ? (shuffled(swap, build.random)[0]?.meaning ?? fact.meaning) : fact.meaning;
  return {
    id: build.next(),
    kind: 'truefalse',
    prompt: t('exams.q.trueFalse', { term: fact.term, meaning: lowerFirst(shown) }),
    marks: 1,
    answer: makeFalse ? 'false' : 'true',
    guide: makeFalse ? [t('exams.guide.rightStatement', { term: fact.term, meaning: lowerFirst(fact.meaning) })] : [],
    source: fact.source,
  };
}

function fillQuestion(fact: Fact, build: Build): Question | null {
  if (fact.kind === 'bold') {
    const blanks = blanksOf(fact.term);
    if (blanks.length === 0 || blanks.length > 4) return null;
    return {
      id: build.next(),
      kind: 'fill',
      prompt: fact.term,
      marks: blanks.length,
      answer: blanks.join('; '),
      guide: blanks,
      source: fact.source,
    };
  }
  // A definition becomes a sentence with its term left out.
  if (fact.kind !== 'definition' || /[{}]/.test(fact.term + fact.meaning)) return null;
  return {
    id: build.next(),
    kind: 'fill',
    prompt: t('exams.q.fillTerm', { blank: `{{${fact.term}}}`, meaning: lowerFirst(fact.meaning) }),
    marks: 1,
    answer: fact.term,
    guide: [fact.term],
    source: fact.source,
  };
}

function workedQuestion(fact: Fact, build: Build): Question | null {
  if (fact.kind !== 'worked' || !fact.steps) return null;
  const steps = fact.steps;
  const marks = Math.min(6, Math.max(3, steps.length + 1));
  const variant = numericVariant(fact.term, steps, fact.meaning, build.random);
  const numeric = readAnswer(fact.meaning) !== null;
  if (variant) {
    return {
      id: build.next(),
      kind: 'worked',
      prompt: variant.prompt,
      marks,
      answer: variant.answer,
      guide: [t('exams.guide.method'), t('exams.guide.working', { working: variant.working })],
      math: true,
      tolerance: variant.tolerance,
      source: fact.source,
    };
  }
  return {
    id: build.next(),
    kind: 'worked',
    prompt: fact.term,
    marks,
    answer: fact.meaning,
    guide: steps.slice(0, 8).map((step, at) => t('exams.guide.step', { number: at + 1, step })),
    ...(numeric ? { math: true, tolerance: 0.01 } : {}),
    source: fact.source,
  };
}

const BUILDERS: Record<QuestionKind, (fact: Fact, build: Build) => Question | null> = {
  short: shortQuestion,
  choice: choiceQuestion,
  truefalse: trueFalseQuestion,
  fill: fillQuestion,
  worked: workedQuestion,
};

/**
 * Writes an exam's questions by rules. Each kind is drawn by its weight for the difficulty. Each question tests a
 * fact not yet asked about. It stops at the length, or when the notes run out. `avoid` lists text another writer
 * asked about already, so a mixed paper does not ask the same thing twice.
 */
export function ruleQuestions(
  sources: readonly ExamSource[],
  settings: Pick<ExamSettings, 'length' | 'difficulty' | 'kinds'>,
  random: () => number,
  options: { avoid?: ReadonlySet<string>; prefix?: string } = {},
): Question[] {
  const facts = shuffled(factsOf(sources), random);
  const kinds = QUESTION_KINDS.filter((kind) => settings.kinds.includes(kind));
  const length = examLength(settings.length);
  if (facts.length === 0 || kinds.length === 0) return [];
  let counter = 0;
  const build: Build = {
    difficulty: settings.difficulty,
    random,
    others: facts,
    next: () => `${options.prefix ?? 'q'}${(counter += 1)}`,
  };
  const weights = kinds.map((kind) => WEIGHTS[settings.difficulty][kind]);
  const sum = weights.reduce((a, b) => a + b, 0);
  const used = new Set<string>();
  const avoid = options.avoid ?? new Set<string>();
  const questions: Question[] = [];
  const exhausted = new Set<QuestionKind>();
  while (questions.length < length && exhausted.size < kinds.length) {
    let pick = random() * sum;
    let kind = kinds[0] as QuestionKind;
    for (const [at, one] of kinds.entries()) {
      pick -= weights[at] ?? 0;
      if (pick <= 0) {
        kind = one;
        break;
      }
    }
    if (exhausted.has(kind)) kind = kinds.find((one) => !exhausted.has(one)) ?? kind;
    let made: Question | null = null;
    for (const fact of facts) {
      if (used.has(fact.key) || avoid.has(fact.term.toLowerCase()) || avoid.has(fact.meaning.toLowerCase())) continue;
      made = BUILDERS[kind](fact, build);
      if (made) {
        used.add(fact.key);
        break;
      }
    }
    if (made) questions.push(made);
    else exhausted.add(kind);
  }
  return questions.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

/** True when the notes give at least one question of the kinds asked for. */
export function hasQuestions(sources: readonly ExamSource[], kinds: readonly QuestionKind[]): boolean {
  return ruleQuestions(sources, { length: 1, difficulty: 'standard', kinds }, seeded(1)).length > 0;
}

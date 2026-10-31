// Practice exam questions by the language model on this device (ADR 0052). It is used only when the person has
// downloaded a language model, and it runs in the app's own model program, so the notes stay on this computer. The
// model answers in JSON; every question is checked before it is used: a known kind, a prompt, and an answer of a
// sensible length, options that hold the answer, a source passage that exists, and an answer whose words come from
// that passage. Anything that fails is dropped, and the rules write the rest of the paper.
import type { ExamSource } from './sources';
import { QUESTION_KINDS } from './types';
import type { Difficulty, ExamSettings, Question, QuestionKind } from './types';

/** The part of the on-device model the exam needs. */
export interface ModelWriter {
  generate(options: { system: string; prompt: string; maxTokens: number; temperature: number }): Promise<string>;
}

/** The most characters of notes sent to the model, the most passages, and the longest passage. */
export const MAX_MODEL_CHARS = 12_000;
const MAX_PASSAGES = 12;
const PASSAGE_CHARS = 1_200;
const MAX_ITEMS = 60;

const SYSTEM =
  "You write exam questions from the user's own notes. Use only facts that are in the numbered passages. Reply " +
  'with only a JSON array, no other text. Each item is an object with: "kind" (one of short, choice, fill, worked, ' +
  'truefalse), "prompt", "answer", "marks" (1 to 6), "guide" (an array of short marking points), "source" (the ' +
  'passage number), and for choice also "choices" (3 to 5 strings, one of them the answer). For fill, put the ' +
  'missing words in the prompt as {{word}} and give them as the answer. For truefalse, the answer is true or false.';

const LEVEL: Record<Difficulty, string> = {
  easier: 'Make the questions easy: mostly recognition, such as true or false and multiple choice.',
  standard: 'Mix recognition and recall.',
  harder: 'Make the questions hard: mostly recall, explanation, and worked problems.',
};

/** The passages the model reads: each page cut to a length, in order, up to the total. */
export function passagesOf(sources: readonly ExamSource[]): ExamSource[] {
  const passages: ExamSource[] = [];
  let chars = 0;
  for (const source of sources) {
    if (passages.length >= MAX_PASSAGES || chars >= MAX_MODEL_CHARS) break;
    const text = source.text.slice(0, Math.min(PASSAGE_CHARS, MAX_MODEL_CHARS - chars)).trim();
    if (!text) continue;
    chars += text.length;
    passages.push({ ...source, text });
  }
  return passages;
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3);

/** True when most of the answer's longer words, or its numbers, are in the passage. */
export function grounded(answer: string, passage: string): boolean {
  const said = words(answer);
  if (said.length === 0)
    return /\d/.test(answer) ? answer.match(/\d+/g)?.some((n) => passage.includes(n)) === true : true;
  const known = new Set(words(passage));
  return said.filter((word) => known.has(word)).length / said.length >= 0.5;
}

const text = (value: unknown, most: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= most ? value.trim() : null;

/** One item of the model's reply as a question, or null when it does not pass the checks. */
export function checkItem(item: unknown, passages: readonly ExamSource[], id: string): Question | null {
  if (typeof item !== 'object' || item === null) return null;
  const raw = item as Record<string, unknown>;
  const kind = raw.kind as QuestionKind;
  if (!QUESTION_KINDS.includes(kind)) return null;
  const prompt = text(raw.prompt, 600);
  let answer = text(typeof raw.answer === 'boolean' ? String(raw.answer) : raw.answer, 400);
  const at = typeof raw.source === 'number' ? raw.source - 1 : Number(raw.source) - 1;
  const passage = Number.isInteger(at) ? passages[at] : undefined;
  if (!prompt || !answer || !passage || prompt.length < 8) return null;
  const marks = typeof raw.marks === 'number' && raw.marks >= 1 ? Math.min(6, Math.round(raw.marks)) : 1;
  const guide = Array.isArray(raw.guide)
    ? raw.guide.flatMap((point) => (text(point, 240) ? [String(point).trim()] : [])).slice(0, 8)
    : [];
  const source = { pageId: passage.pageId, title: passage.title, topic: passage.title };
  const base = { id, kind, prompt, marks, answer, guide, source };
  if (kind === 'truefalse') {
    answer = answer.toLowerCase();
    if (answer !== 'true' && answer !== 'false') return null;
    return { ...base, answer, marks: 1 };
  }
  if (kind === 'choice') {
    const choices = Array.isArray(raw.choices)
      ? [...new Set(raw.choices.flatMap((one) => (text(one, 300) ? [String(one).trim()] : [])))]
      : [];
    const correct = choices.findIndex((one) => one.toLowerCase() === answer?.toLowerCase());
    if (choices.length < 3 || choices.length > 5 || correct === -1) return null;
    if (!grounded(answer, passage.text)) return null;
    return { ...base, choices, correct, marks: 1, guide: guide.length > 0 ? guide : [answer] };
  }
  if (kind === 'fill') {
    const blanks = [...prompt.matchAll(/\{\{([^{}]+?)\}\}/g)].map((match) => (match[1] ?? '').trim());
    if (blanks.length === 0 || blanks.length > 4 || !grounded(blanks.join(' '), passage.text)) return null;
    return { ...base, answer: blanks.join('; '), marks: blanks.length, guide: blanks };
  }
  if (!grounded(answer, passage.text)) return null;
  const math = /^-?\d+(?:\.\d+)?(?:\s*[A-Za-z/^0-9°%·*]{0,12})?$/.test(answer);
  return {
    ...base,
    marks: kind === 'worked' ? Math.max(3, marks) : marks,
    guide: guide.length > 0 ? guide : [answer],
    ...(math ? { math: true, tolerance: 0.01 } : {}),
  };
}

/** The JSON array in a reply, which a model may wrap in a code fence or a sentence. */
export function readReply(reply: string): unknown[] {
  const start = reply.indexOf('[');
  const end = reply.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

/** Asks the model for questions and keeps the ones that pass. Throws when the model fails. */
export async function modelQuestions(
  model: ModelWriter,
  sources: readonly ExamSource[],
  settings: Pick<ExamSettings, 'length' | 'difficulty' | 'kinds'>,
): Promise<Question[]> {
  const passages = passagesOf(sources);
  if (passages.length === 0) return [];
  const listed = passages.map((passage, at) => `[${at + 1}] (${passage.title}) ${passage.text}`).join('\n\n');
  const kinds = settings.kinds.join(', ');
  const reply = await model.generate({
    system: SYSTEM,
    prompt:
      `Passages:\n${listed}\n\nWrite ${settings.length} questions. Use only these kinds: ${kinds}. ` +
      LEVEL[settings.difficulty],
    maxTokens: Math.min(3000, 160 * settings.length + 200),
    temperature: 0.3,
  });
  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const [at, item] of readReply(reply).entries()) {
    const question = checkItem(item, passages, `m${at + 1}`);
    if (!question || !settings.kinds.includes(question.kind)) continue;
    const key = question.prompt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
    if (questions.length >= settings.length) break;
  }
  return questions;
}

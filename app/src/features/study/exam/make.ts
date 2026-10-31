// Making a practice exam (ADR 0052): the on-device language model writes the questions when one is installed and
// the person has not turned it off, and the rules write them otherwise. When the model fails, or writes fewer than
// half of the questions asked for, the rules write the rest, so a paper is always made from what the notes hold.
import { cleanSettings } from './basics';
import { ruleQuestions, seeded } from './generate';
import { modelQuestions } from './model';
import type { ModelWriter } from './model';
import type { ExamSource } from './sources';
import type { Exam, ExamSettings, Question } from './types';

export { cleanSettings };

export interface MakeOptions {
  title: string;
  /** The language model on this device, or null to use only the rules. */
  model?: ModelWriter | null;
  seed?: number;
  now?: Date;
}

const ORDER: Record<Question['kind'], number> = { truefalse: 0, choice: 1, fill: 2, short: 3, worked: 4 };

export async function makeExam(
  sources: readonly ExamSource[],
  wanted: ExamSettings,
  options: MakeOptions,
): Promise<Exam> {
  const settings = cleanSettings(wanted);
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const random = seeded(seed);
  let written: Question[] = [];
  if (options.model) {
    try {
      written = await modelQuestions(options.model, sources, settings);
    } catch {
      written = [];
    }
  }
  const fromModel = written.length >= Math.ceil(settings.length / 2);
  if (!fromModel) written = [];
  const rest = ruleQuestions(sources, { ...settings, length: settings.length - written.length }, random, {
    avoid: new Set(written.map((question) => question.answer.toLowerCase())),
    prefix: 'r',
  });
  const questions = [...written, ...rest]
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
    .map((question, at) => ({ ...question, id: `q${at + 1}` }));
  const now = options.now ?? new Date();
  return {
    id: `exam-${now.getTime().toString(36)}-${seed.toString(36)}`,
    title: options.title,
    created: now.toISOString(),
    settings,
    questions,
    engine: fromModel ? 'model' : 'rules',
  };
}

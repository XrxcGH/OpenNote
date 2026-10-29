// A practice exam as pages (ADR 0052): the blank paper, the answer key with its marking guide, and the results. They
// are plain Markdown in text blocks, so they print, export, sync, and search like any other page. The results link
// back to the notes each weak topic came from with opennote://page links, which keep working after a move.
import { hideBlanks } from '../deck/cloze';
import { t } from '../../../strings/t';
import { keyHasUnit, letterOf } from './basics';
import { totals, weakTopics } from './mark';
import { clockText } from './timer';
import type { Answer, Answers, Exam, Question, QuestionMark } from './types';

/** Text from notes or a model, made safe to put in a Markdown line: no line breaks, no stray link, or table marks. */
export function inline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/([\\|[\]])/g, '\\$1')
    .trim();
}

export { letterOf };

const BLANK_LINE = '________';

function marksText(question: Question): string {
  return t('exams.paper.marks', { count: question.marks });
}

function questionLines(question: Question, number: number): string[] {
  const prompt = question.kind === 'fill' ? hideBlanks(question.prompt, BLANK_LINE) : question.prompt;
  const lines = [`**${number}.** ${inline(prompt)} ${marksText(question)}`, ''];
  if (question.kind === 'choice')
    for (const [at, choice] of (question.choices ?? []).entries()) lines.push(`- ${letterOf(at)}. ${inline(choice)}`);
  else if (question.kind === 'truefalse') lines.push(t('exams.paper.trueOrFalse'));
  else if (question.kind === 'worked') lines.push(t('exams.paper.showWorking'));
  else if (question.kind === 'short') lines.push(t('exams.paper.answerLine'));
  lines.push('');
  return lines;
}

/** The blank paper, to take on paper or to print. */
export function paperMarkdown(exam: Exam): string {
  const all = exam.questions.reduce((sum, question) => sum + question.marks, 0);
  const lines = [t('exams.paper.intro', { count: exam.questions.length, marks: all })];
  if (exam.settings.minutes !== null) lines.push('', t('exams.paper.time', { minutes: exam.settings.minutes }));
  lines.push('', t('exams.paper.instructions'), '');
  exam.questions.forEach((question, at) => lines.push(...questionLines(question, at + 1)));
  return lines.join('\n').trim();
}

function keyAnswer(question: Question): string {
  if (question.kind === 'choice' && question.correct !== undefined)
    return `${letterOf(question.correct)}. ${inline(question.answer)}`;
  if (question.kind === 'truefalse') return t(question.answer === 'true' ? 'exams.answer.true' : 'exams.answer.false');
  return inline(question.answer);
}

/** The answer key and marking guide. */
export function keyMarkdown(exam: Exam): string {
  const lines = [t('exams.key.intro'), ''];
  exam.questions.forEach((question, at) => {
    lines.push(`**${at + 1}.** ${keyAnswer(question)} ${marksText(question)}`, '');
    const points = question.guide.filter((point) => point.trim() !== '');
    if (points.length > 0) {
      lines.push(t('exams.key.guide'));
      for (const point of points) lines.push(`- ${inline(point)}`);
      lines.push('');
    }
    if (question.math && question.tolerance)
      lines.push(t('exams.key.tolerance', { percent: Math.round(question.tolerance * 1000) / 10 }), '');
    if (question.math && keyHasUnit(question.answer)) lines.push(t('exams.key.unit'), '');
    lines.push(t('exams.key.source', { title: inline(question.source.title) }), '');
  });
  return lines.join('\n').trim();
}

/** What the person answered, in words, for the results. */
export function answerText(question: Question, answer: Answer | undefined): string {
  if (!answer) return t('exams.answer.none');
  if (question.kind === 'choice' && answer.picked !== undefined) {
    const choice = question.choices?.[answer.picked];
    return choice === undefined ? t('exams.answer.none') : `${letterOf(answer.picked)}. ${inline(choice)}`;
  }
  if (question.kind === 'truefalse' && answer.picked !== undefined)
    return t(answer.picked === 0 ? 'exams.answer.true' : 'exams.answer.false');
  if (question.kind === 'fill') {
    const typed = (answer.blanks ?? []).map((one) => inline(one) || BLANK_LINE);
    return typed.some((one) => one !== BLANK_LINE) ? typed.join('; ') : t('exams.answer.none');
  }
  const typed = [answer.working, answer.text]
    .map((part) => inline(part ?? ''))
    .filter(Boolean)
    .join('; ');
  const ink = (answer.ink ?? []).length > 0;
  if (typed && ink) return t('exams.answer.typedAndInk', { text: typed });
  if (ink) return t('exams.answer.ink');
  return typed || t('exams.answer.none');
}

/** The results: the score, each question's marks and answer, and the weak topics with links to their notes. */
export function resultsMarkdown(
  exam: Exam,
  answers: Answers,
  marks: Readonly<Record<string, QuestionMark>>,
  late: number | null = null,
): string {
  const total = totals(exam, marks);
  const lines = [t('exams.results.score', { got: total.got, of: total.of, percent: total.percent }), ''];
  if (late !== null) lines.push(t('exams.results.late', { time: clockText(late) }), '');
  if (total.unmarked > 0) lines.push(t('exams.results.unmarked', { count: total.unmarked }), '');
  lines.push(`| ${t('exams.results.question')} | ${t('exams.results.marks')} | ${t('exams.results.yourAnswer')} |`);
  lines.push('| --- | --- | --- |');
  exam.questions.forEach((question, at) => {
    const one = marks[question.id];
    const got =
      one && one.status !== 'unmarked'
        ? t('exams.results.got', { got: one.got, of: one.of })
        : t('exams.results.notMarked');
    lines.push(`| ${at + 1} | ${got} | ${answerText(question, answers[question.id])} |`);
  });
  const weak = weakTopics(exam, marks);
  if (weak.length > 0) {
    lines.push('', t('exams.results.weakHeading'));
    for (const topic of weak)
      lines.push(
        `- ${t('exams.results.weakLine', { topic: inline(topic.topic), got: topic.got, of: topic.of })} ` +
          `[${inline(topic.title)}](opennote://page/${encodeURIComponent(topic.pageId)})`,
      );
  }
  return lines.join('\n').trim();
}

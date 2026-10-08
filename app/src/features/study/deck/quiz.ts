// A quiz (Study tools): a random test over the cards of a deck. It asks for each answer, checks it, and ends with a
// plain count of how many were right. It never changes the review schedule, and it keeps no streak or history, so a
// quiz is a way to try yourself, not a record.
import { splitBlanks } from './cloze';
import type { Card } from './types';

/** The most questions one quiz asks. */
export const MAX_QUIZ = 50;

/** Shuffles a copy of the list (Fisher-Yates) with the given source of randomness. */
export function shuffled<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...list];
  for (let at = copy.length - 1; at > 0; at -= 1) {
    const other = Math.floor(random() * (at + 1));
    [copy[at], copy[other]] = [copy[other], copy[at]];
  }
  return copy;
}

/** How many questions a quiz of a deck can have: at least one, and no more than the deck or the limit. */
export function quizSize(cards: number, wanted: number): number {
  if (cards <= 0) return 0;
  const asked = Number.isFinite(wanted) ? Math.round(wanted) : cards;
  return Math.max(1, Math.min(asked, cards, MAX_QUIZ));
}

/** The cards a quiz asks about: distinct, in random order. */
export function pickQuestions(cards: readonly Card[], wanted: number, random?: () => number): Card[] {
  return shuffled(cards, random).slice(0, quizSize(cards.length, wanted));
}

/** Text in a form that compares fairly: no case, no accents' marks, no punctuation, one space between words. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The ways one answer may be written: "H2O / water" and "H2O; water" accept either. */
function accepted(answer: string): string[] {
  return answer
    .split(/\s+\/\s+|;/)
    .map(normalize)
    .filter(Boolean);
}

/** The answers a question needs typed, one for each box: a fill in the blank card has a box for each blank. */
export function expectedAnswers(card: Card): string[] {
  if (card.kind === 'cloze') return splitBlanks(card.front).flatMap((part) => (part.blank ? [part.text] : []));
  return [card.back];
}

/** Whether what was typed is right for this card. A multiple choice card is checked with {@link choiceIsRight}. */
export function answerIsRight(card: Card, typed: readonly string[]): boolean {
  const expected = expectedAnswers(card);
  if (expected.length === 0 || typed.length < expected.length) return false;
  return expected.every((answer, at) => {
    const given = normalize(typed[at]);
    return given !== '' && accepted(answer).includes(given);
  });
}

export const choiceIsRight = (card: Card, picked: number): boolean => card.kind === 'choice' && picked === card.answer;

export interface QuizScore {
  right: number;
  total: number;
  /** Whole percent, 0 for an empty quiz. */
  percent: number;
}

export function score(results: readonly boolean[]): QuizScore {
  const right = results.filter(Boolean).length;
  return {
    right,
    total: results.length,
    percent: results.length === 0 ? 0 : Math.round((right / results.length) * 100),
  };
}

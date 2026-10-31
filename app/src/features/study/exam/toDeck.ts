// Missed questions to flashcards (ADR 0052): each question becomes a card of the study decks (deck/types.ts), in a
// deck named for the exam, so the review schedule (deck/schedule.ts) and quizzes (deck/quiz.ts) take them from there.
// Sending twice adds nothing new: a card remembers the question it came from.
import { t } from '../../../strings/t';
import { createDeck, decksStore, newId, saveCard } from '../deck/library';
import type { Card, Deck } from '../deck/types';
import type { Exam, Question } from './types';

/** A question as a flashcard of the same kind where there is one, else a question, and its answer. */
export function cardOf(question: Question, examId: string): Card {
  const origin = `exam:${examId}:${question.id}`;
  const guide = question.guide.filter((point) => point.trim() !== '' && point !== question.answer).join('; ');
  if (question.kind === 'choice' && question.choices && question.correct !== undefined)
    return {
      id: newId('c'),
      kind: 'choice',
      front: question.prompt,
      back: guide,
      choices: question.choices,
      answer: question.correct,
      origin,
    };
  if (question.kind === 'fill') return { id: newId('c'), kind: 'cloze', front: question.prompt, back: '', origin };
  const answer =
    question.kind === 'truefalse'
      ? t(question.answer === 'true' ? 'exams.answer.true' : 'exams.answer.false')
      : question.answer;
  return {
    id: newId('c'),
    kind: 'basic',
    front: question.prompt,
    back: guide ? `${answer}\n\n${guide}` : answer,
    origin,
  };
}

/** The deck for an exam's missed questions: the one made before for this exam, or a new one. */
function deckFor(exam: Exam): Deck {
  const prefix = `exam:${exam.id}:`;
  const existing = decksStore.get().find((deck) => deck.cards.some((card) => card.origin?.startsWith(prefix)));
  return existing ?? createDeck(t('exams.deck.name', { title: exam.title }));
}

/** Adds the questions to the exam's deck. Returns the deck and how many cards were new. */
export function sendToDeck(exam: Exam, questions: readonly Question[]): { deck: Deck; added: number } {
  const deck = deckFor(exam);
  const have = new Set(deck.cards.map((card) => card.origin));
  let added = 0;
  for (const question of questions) {
    const card = cardOf(question, exam.id);
    if (have.has(card.origin)) continue;
    saveCard(deck.id, card);
    have.add(card.origin);
    added += 1;
  }
  return { deck: decksStore.get().find((one) => one.id === deck.id) ?? deck, added };
}

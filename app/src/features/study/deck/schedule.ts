// The review schedule (Study tools): a plain spaced-repetition scheduler in the SM-2 family. It keeps no streaks,
// scores, or badges (BRAND.md): a card is new, due, or not due yet, and a deck with an exam date shows one daily
// number, so every card is seen before the exam.
import { addDays, daysBetween } from './dates';
import type { Card, CardState, Deck, Grade, States } from './types';

const START_EASE = 2.5;
const MIN_EASE = 1.3;
/** New cards a day when the deck has no exam date. */
export const NEW_PER_DAY = 10;

export function nextState(previous: CardState | undefined, grade: Grade, today: string): CardState {
  const base: CardState = previous ?? { due: today, interval: 0, ease: START_EASE, reps: 0, lapses: 0, first: today };
  if (grade === 'again') {
    return {
      ...base,
      due: today,
      interval: 0,
      reps: 0,
      lapses: base.lapses + 1,
      ease: Math.max(MIN_EASE, base.ease - 0.2),
    };
  }
  let interval: number;
  let ease = base.ease;
  if (grade === 'hard') {
    interval = Math.round(Math.max(1, base.interval) * 1.2);
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else if (grade === 'good') {
    interval = base.reps === 0 ? 1 : base.reps === 1 ? 3 : Math.round(base.interval * ease);
  } else {
    interval = base.reps <= 1 ? 4 : Math.round(base.interval * ease * 1.3);
    ease += 0.15;
  }
  interval = Math.max(1, interval);
  return { ...base, due: addDays(today, interval), interval, ease, reps: base.reps + 1 };
}

/** Pulls a due day in so the card comes back before the exam. */
export function capToExam(state: CardState, exam: string | undefined, today: string): CardState {
  if (!exam || state.due <= exam) return state;
  const last = addDays(exam, -1);
  return { ...state, due: last < today ? today : last };
}

export const isDue = (state: CardState | undefined, today: string): boolean =>
  state !== undefined && state.due <= today;

/** The cards with no review yet. */
export const newCards = (deck: Deck, states: States): Card[] => deck.cards.filter((card) => !states[card.id]);

export interface Target {
  /** Cards to see each day from now until the exam. */
  perDay: number;
  daysLeft: number;
  /** Cards that are new or due before the exam. */
  remaining: number;
}

/** The plain daily number for a deck with an exam still ahead, or null. */
export function dailyTarget(deck: Deck, states: States, today: string): Target | null {
  const exam = deck.exam;
  if (!exam || exam < today) return null;
  const daysLeft = Math.max(1, daysBetween(today, exam));
  const waiting = deck.cards.filter((card) => states[card.id] && states[card.id].due <= exam).length;
  const remaining = newCards(deck, states).length + waiting;
  return { perDay: Math.ceil(remaining / daysLeft), daysLeft, remaining };
}

/** New cards still allowed today. */
export function newAllowed(deck: Deck, states: States, today: string): number {
  const introduced = Object.values(states).filter((state) => state.first === today).length;
  const fresh = newCards(deck, states).length;
  const exam = deck.exam && deck.exam >= today ? deck.exam : null;
  const perDay = exam ? Math.ceil(fresh / Math.max(1, daysBetween(today, exam))) : NEW_PER_DAY;
  return Math.max(0, perDay - introduced);
}

/** Today's cards: everything due, oldest first, then the new cards the day allows, in deck order. */
export function todaysQueue(deck: Deck, states: States, today: string): Card[] {
  const due = deck.cards
    .filter((card) => isDue(states[card.id], today))
    .sort((a, b) => states[a.id].due.localeCompare(states[b.id].due));
  return [...due, ...newCards(deck, states).slice(0, newAllowed(deck, states, today))];
}

/** Counts for the deck list: how many are due, and how many are new and allowed today. */
export function counts(deck: Deck, states: States, today: string): { due: number; fresh: number } {
  const due = deck.cards.filter((card) => isDue(states[card.id], today)).length;
  return { due, fresh: Math.min(newCards(deck, states).length, newAllowed(deck, states, today)) };
}

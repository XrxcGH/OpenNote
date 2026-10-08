// The decks on this device and their review history. Both live in the browser's storage for the app, as the tool
// windows' other lists do: reading and writing never throw, and blocked storage just means decks start empty.
// Several windows share that storage, so a save merges with what another window saved (see saveDecks).
// Moving the decks into the notes folder, where backups reach them, needs a storage command (beta follow-up).
import { createStore } from '../../../state/store';
import { dayKey } from './dates';
import { capToExam, nextState } from './schedule';
import type { Card, Deck, Grade, States } from './types';

const PREFIX = 'opennote.study.';
const DECKS = 'decks';

function read<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // The deck still works until the window closes; it just won't be remembered.
  }
}

let counter = 0;
/** A short ID that is new on this device. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isCard(value: unknown): value is Card {
  const card = value as Card;
  return (
    Boolean(card) && typeof card.id === 'string' && typeof card.front === 'string' && typeof card.kind === 'string'
  );
}

function readDecks(): Deck[] {
  const saved = read<unknown>(DECKS, []);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((deck): deck is Deck => typeof deck?.id === 'string' && typeof deck.name === 'string')
    .map((deck) => ({ ...deck, cards: Array.isArray(deck.cards) ? deck.cards.filter(isCard) : [] }));
}

export const decksStore = createStore<readonly Deck[]>(readDecks(), 'study decks');
export const statesStore = createStore<Readonly<Record<string, States>>>({}, 'study states');

function loadStates(deckId: string): States {
  const cached = statesStore.get()[deckId];
  if (cached) return cached;
  const states = read<States>(`states.${deckId}`, {});
  // Reading must not notify, so a component can call this while it renders.
  (statesStore.get() as Record<string, States>)[deckId] = states;
  return states;
}

export const statesOf = (deckId: string): States => loadStates(deckId);

/**
 * Saves the deck list. The tool windows share this storage, so the list is merged with what another window saved
 * first: only `touched` (changed here) and `removed` (deleted here) come from this window; the rest follow the saved
 * copy, and decks only the saved copy has are kept.
 */
function saveDecks(next: readonly Deck[], touched?: string, removed?: string): void {
  const saved = readDecks();
  const merged = next.map((deck) => (deck.id === touched ? deck : (saved.find((one) => one.id === deck.id) ?? deck)));
  for (const deck of saved) {
    if (deck.id !== removed && !merged.some((one) => one.id === deck.id)) merged.push(deck);
  }
  decksStore.set(merged);
  write(DECKS, merged);
}

// Another window saved decks: show them here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === PREFIX + DECKS) decksStore.set(readDecks());
  });
}

export const deckById = (id: string): Deck | undefined => decksStore.get().find((deck) => deck.id === id);

export function createDeck(name: string, cards: Card[] = []): Deck {
  const deck: Deck = { id: newId('d'), name: name.trim() || name, cards };
  saveDecks([...decksStore.get(), deck], deck.id);
  return deck;
}

/** Replaces the deck with the same ID, or adds it. */
export function putDeck(deck: Deck): void {
  const decks = decksStore.get();
  saveDecks(
    decks.some((one) => one.id === deck.id) ? decks.map((one) => (one.id === deck.id ? deck : one)) : [...decks, deck],
    deck.id,
  );
}

export function changeDeck(id: string, change: (deck: Deck) => Deck): void {
  const deck = deckById(id);
  if (deck) putDeck(change(deck));
}

export function removeDeck(id: string): void {
  saveDecks(
    decksStore.get().filter((deck) => deck.id !== id),
    undefined,
    id,
  );
  statesStore.set((current) => {
    const { [id]: _gone, ...rest } = current;
    return rest;
  });
  try {
    localStorage.removeItem(`${PREFIX}states.${id}`);
  } catch {
    // Nothing to do.
  }
}

export function saveCard(deckId: string, card: Card): void {
  changeDeck(deckId, (deck) => ({
    ...deck,
    cards: deck.cards.some((one) => one.id === card.id)
      ? deck.cards.map((one) => (one.id === card.id ? card : one))
      : [...deck.cards, card],
  }));
}

export function deleteCard(deckId: string, cardId: string): void {
  changeDeck(deckId, (deck) => ({ ...deck, cards: deck.cards.filter((card) => card.id !== cardId) }));
}

/** Records a review of one card: the new state is saved and the card's next day is set. */
export function recordReview(deckId: string, cardId: string, grade: Grade, now: Date = new Date()): void {
  const today = dayKey(now);
  const states = loadStates(deckId);
  const deck = deckById(deckId);
  const next = capToExam(nextState(states[cardId], grade, today), deck?.exam, today);
  const all = { ...states, [cardId]: next };
  statesStore.set((current) => ({ ...current, [deckId]: all }));
  write(`states.${deckId}`, all);
}

/** Cards a page types with a line such as "Question :: Answer" belong to the page's deck, found by this ID. */
export const pageDeckId = (pageId: string): string => `page:${pageId}`;

/**
 * Brings the cards a page's lines make into its deck. Cards typed by hand stay; cards from lines that are gone go.
 * An empty deck made only for those lines is removed.
 */
export function syncInlineDeck(pageId: string, title: string, inline: readonly Card[]): void {
  const id = pageDeckId(pageId);
  const deck = deckById(id);
  if (!deck && inline.length === 0) return;
  const kept = (deck?.cards ?? []).filter((card) => !card.origin?.startsWith('inline:'));
  const cards = [...kept, ...inline];
  if (deck && cards.length === 0) return removeDeck(id);
  const same =
    deck &&
    deck.name === title &&
    deck.cards.length === cards.length &&
    deck.cards.every((card, index) => JSON.stringify(card) === JSON.stringify(cards[index]));
  if (!same) putDeck({ ...(deck ?? { id }), id, name: title, cards });
}

/** Sets or clears a deck's exam day. */
export function setDeckExam(deckId: string, day: string | null): void {
  changeDeck(deckId, (deck) => {
    const { exam: _old, ...rest } = deck;
    return day ? { ...rest, exam: day } : rest;
  });
}

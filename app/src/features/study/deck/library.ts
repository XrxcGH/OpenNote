// The decks on this device and their review history. They are the person's work, so they live in this device's
// store (deckFiles.ts), not in the browser's storage: each deck, each deck's history, and each picture is an item of
// its own, a failed save is reported, and decks kept in the browser's storage by earlier versions move over once.
// The main window and a popped-out Flashcards window each keep the decks in memory. Each writes only the decks it
// changed, and tells the other windows, which read those decks back, so neither window overwrites the other's work.
import { t } from '../../../strings/t';
import { createStore } from '../../../state/store';
import { showToast } from '../../../ui';
import { dayKey } from './dates';
import {
  DECK_PREFIX,
  STATES_PREFIX,
  deckName,
  idOfName,
  joinPictures,
  pictureName,
  pictureRefs,
  readDeck,
  readItem,
  readStates,
  splitPictures,
  statesName,
} from './deckFiles';
import type { DeckFiles } from './deckFiles';
import { capToExam, nextState } from './schedule';
import type { Card, Deck, Grade, States } from './types';

/** Where earlier versions kept the decks, in the browser's storage. */
const LEGACY_DECKS = 'opennote.study.decks';
const LEGACY_STATES = 'opennote.study.states.';
const CHANNEL = 'opennote.study';

let counter = 0;
/** A short ID that is new on this device. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const decksStore = createStore<readonly Deck[]>([], 'study decks');
export const statesStore = createStore<Readonly<Record<string, States>>>({}, 'study states');

let store: Promise<DeckFiles> | null = null;
/** The device store, loaded once: every read and write goes to the same one. */
function files(): Promise<DeckFiles> {
  store ??= import('../../intel').then(({ deviceStore }) => deviceStore());
  // A store that failed to load is tried again next time.
  store.catch(() => (store = null));
  return store;
}

// ---- Telling the other windows -------------------------------------------------------------------------------------

type Change = { kind: 'deck' | 'states'; id: string };
const channel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
channel?.addEventListener('message', (event: MessageEvent<Change>) => void readBack(event.data));
// A channel must not keep a process open (tests run this module in Node).
(channel as { unref?: () => void } | null)?.unref?.();

// ---- Saving --------------------------------------------------------------------------------------------------------

/** When each deck was first kept, which orders the list. */
const firstKept = new Map<string, number>();
let lastKept = 0;
/** Notes when a deck joins the list: later decks get later times, even within one millisecond. */
function keptNow(id: string): void {
  if (firstKept.has(id)) return;
  lastKept = Math.max(Date.now(), lastKept + 1, ...[...firstKept.values()].map((at) => at + 1));
  firstKept.set(id, lastKept);
}
/** The pictures known to be in the store. */
const keptPictures = new Set<string>();
/** Items changed here whose write has not started yet: a change read back from another window must not undo them. */
const pending = new Set<string>();
const chains = new Map<string, Promise<void>>();
let lastReport = 0;

function reportFailure(key: 'study.deck.saveFailed' | 'study.deck.loadFailed'): void {
  if (Date.now() - lastReport < 5000) return;
  lastReport = Date.now();
  showToast({ message: t(key), tone: 'danger' });
}

/** Decks removed here, until their pictures are cleared. */
const removed = new Map<string, Deck>();

/** Removes a deck's item, and the pictures no other deck shows. */
async function removeDeckItem(store: DeckFiles, id: string): Promise<void> {
  await store.remove(deckName(id));
  const gone = removed.get(id);
  removed.delete(id);
  if (!gone) return;
  const shown = new Set<string>();
  for (const deck of decksStore.get()) for (const hash of (await splitPictures(deck)).pictures.keys()) shown.add(hash);
  for (const hash of (await splitPictures(gone)).pictures.keys()) {
    if (shown.has(hash)) continue;
    await store.remove(pictureName(hash));
    keptPictures.delete(hash);
  }
}

async function writeDeck(store: DeckFiles, id: string): Promise<void> {
  const deck = decksStore.get().find((one) => one.id === id);
  if (!deck) return removeDeckItem(store, id);
  const split = await splitPictures(deck);
  for (const [hash, src] of split.pictures) {
    if (keptPictures.has(hash)) continue;
    await store.put(pictureName(hash), src);
    keptPictures.add(hash);
  }
  keptNow(id);
  await store.put(deckName(id), JSON.stringify({ version: 1, at: firstKept.get(id), deck: split.deck }));
}

async function writeStates(store: DeckFiles, id: string): Promise<void> {
  const states = statesStore.get()[id];
  if (!states || !decksStore.get().some((deck) => deck.id === id)) return store.remove(statesName(id));
  await store.put(statesName(id), JSON.stringify(states));
}

/** Writes one deck or one history after the writes before it, as it is when the write starts. */
function save(change: Change): Promise<void> {
  const key = `${change.kind}:${change.id}`;
  if (pending.has(key)) return chains.get(key) ?? Promise.resolve();
  pending.add(key);
  const run = async () => {
    await loaded;
    pending.delete(key);
    try {
      const store = await files();
      await (change.kind === 'deck' ? writeDeck(store, change.id) : writeStates(store, change.id));
      channel?.postMessage(change);
    } catch {
      // The change stays in memory, so the person can keep working, and they hear that it isn't kept.
      reportFailure('study.deck.saveFailed');
    }
  };
  const next = (chains.get(key) ?? Promise.resolve()).then(run);
  chains.set(key, next);
  return next;
}

/** Resolves once every change made so far is written (or has failed). */
export async function flushDecks(): Promise<void> {
  await loaded;
  await Promise.all([...chains.values()]);
}

// ---- Reading -------------------------------------------------------------------------------------------------------

async function readPictures(store: DeckFiles, decks: readonly Deck[]): Promise<Map<string, string>> {
  const pictures = new Map<string, string>();
  for (const hash of new Set(decks.flatMap(pictureRefs))) {
    const src = await store.get(pictureName(hash));
    if (src === null) continue;
    pictures.set(hash, src);
    keptPictures.add(hash);
  }
  return pictures;
}

async function readDeckItem(store: DeckFiles, id: string): Promise<{ at: number; deck: Deck } | null> {
  const text = await store.get(deckName(id));
  const item = text === null ? null : readItem(text);
  if (!item || item.deck.id !== id) return null;
  firstKept.set(id, item.at);
  return { at: item.at, deck: joinPictures(item.deck, await readPictures(store, [item.deck])) };
}

/** Takes in a deck or history that another window wrote. */
async function readBack(change: Change): Promise<void> {
  if (!change || typeof change.id !== 'string') return;
  await loaded;
  if (pending.has(`${change.kind}:${change.id}`)) return;
  try {
    const store = await files();
    if (change.kind === 'states') {
      const states = readStates(await store.get(statesName(change.id)));
      statesStore.set((current) => ({ ...current, [change.id]: states }));
      return;
    }
    const read = await readDeckItem(store, change.id);
    const decks = decksStore.get();
    if (!read) return decksStore.set(decks.filter((deck) => deck.id !== change.id));
    const at = decks.findIndex((deck) => deck.id === change.id);
    decksStore.set(at >= 0 ? decks.map((deck, i) => (i === at ? read.deck : deck)) : [...decks, read.deck]);
  } catch {
    reportFailure('study.deck.loadFailed');
  }
}

function legacy(): { decks: Deck[]; states: Map<string, States>; keys: string[] } | null {
  try {
    const text = localStorage.getItem(LEGACY_DECKS);
    if (text === null) return null;
    const saved = JSON.parse(text) as unknown;
    const decks = (Array.isArray(saved) ? saved : []).map(readDeck).filter((deck): deck is Deck => deck !== null);
    const keys = [LEGACY_DECKS];
    const states = new Map<string, States>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_STATES)) continue;
      keys.push(key);
      states.set(key.slice(LEGACY_STATES.length), readStates(localStorage.getItem(key)));
    }
    return { decks, states, keys };
  } catch {
    return null;
  }
}

/** Moves the decks an earlier version kept in the browser's storage into the store, then forgets them there. */
async function migrate(store: DeckFiles): Promise<void> {
  const old = legacy();
  if (!old) return;
  const base = Date.now() - old.decks.length;
  let failed = false;
  for (const [index, deck] of old.decks.entries()) {
    try {
      if ((await store.get(deckName(deck.id))) !== null) continue;
      const split = await splitPictures(deck);
      for (const [hash, src] of split.pictures) await store.put(pictureName(hash), src);
      await store.put(deckName(deck.id), JSON.stringify({ version: 1, at: base + index, deck: split.deck }));
      const states = old.states.get(deck.id);
      if (states) await store.put(statesName(deck.id), JSON.stringify(states));
    } catch {
      failed = true;
    }
  }
  if (failed) return reportFailure('study.deck.saveFailed');
  try {
    old.keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // They move again next time, which changes nothing: decks already in the store are left alone.
  }
}

async function load(): Promise<void> {
  // Let the module finish loading first, so a change made right away is seen below.
  await Promise.resolve();
  let found: { at: number; deck: Deck }[] = [];
  const states: Record<string, States> = {};
  try {
    const store = await files();
    await migrate(store);
    for (const name of await store.list(DECK_PREFIX)) {
      const id = idOfName(name, DECK_PREFIX);
      const read = id === null ? null : await readDeckItem(store, id);
      if (read) found.push(read);
    }
    for (const name of await store.list(STATES_PREFIX)) {
      const id = idOfName(name, STATES_PREFIX);
      if (id !== null) states[id] = readStates(await store.get(name));
    }
  } catch {
    reportFailure('study.deck.loadFailed');
  }
  found = found.sort((a, b) => a.at - b.at);
  // Changes made while the store was being read win over what it held.
  const changedHere = decksStore.get();
  const changedIds = new Set([...pending].filter((key) => key.startsWith('deck:')).map((key) => key.slice(5)));
  const decks = found.map((one) => one.deck).filter((deck) => !changedIds.has(deck.id));
  decksStore.set([...decks, ...changedHere.filter((deck) => changedIds.has(deck.id))]);
  statesStore.set((current) => ({ ...states, ...current }));
}

const loaded: Promise<void> = load();

/** Resolves once the decks are read from the store. */
export const whenDecksLoaded = (): Promise<void> => loaded;

// ---- The decks -----------------------------------------------------------------------------------------------------

export const statesOf = (deckId: string): States => statesStore.get()[deckId] ?? {};

function setDecks(next: readonly Deck[], changed: readonly string[]): void {
  changed.filter((id) => next.some((deck) => deck.id === id)).forEach(keptNow);
  decksStore.set(next);
  changed.forEach((id) => void save({ kind: 'deck', id }));
}

export const deckById = (id: string): Deck | undefined => decksStore.get().find((deck) => deck.id === id);

export function createDeck(name: string, cards: Card[] = []): Deck {
  const deck: Deck = { id: newId('d'), name: name.trim() || name, cards };
  setDecks([...decksStore.get(), deck], [deck.id]);
  return deck;
}

/** Replaces the deck with the same ID, or adds it. */
export function putDeck(deck: Deck): void {
  const decks = decksStore.get();
  setDecks(
    decks.some((one) => one.id === deck.id) ? decks.map((one) => (one.id === deck.id ? deck : one)) : [...decks, deck],
    [deck.id],
  );
}

export function changeDeck(id: string, change: (deck: Deck) => Deck): void {
  const deck = deckById(id);
  if (deck) putDeck(change(deck));
}

export function removeDeck(id: string): void {
  const deck = deckById(id);
  if (deck) removed.set(id, deck);
  setDecks(
    decksStore.get().filter((deck) => deck.id !== id),
    [id],
  );
  statesStore.set((current) => {
    const { [id]: _gone, ...rest } = current;
    return rest;
  });
  void save({ kind: 'states', id });
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
  const states = statesOf(deckId);
  const deck = deckById(deckId);
  const next = capToExam(nextState(states[cardId], grade, today), deck?.exam, today);
  statesStore.set((current) => ({ ...current, [deckId]: { ...current[deckId], [cardId]: next } }));
  void save({ kind: 'states', id: deckId });
}

/** Cards a page types with a line such as "Question :: Answer" belong to the page's deck, found by this ID. */
export const pageDeckId = (pageId: string): string => `page:${pageId}`;

function syncNow(pageId: string, title: string, inline: readonly Card[]): void {
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

/**
 * Brings the cards a page's lines make into its deck. Cards typed by hand stay; cards from lines that are gone go.
 * An empty deck made only for those lines is removed. It waits for the decks to be read, so a page shown at start
 * never replaces its deck's hand-typed cards with an empty list.
 */
export function syncInlineDeck(pageId: string, title: string, inline: readonly Card[]): Promise<void> {
  return loaded.then(() => syncNow(pageId, title, inline));
}

/** Sets or clears a deck's exam day. */
export function setDeckExam(deckId: string, day: string | null): void {
  changeDeck(deckId, (deck) => {
    const { exam: _old, ...rest } = deck;
    return day ? { ...rest, exam: day } : rest;
  });
}

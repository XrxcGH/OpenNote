// The decks on this device and their review history. They are the person's work, so they live in this device's
// store (deckFiles.ts), not in the browser's storage: each deck, each reviewed card's state, and each picture is an
// item of its own, a failed save is reported, and decks kept in the browser's storage by earlier versions move over
// once.
// The main window and a popped-out Flashcards window each keep the decks in memory. Each writes only the decks it
// changed, and tells the other windows, which read those decks back, so neither window overwrites the other's work.
import { t } from '../../../strings/t';
import { createStore } from '../../../state/store';
import { showToast } from '../../../ui';
import { dayKey } from './dates';
import {
  DECK_PREFIX,
  PICTURE_PREFIX,
  STATES_PREFIX,
  deckName,
  deckStatesPrefix,
  joinPictures,
  pictureName,
  pictureRefs,
  readDeck,
  readItem,
  readStateItem,
  readStates,
  splitPictures,
  stateName,
  writeStateItem,
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
/** The decks have been read from the store: until then an empty list means "not read yet", not "no decks". */
export const decksLoadedStore = createStore<boolean>(false, 'study decks loaded');

let store: Promise<DeckFiles> | null = null;
/** The device store, loaded once: every read and write goes to the same one. */
function files(): Promise<DeckFiles> {
  store ??= import('../../intel').then(({ deviceStore }) => deviceStore());
  // A store that failed to load is tried again next time.
  store.catch(() => (store = null));
  return store;
}

// ---- Telling the other windows -------------------------------------------------------------------------------------

/** A deck, or some of a deck's card states (`cards`; all of them when left out), changed in another window. */
type Change = { kind: 'deck' | 'states'; id: string; cards?: string[] };
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
/** Each item's writes and read-backs, one after another, so a read-back never lands in the middle of a write. */
const chains = new Map<string, Promise<void>>();
/** The cards reviewed here whose state is not written yet, by deck. */
const reviewed = new Map<string, Set<string>>();

/** Runs `step` after everything queued for `key`. */
function queue(key: string, step: () => Promise<void>): Promise<void> {
  const next = (chains.get(key) ?? Promise.resolve()).then(step);
  chains.set(key, next);
  return next;
}

/** The states of the cards reviewed here and not written yet. */
function unwritten(id: string, states: States | undefined): States {
  const cards = reviewed.get(id);
  if (!cards || !states) return {};
  return Object.fromEntries([...cards].filter((card) => states[card]).map((card) => [card, states[card]]));
}
let lastReport = 0;

function reportFailure(key: 'study.deck.saveFailed' | 'study.deck.loadFailed' | 'study.deck.pictureMissing'): void {
  if (Date.now() - lastReport < 5000) return;
  lastReport = Date.now();
  showToast({ message: t(key), tone: 'danger' });
}

/** Decks removed here, until their pictures are cleared. */
const removed = new Map<string, Deck>();

/** The pictures the decks in the store and in this window name: the store's, so a deck another window just wrote counts. */
async function picturesInUse(store: DeckFiles): Promise<Set<string>> {
  const used = new Set<string>();
  for (const deck of decksStore.get()) for (const hash of (await splitPictures(deck)).pictures.keys()) used.add(hash);
  for (const deck of decksStore.get()) for (const hash of pictureRefs(deck)) used.add(hash);
  for (const name of await store.list(DECK_PREFIX)) {
    const item = readItem((await store.get(name)) ?? '');
    if (item) for (const hash of pictureRefs(item.deck)) used.add(hash);
  }
  return used;
}

/**
 * Removes a deck's item, and the pictures no other deck names. Another window may write a deck naming one of them
 * while they are removed: they are looked for again afterwards, and one now named is put back (the other window
 * also puts back a picture it names and finds missing, see writeDeck).
 */
async function removeDeckItem(store: DeckFiles, id: string): Promise<void> {
  await store.remove(deckName(id));
  const gone = removed.get(id);
  removed.delete(id);
  if (!gone) return;
  const pictures = (await splitPictures(gone)).pictures;
  const used = await picturesInUse(store);
  const cleared = [...pictures.keys()].filter((hash) => !used.has(hash));
  for (const hash of cleared) {
    await store.remove(pictureName(hash));
    keptPictures.delete(hash);
  }
  if (cleared.length === 0) return;
  const usedNow = await picturesInUse(store);
  for (const hash of cleared) if (usedNow.has(hash)) await store.put(pictureName(hash), pictures.get(hash)!);
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
  // A picture kept earlier may have been removed by another window that dropped the last deck it knew to name it.
  if (split.pictures.size === 0) return;
  const kept = new Set(await store.list(PICTURE_PREFIX));
  for (const [hash, src] of split.pictures) if (!kept.has(pictureName(hash))) await store.put(pictureName(hash), src);
}

/**
 * Writes the state of each card reviewed here, each to its own item, so a card another window reviewed in the
 * meantime is never written over. Returns the cards written. A removed deck's states are all removed.
 */
async function writeStates(store: DeckFiles, id: string): Promise<string[] | undefined> {
  if (!decksStore.get().some((deck) => deck.id === id)) {
    reviewed.delete(id);
    for (const name of await store.list(deckStatesPrefix(id))) await store.remove(name);
    return undefined;
  }
  const states = statesStore.get()[id] ?? {};
  const cards = [...(reviewed.get(id) ?? [])].filter((card) => states[card]);
  reviewed.delete(id);
  const written: string[] = [];
  try {
    for (const card of cards) {
      await store.put(stateName(id, card), writeStateItem({ deck: id, card, state: states[card] }));
      written.push(card);
    }
  } catch (error) {
    // Not written: they go with the next write.
    const left = cards.filter((card) => !written.includes(card));
    if (left.length > 0) reviewed.set(id, new Set([...left, ...(reviewed.get(id) ?? [])]));
    throw error;
  }
  return written;
}

/** Writes one deck or one history after the writes before it, as it is when the write starts. */
function save(change: Change): Promise<void> {
  const key = `${change.kind}:${change.id}`;
  if (pending.has(key)) return chains.get(key) ?? Promise.resolve();
  pending.add(key);
  return queue(key, async () => {
    await loaded;
    // From here a new change queues a write of its own, after this one.
    pending.delete(key);
    try {
      const store = await files();
      if (change.kind === 'deck') {
        await writeDeck(store, change.id);
        channel?.postMessage(change);
      } else {
        const cards = await writeStates(store, change.id);
        channel?.postMessage(cards ? { ...change, cards } : change);
      }
    } catch {
      // The change stays in memory, so the person can keep working, and they hear that it isn't kept.
      reportFailure('study.deck.saveFailed');
    }
  });
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
    // The card keeps naming the picture, so a later save doesn't forget it, and the person hears it is missing.
    if (src === null) {
      reportFailure('study.deck.pictureMissing');
      continue;
    }
    pictures.set(hash, src);
    keptPictures.add(hash);
  }
  return pictures;
}

/** The deck kept as the item `name`, or null when there is none. */
async function readDeckItem(store: DeckFiles, name: string): Promise<{ at: number; deck: Deck } | null> {
  const text = await store.get(name);
  const item = text === null ? null : readItem(text);
  // A name is an ID or its hash: the item names its deck, and must be the deck's.
  if (!item || deckName(item.deck.id) !== name) return null;
  firstKept.set(item.deck.id, item.at);
  return { at: item.at, deck: joinPictures(item.deck, await readPictures(store, [item.deck])) };
}

/**
 * Takes in a deck or history that another window wrote. It waits for this window's write of the same item, and
 * then reads what the store holds, so both windows end up with the same deck. A change made here and not yet
 * written wins: its write comes next, and the other window reads that back.
 */
async function readBack(change: Change): Promise<void> {
  if (!change || (change.kind !== 'deck' && change.kind !== 'states') || typeof change.id !== 'string') return;
  await loaded;
  const key = `${change.kind}:${change.id}`;
  // A deck changed here and not yet written wins. Card states are items of their own, so they are always taken in.
  if (change.kind === 'deck' && pending.has(key)) return;
  return queue(key, () => (change.kind === 'deck' ? readDeckBack(change.id, key) : readStatesBack(change)));
}

async function readStatesBack(change: Change): Promise<void> {
  try {
    const store = await files();
    const cards = Array.isArray(change.cards) ? change.cards.filter((card) => typeof card === 'string') : null;
    const names = cards
      ? cards.map((card) => stateName(change.id, card))
      : await store.list(deckStatesPrefix(change.id));
    const read: States = {};
    for (const name of names) {
      const item = readStateItem(await store.get(name));
      if (item?.deck === change.id) read[item.card] = item.state;
    }
    // Cards reviewed here and not yet written keep their state; all of a deck's states replace what was here.
    statesStore.set((current) => ({
      ...current,
      [change.id]: { ...(cards ? current[change.id] : {}), ...read, ...unwritten(change.id, current[change.id]) },
    }));
  } catch {
    reportFailure('study.deck.loadFailed');
  }
}

async function readDeckBack(id: string, key: string): Promise<void> {
  if (pending.has(key)) return;
  try {
    const store = await files();
    const read = await readDeckItem(store, deckName(id));
    // A change made here while the deck was read wins: its write comes next.
    if (pending.has(key)) return;
    const decks = decksStore.get();
    if (!read) return decksStore.set(decks.filter((deck) => deck.id !== id));
    const at = decks.findIndex((deck) => deck.id === id);
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
      // A deck or history already in the store was moved by an earlier run, which may have stopped between them.
      if ((await store.get(deckName(deck.id))) === null) {
        const split = await splitPictures(deck);
        for (const [hash, src] of split.pictures) await store.put(pictureName(hash), src);
        await store.put(deckName(deck.id), JSON.stringify({ version: 1, at: base + index, deck: split.deck }));
      }
      for (const [card, state] of Object.entries(old.states.get(deck.id) ?? {})) {
        if ((await store.get(stateName(deck.id, card))) === null) {
          await store.put(stateName(deck.id, card), writeStateItem({ deck: deck.id, card, state }));
        }
      }
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
      const read = await readDeckItem(store, name);
      if (read) found.push(read);
    }
    for (const name of await store.list(STATES_PREFIX)) {
      const item = readStateItem(await store.get(name));
      if (item) states[item.deck] = { ...states[item.deck], [item.card]: item.state };
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
  // Reviews made while the store was being read win over what it held.
  statesStore.set((current) => {
    const next = { ...states };
    for (const [id, cards] of Object.entries(current)) next[id] = { ...next[id], ...cards };
    return next;
  });
  decksLoadedStore.set(true);
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
  reviewed.set(deckId, (reviewed.get(deckId) ?? new Set()).add(cardId));
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

// How decks are kept in this device's store (the shell's device folder): one item for each deck, one for each
// deck's review history, and one for each picture, so a deck full of pictures never pushes the other decks out and
// each window writes only what it changed. Pictures are kept once by their content and named in the deck.
import type { Card, Deck, States } from './types';

/** The store the decks live in: the shell's device store, or the fake on the web platform. */
export interface DeckFiles {
  get(name: string): Promise<string | null>;
  put(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** The names that start with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

export const DECK_PREFIX = 'study.deck.';
export const STATES_PREFIX = 'study.states.';
export const PICTURE_PREFIX = 'study.picture.';
const SUFFIX = '.json';
/** How a deck item names a picture kept on its own. */
const PICTURE_REF = 'opennote-picture:';

/** A store name may hold letters, digits, dots, dashes, and underscores: anything else in an ID is escaped. */
export function encodeId(id: string): string {
  return [...id].map((c) => (/[A-Za-z0-9-]/.test(c) ? c : `_${c.codePointAt(0)!.toString(16)}.`)).join('');
}

export function decodeId(name: string): string {
  return name.replace(/_([0-9a-f]+)\./g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

export const deckName = (id: string): string => `${DECK_PREFIX}${encodeId(id)}${SUFFIX}`;
export const statesName = (id: string): string => `${STATES_PREFIX}${encodeId(id)}${SUFFIX}`;
export const pictureName = (hash: string): string => `${PICTURE_PREFIX}${hash}`;

/** The deck ID an item's name stands for, or null when the name is not one of `prefix`'s. */
export function idOfName(name: string, prefix: string): string | null {
  if (!name.startsWith(prefix) || !name.endsWith(SUFFIX)) return null;
  return decodeId(name.slice(prefix.length, -SUFFIX.length));
}

/** What a deck item holds. `at` orders the decks by when each was first kept. */
export interface DeckItem {
  version: 1;
  at: number;
  deck: Deck;
}

/** A short name for a picture: the start of the SHA-256 of its data address. */
export async function pictureHash(src: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
  return [...new Uint8Array(digest).slice(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isData = (src: string) => src.startsWith('data:');

function mapPictures(card: Card, map: (src: string) => string): Card {
  const next = { ...card };
  if (card.image) next.image = { ...card.image, src: map(card.image.src) };
  if (card.images) next.images = { front: card.images.front.map(map), back: card.images.back.map(map) };
  return next;
}

function picturesOf(card: Card): string[] {
  return [...(card.image ? [card.image.src] : []), ...(card.images?.front ?? []), ...(card.images?.back ?? [])];
}

/** The deck with each picture replaced by its name, and the pictures by name. */
export async function splitPictures(deck: Deck): Promise<{ deck: Deck; pictures: Map<string, string> }> {
  const pictures = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const src of deck.cards.flatMap(picturesOf).filter(isData)) {
    if (hashes.has(src)) continue;
    const hash = await pictureHash(src);
    hashes.set(src, hash);
    pictures.set(hash, src);
  }
  const ref = (src: string) => (hashes.has(src) ? PICTURE_REF + hashes.get(src)! : src);
  return { deck: { ...deck, cards: deck.cards.map((card) => mapPictures(card, ref)) }, pictures };
}

/** The pictures a deck item names. */
export function pictureRefs(deck: Deck): string[] {
  return deck.cards
    .flatMap(picturesOf)
    .filter((src) => src.startsWith(PICTURE_REF))
    .map((src) => src.slice(PICTURE_REF.length));
}

/** The deck with each named picture put back. A picture that is missing becomes empty. */
export function joinPictures(deck: Deck, pictures: ReadonlyMap<string, string>): Deck {
  const back = (src: string) =>
    src.startsWith(PICTURE_REF) ? (pictures.get(src.slice(PICTURE_REF.length)) ?? '') : src;
  return { ...deck, cards: deck.cards.map((card) => mapPictures(card, back)) };
}

function isCard(value: unknown): value is Card {
  const card = value as Card;
  return (
    Boolean(card) && typeof card.id === 'string' && typeof card.front === 'string' && typeof card.kind === 'string'
  );
}

/** A deck read from anywhere: null unless it has an ID and a name. Cards that are not cards are dropped. */
export function readDeck(value: unknown): Deck | null {
  const deck = value as Deck | null;
  if (typeof deck?.id !== 'string' || typeof deck.name !== 'string') return null;
  return { ...deck, cards: Array.isArray(deck.cards) ? deck.cards.filter(isCard) : [] };
}

export function readItem(text: string): DeckItem | null {
  try {
    const item = JSON.parse(text) as Partial<DeckItem>;
    const deck = readDeck(item.deck);
    return deck ? { version: 1, at: typeof item.at === 'number' ? item.at : 0, deck } : null;
  } catch {
    return null;
  }
}

export function readStates(text: string | null): States {
  if (!text) return {};
  try {
    const states = JSON.parse(text) as unknown;
    return states && typeof states === 'object' && !Array.isArray(states) ? (states as States) : {};
  } catch {
    return {};
  }
}

// The deck model (Study tools): a deck holds cards of four kinds. What a card says lives in the deck. When a card
// is due lives apart, on this device (schedule.ts), so changing a card's wording never loses its review history.

/** A hidden rectangle on an image, as percentages of the image's width and height. */
export interface OcclusionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CardKind = 'basic' | 'cloze' | 'choice' | 'occlusion';

export interface Card {
  id: string;
  kind: CardKind;
  /** The question. A cloze card's text keeps its {{blanks}}. An image card's front is its prompt. */
  front: string;
  /** The answer, or extra words shown after it. A cloze card may leave this empty. */
  back: string;
  /** The options of a multiple choice card, and the index of the right one. */
  choices?: string[];
  answer?: number;
  /** An image card: the picture as a data address, its description, and the parts that are hidden. */
  image?: { src: string; alt: string; boxes: OcclusionBox[] };
  /** Pictures that came with an imported card, as data addresses, shown with the question and with the answer. */
  images?: { front: string[]; back: string[] };
  /** Where the card came from when it was not typed here, such as 'inline:<block>:<line>' or 'import'. */
  origin?: string;
}

export interface Deck {
  id: string;
  name: string;
  cards: Card[];
  /** The day of an exam, as YYYY-MM-DD. */
  exam?: string;
}

/** How a review went. The words are plain on purpose: there are no points. */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

/** What the scheduler remembers about one card. */
export interface CardState {
  /** The day the card is next due, as YYYY-MM-DD. */
  due: string;
  /** Days between the last two reviews. */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  /** The day the card was first reviewed. */
  first: string;
}

export type States = Record<string, CardState>;

// Sample content for the text spike: eight notes of different sizes, one of them a 20-page document.
// Everything comes from a seeded generator, so every run types into the same text.
import type { JSONContent } from '@tiptap/core';

/** A small seeded random number generator (mulberry32), returning numbers from 0 up to 1. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'the of and a to in is you that it he was for on are as with his they at be this have from or one had by ' +
  'word but not what all were we when your can said there use an each which she do how their if will up ' +
  'other about out many then them these so some her would make like him into time has look two more write ' +
  'go see number no way could people my than first water been call who oil its now find long down day did ' +
  'get come made may part note page ink pen idea plan class lecture summary chapter question answer point ' +
  'draft review meeting project garden recipe budget travel reading history science music study notebook'
).split(' ');

type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function sentence(random: Random, words: number): string {
  const list = Array.from({ length: words }, () => pick(random, WORDS));
  const text = list.join(' ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

function sentences(random: Random, count: number): string {
  return Array.from({ length: count }, () => sentence(random, 8 + Math.floor(random() * 12))).join(' ');
}

function textNode(text: string): JSONContent {
  return { type: 'text', text };
}

function paragraph(text: string): JSONContent {
  return { type: 'paragraph', content: [textNode(text)] };
}

function heading(level: number, text: string): JSONContent {
  return { type: 'heading', attrs: { level }, content: [textNode(text)] };
}

function list(type: 'bulletList' | 'orderedList', items: string[]): JSONContent {
  return { type, content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })) };
}

function doc(content: JSONContent[]): JSONContent {
  return { type: 'doc', content };
}

/** One printed page of text: a heading, seven paragraphs, and a short list (about 460 words). */
function page(random: Random, number: number): JSONContent[] {
  const items = Array.from({ length: 5 }, () => sentence(random, 5 + Math.floor(random() * 6)));
  return [
    heading(2, `Part ${number}: ${sentence(random, 4).slice(0, -1)}`),
    paragraph(sentences(random, 5)),
    paragraph(sentences(random, 5)),
    paragraph(sentences(random, 4)),
    list(number % 2 === 0 ? 'orderedList' : 'bulletList', items),
    paragraph(sentences(random, 5)),
    paragraph(sentences(random, 4)),
    paragraph(sentences(random, 4)),
    paragraph(sentences(random, 4)),
  ];
}

/** A document about `pages` printed pages long. */
export function longDocument(pages: number, seed = 20): JSONContent {
  const random = seeded(seed);
  const content = [heading(1, 'A twenty-page note')];
  for (let number = 1; number <= pages; number++) content.push(...page(random, number));
  return doc(content);
}

/** A short note: a heading and a few paragraphs. */
function shortNote(seed: number, paragraphs: number): JSONContent {
  const random = seeded(seed);
  const content = [heading(3, sentence(random, 3).slice(0, -1))];
  for (let index = 0; index < paragraphs; index++) content.push(paragraph(sentences(random, 2)));
  return doc(content);
}

/** A note that is mostly a list. */
function listNote(seed: number, type: 'bulletList' | 'orderedList', items: number): JSONContent {
  const random = seeded(seed);
  const entries = Array.from({ length: items }, () => sentence(random, 4 + Math.floor(random() * 5)));
  return doc([heading(3, sentence(random, 2).slice(0, -1)), list(type, entries)]);
}

/** A medium note with headings, paragraphs, and a list. */
function mediumNote(seed: number, sections: number): JSONContent {
  const random = seeded(seed);
  const content: JSONContent[] = [];
  for (let index = 0; index < sections; index++) {
    content.push(heading(3, sentence(random, 3).slice(0, -1)), paragraph(sentences(random, 4)));
    if (index % 2 === 1) content.push(list('bulletList', [sentence(random, 5), sentence(random, 6)]));
  }
  return doc(content);
}

/** Where a note sits on the page, in world pixels, and what it holds. */
export interface NoteSpec {
  name: string;
  x: number;
  y: number;
  width: number;
  content: JSONContent;
}

/** Index of the short note the harness types into, and of the 20-page note. */
export const SHORT_NOTE = 0;
export const LONG_NOTE = 1;

/** The eight notes, spread over a page about 3,200 by 2,600 pixels, with the long note running below it. */
export function noteSpecs(): NoteSpec[] {
  return [
    { name: 'short', x: 160, y: 160, width: 420, content: shortNote(1, 2) },
    { name: 'long', x: 1320, y: 220, width: 640, content: longDocument(20) },
    { name: 'to-do', x: 160, y: 720, width: 380, content: listNote(3, 'bulletList', 8) },
    { name: 'medium', x: 640, y: 1240, width: 480, content: mediumNote(4, 3) },
    { name: 'aside', x: 2320, y: 300, width: 380, content: shortNote(5, 1) },
    { name: 'outline', x: 2320, y: 1000, width: 520, content: mediumNote(6, 4) },
    { name: 'essay', x: 200, y: 1800, width: 600, content: mediumNote(7, 5) },
    { name: 'steps', x: 2320, y: 2000, width: 420, content: listNote(8, 'orderedList', 10) },
  ];
}

/** Counts the words in a document. */
export function wordCount(node: JSONContent): number {
  const own = node.text ? node.text.split(/\s+/).filter(Boolean).length : 0;
  return own + (node.content ?? []).reduce((sum, child) => sum + wordCount(child), 0);
}

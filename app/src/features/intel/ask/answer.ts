// Ask your notes (Phase 12): a question in plain words, an answer from the person's own pages, and the pages and
// paragraphs it used, so the answer can be checked. The seam is `AnswerEngine`: a local language model can write a
// fluent answer from the passages. Until one is installed, the lexical engine answers by quoting the sentences of the
// best passages that share the question's words, and says so. Either way the passages come from the vector index on
// this device, and nothing is sent anywhere.
import { embed } from '../meaning/embed';
import { tokens } from '../meaning/embed';
import { findByMeaning } from '../meaning/engine';

export interface Passage {
  pageId: string;
  title: string;
  block: string | null;
  text: string;
  score: number;
}

export interface Answer {
  /** The answer, with a marker like [1] after each statement that comes from a passage. */
  text: string;
  /** The passages it used, in the order of the markers. */
  sources: Passage[];
  /** The engine that wrote it, so the screen can say how. */
  engine: string;
  /** True when the engine quoted the passages and did not compose new sentences. */
  quoted: boolean;
}

export interface AnswerEngine {
  readonly name: string;
  /** The answer from these passages, or null when they don't hold one. */
  answer(question: string, passages: readonly Passage[]): Promise<Omit<Answer, 'engine'> | null>;
}

function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/g) ?? []).map((sentence) => sentence.trim()).filter((s) => s.length > 3);
}

/** The most sentences the lexical answer quotes. */
export const MAX_QUOTES = 3;
/** A sentence needs at least this share of the question's words to count as an answer. */
export const MIN_OVERLAP = 0.2;

/** Quotes the sentences that share the most of the question's words. */
export const lexicalEngine: AnswerEngine = {
  name: 'quotes from your pages',
  answer(question, passages) {
    const wanted = new Set(tokens(question));
    if (wanted.size === 0) return Promise.resolve(null);
    // A word found in few passages says more than one found in all of them.
    const holders = new Map<string, number>();
    for (const passage of passages)
      for (const word of new Set(tokens(passage.text))) holders.set(word, (holders.get(word) ?? 0) + 1);
    const weight = (word: string) => 1 + Math.log((passages.length + 1) / ((holders.get(word) ?? 0) + 1));
    const total = [...wanted].reduce((sum, word) => sum + weight(word), 0);
    const scored: { sentence: string; source: number; score: number }[] = [];
    passages.forEach((passage, source) => {
      for (const sentence of sentencesOf(passage.text)) {
        const have = new Set(tokens(sentence));
        const overlap =
          [...wanted].filter((word) => have.has(word)).reduce((sum, word) => sum + weight(word), 0) / total;
        if (overlap >= MIN_OVERLAP) scored.push({ sentence, source, score: overlap + passage.score * 0.25 });
      }
    });
    const best = scored.sort((a, b) => b.score - a.score).slice(0, MAX_QUOTES);
    if (best.length === 0) return Promise.resolve(null);
    // Number the sources in the order they first appear in the answer.
    const order: number[] = [];
    for (const one of best) if (!order.includes(one.source)) order.push(one.source);
    const text = best
      .map((one) => `${one.sentence.replace(/[.!?]+$/, '')}. [${order.indexOf(one.source) + 1}]`)
      .join(' ');
    return Promise.resolve({ text, sources: order.map((at) => passages[at] as Passage), quoted: true });
  },
};

let engine: AnswerEngine = lexicalEngine;

/** Swaps in an engine, such as one backed by a local language model. Returns the function that puts the old one back. */
export function useAnswerEngine(next: AnswerEngine): () => void {
  const before = engine;
  engine = next;
  return () => {
    if (engine === next) engine = before;
  };
}

export function answerEngine(): AnswerEngine {
  return engine;
}

/** The passages that may hold the answer: the best paragraph of each of the pages closest to the question. */
export function passagesFor(question: string, limit = 6): Passage[] {
  return findByMeaning(question, limit).flatMap((hit) =>
    hit.chunk
      ? [{ pageId: hit.pageId, title: hit.title, block: hit.chunk.block, text: hit.chunk.text, score: hit.score }]
      : [],
  );
}

/** Answers the question from the pages, or returns null when the notes hold nothing for it. */
export async function askNotes(
  question: string,
  passages: readonly Passage[] = passagesFor(question),
): Promise<Answer | null> {
  if (!question.trim() || embed(question).every((v) => v === 0) || passages.length === 0) return null;
  const used = await engine.answer(question, passages);
  return used ? { ...used, engine: engine.name } : null;
}

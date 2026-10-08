// The quiz: random distinct questions, forgiving answer checking, and a plain count.
import { describe, expect, it } from 'vitest';
import {
  MAX_QUIZ,
  answerIsRight,
  choiceIsRight,
  expectedAnswers,
  normalize,
  pickQuestions,
  quizSize,
  score,
  shuffled,
} from './quiz';
import type { Card } from './types';

const basic = (id: string, back = 'answer'): Card => ({ id, kind: 'basic', front: id, back });
const cloze: Card = { id: 'z', kind: 'cloze', front: 'The {{mitochondria}} makes {{ATP}}.', back: '' };
const choice: Card = { id: 'c', kind: 'choice', front: 'Pick', back: '', choices: ['a', 'b', 'c'], answer: 1 };

/** A repeatable source of numbers between 0 and 1. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('choosing questions', () => {
  const cards = Array.from({ length: 20 }, (_, index) => basic(`c${index}`));
  it('picks distinct cards in a random order', () => {
    const picked = pickQuestions(cards, 8, sequence(1));
    expect(picked).toHaveLength(8);
    expect(new Set(picked.map((one) => one.id)).size).toBe(8);
    expect(pickQuestions(cards, 8, sequence(2)).map((one) => one.id)).not.toEqual(picked.map((one) => one.id));
    expect(
      shuffled(cards, sequence(3))
        .map((one) => one.id)
        .sort(),
    ).toEqual(cards.map((one) => one.id).sort());
  });
  it('keeps the size sensible', () => {
    expect(quizSize(0, 10)).toBe(0);
    expect(quizSize(5, 10)).toBe(5);
    expect(quizSize(5, 0)).toBe(1);
    expect(quizSize(500, 500)).toBe(MAX_QUIZ);
    expect(quizSize(30, Number.NaN)).toBe(30);
    expect(pickQuestions([], 5)).toEqual([]);
  });
  it('does not change the deck it picks from', () => {
    const before = cards.map((one) => one.id);
    pickQuestions(cards, 10, sequence(4));
    expect(cards.map((one) => one.id)).toEqual(before);
  });
});

describe('checking answers', () => {
  it('ignores case, spaces, accents, and punctuation', () => {
    expect(normalize('  The  Café, (Paris)! ')).toBe('the cafe paris');
    expect(answerIsRight(basic('q', 'Paris'), ['  paris. '])).toBe(true);
    expect(answerIsRight(basic('q', 'Paris'), ['London'])).toBe(false);
    expect(answerIsRight(basic('q', 'Paris'), [''])).toBe(false);
  });
  it('accepts any of the ways an answer is written', () => {
    const water = basic('q', 'H2O / water');
    expect(answerIsRight(water, ['Water'])).toBe(true);
    expect(answerIsRight(water, ['h2o'])).toBe(true);
    expect(answerIsRight(basic('q', 'red; crimson'), ['crimson'])).toBe(true);
  });
  it('needs every blank of a fill in the blank card', () => {
    expect(expectedAnswers(cloze)).toEqual(['mitochondria', 'ATP']);
    expect(answerIsRight(cloze, ['Mitochondria', 'atp'])).toBe(true);
    expect(answerIsRight(cloze, ['Mitochondria', 'ADP'])).toBe(false);
    expect(answerIsRight(cloze, ['Mitochondria'])).toBe(false);
  });
  it('checks a multiple choice card by the option picked', () => {
    expect(choiceIsRight(choice, 1)).toBe(true);
    expect(choiceIsRight(choice, 0)).toBe(false);
    expect(choiceIsRight(basic('q'), 0)).toBe(false);
  });
});

describe('the score', () => {
  it('counts right answers and gives a whole percent', () => {
    expect(score([true, true, false])).toEqual({ right: 2, total: 3, percent: 67 });
    expect(score([])).toEqual({ right: 0, total: 0, percent: 0 });
    expect(score([true])).toEqual({ right: 1, total: 1, percent: 100 });
  });
});

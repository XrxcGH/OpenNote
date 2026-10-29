import { describe, expect, it } from 'vitest';
import { askNotes, lexicalEngine, useAnswerEngine } from './answer';
import type { Passage } from './answer';

const passage = (pageId: string, title: string, text: string, score = 0.5): Passage => ({
  pageId,
  title,
  block: `${pageId}-b`,
  text,
  score,
});

const passages = [
  passage('trip', 'Trip', 'The flight to Rome leaves at 9 on Friday. Pack a light jacket.'),
  passage('class', 'Biology', 'The exam covers cells and energy. It is on Monday.'),
];

describe('the answer from quoted sentences', () => {
  it('quotes the sentence that shares the question’s words and cites its page', async () => {
    const answer = await askNotes('When does the flight to Rome leave?', passages);
    expect(answer?.text).toBe('The flight to Rome leaves at 9 on Friday. [1]');
    expect(answer?.sources.map((source) => source.pageId)).toEqual(['trip']);
    expect(answer?.quoted).toBe(true);
    expect(answer?.engine).toBe(lexicalEngine.name);
  });

  it('numbers sources in the order they appear', async () => {
    const answer = await askNotes('What is on Monday and what time does the flight leave?', passages);
    expect(answer?.sources).toHaveLength(2);
    expect(answer?.text).toMatch(/\[1\].*\[2\]|\[2\].*\[1\]/);
  });

  it('says nothing when the pages do not hold an answer', async () => {
    expect(await askNotes('Who won the chess match?', passages)).toBeNull();
    expect(await askNotes('   ', passages)).toBeNull();
    expect(await askNotes('anything', [])).toBeNull();
  });
});

describe('another engine', () => {
  it('can replace the quoting engine and be removed again', async () => {
    const restore = useAnswerEngine({
      name: 'test model',
      answer: async (_question, found) => ({ text: 'Friday. [1]', sources: [found[0] as Passage], quoted: false }),
    });
    const answer = await askNotes('When is the flight?', passages);
    expect(answer).toMatchObject({ engine: 'test model', quoted: false });
    restore();
    expect((await askNotes('When does the flight to Rome leave?', passages))?.engine).toBe(lexicalEngine.name);
  });
});

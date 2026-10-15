// The contracts of the three seams a local model plugs into (A3-23): WritingEngine, AnswerEngine, and Embedder. Every
// engine, the built-in stand-ins, and any model engine put behind a fallback, must keep the same promises, so the
// screens above them never care which one is running.
import { describe, expect, it } from 'vitest';
import { askNotes, lexicalEngine, useAnswerEngine } from '../ask/answer';
import type { AnswerEngine, Passage } from '../ask/answer';
import { builtInEmbedder, similarity } from '../meaning/embed';
import type { Embedder } from '../meaning/embed';
import { WRITING_TOOLS, ruleBasedEngine, useWritingEngine, writingEngine } from '../writing/ops';
import type { WritingEngine } from '../writing/ops';
import { withAnswerFallback, withWritingFallback } from './fallback';

const SAMPLE = 'Teh meeting is at 9. We should definately review the plan, and then we can decide what to do next.';

const passages: Passage[] = [
  { pageId: 'trip', title: 'Trip', block: 'b1', text: 'The flight to Rome leaves at 9 on Friday.', score: 0.6 },
  { pageId: 'class', title: 'Biology', block: 'b2', text: 'The exam covers cells and energy.', score: 0.4 },
];

const failingWriter: WritingEngine = {
  name: 'model that fails',
  run: () => Promise.reject(new Error('The model is gone.')),
};
const failingAnswerer: AnswerEngine = {
  name: 'model that fails',
  answer: () => Promise.reject(new Error('The model is gone.')),
};

describe.each([
  ['the rule-based writing engine', ruleBasedEngine],
  ['a failing model behind the rule-based engine', withWritingFallback(failingWriter)],
])('WritingEngine: %s', (_name, engine) => {
  it.each(WRITING_TOOLS)('gives text and a Markdown flag for %s, and leaves the input alone', async (tool) => {
    const before = SAMPLE;
    const result = await engine.run(tool, SAMPLE);
    expect(typeof result.text).toBe('string');
    expect(typeof result.markdown).toBe('boolean');
    expect(SAMPLE).toBe(before);
  });

  it('gives the same answer for the same text', async () => {
    expect(await engine.run('proofread', SAMPLE)).toEqual(await engine.run('proofread', SAMPLE));
  });

  it('gives a name for the screen to show', () => {
    expect(engine.name.length).toBeGreaterThan(0);
  });
});

describe('a model engine behind the fallback', () => {
  it('is used while it works, and the stand-in answers when it fails', async () => {
    let broken = false;
    const model: WritingEngine = {
      name: 'test model',
      run: async (tool, text) => {
        if (broken) throw new Error('out of memory');
        return { text: `${tool}: ${text}`, markdown: false };
      },
    };
    const engine = withWritingFallback(model);
    expect(await engine.run('rewrite', 'hello there')).toEqual({ text: 'rewrite: hello there', markdown: false });
    expect(engine.name).toBe('test model');
    broken = true;
    expect(await engine.run('proofread', 'teh plan')).toEqual(await ruleBasedEngine.run('proofread', 'teh plan'));
    expect(engine.name).toBe(ruleBasedEngine.name);
    broken = false;
    await engine.run('rewrite', 'hello there');
    expect(engine.name).toBe('test model');
  });

  it('plugs into the page behind the writing tools and comes out again', async () => {
    const remove = useWritingEngine(withWritingFallback(failingWriter));
    expect((await writingEngine().run('proofread', 'teh plan')).text).toBe(
      (await ruleBasedEngine.run('proofread', 'teh plan')).text,
    );
    remove();
    expect(writingEngine()).toBe(ruleBasedEngine);
  });
});

describe.each([
  ['the quoting engine', lexicalEngine],
  ['a failing model behind the quoting engine', withAnswerFallback(failingAnswerer)],
])('AnswerEngine: %s', (_name, engine) => {
  it('cites only the passages it was given, with markers that point at its sources', async () => {
    const answer = await engine.answer('When does the flight to Rome leave?', passages);
    expect(answer).not.toBeNull();
    for (const source of answer?.sources ?? []) expect(passages).toContain(source);
    const markers = [...(answer?.text.matchAll(/\[(\d+)\]/g) ?? [])].map((m) => Number(m[1]));
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) expect(marker).toBeGreaterThanOrEqual(1);
    for (const marker of markers) expect(marker).toBeLessThanOrEqual(answer?.sources.length ?? 0);
  });

  it('answers nothing when the passages hold nothing for the question', async () => {
    expect(await engine.answer('Who won the chess match?', passages)).toBeNull();
  });
});

describe('a model engine behind the answer fallback', () => {
  it('names the engine that wrote the answer', async () => {
    let broken = false;
    const model: AnswerEngine = {
      name: 'test model',
      answer: async (_question, found) => {
        if (broken) throw new Error('out of memory');
        return { text: 'Friday. [1]', sources: [found[0] as Passage], quoted: false };
      },
    };
    const remove = useAnswerEngine(withAnswerFallback(model));
    expect((await askNotes('When does the flight to Rome leave?', passages))?.engine).toBe('test model');
    broken = true;
    const answer = await askNotes('When does the flight to Rome leave?', passages);
    expect(answer).toMatchObject({ engine: lexicalEngine.name, quoted: true });
    remove();
  });
});

describe.each([['the built-in embedder', builtInEmbedder as Embedder]])('Embedder: %s', (_name, embedder) => {
  it('gives vectors of its stated size, and the same one for the same text', () => {
    const a = embedder.embed('Buy milk and bread');
    expect(a).toHaveLength(embedder.dim);
    expect(Array.from(embedder.embed('Buy milk and bread'))).toEqual(Array.from(a));
  });

  it('keeps vectors at length one, or all zero for text with no words', () => {
    const length = (v: Float32Array) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    expect(length(embedder.embed('Pick up the car from the garage'))).toBeCloseTo(1, 3);
    expect(length(embedder.embed('   '))).toBe(0);
  });

  it('puts text about one thing nearer than text about another', () => {
    const car = embedder.embed('I need to buy a new car');
    const same = embedder.embed('Purchasing an automobile this week');
    const other = embedder.embed('The cell membrane controls what enters the cell');
    expect(similarity(car, same)).toBeGreaterThan(similarity(car, other));
  });
});

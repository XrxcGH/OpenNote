import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSpelling } from '../../../platform/web/spelling';
import type { SpellingClient } from '../../../platform/types';
import { createSpellingEngine, MAX_ITEMS } from './engine';
import type { SpellingRules } from './engine';

const RULES: SpellingRules = {
  enabled: true,
  languages: [],
  personalWords: [],
  ignoreUppercase: true,
  ignoreWithDigits: true,
};

function counted(client: SpellingClient = createWebSpelling()) {
  const calls: { texts: string[]; languages: readonly string[] }[] = [];
  const spy: SpellingClient = {
    ...client,
    check: (items, languages) => {
      calls.push({ texts: items.map((item) => item.text), languages });
      return client.check(items, languages);
    },
  };
  return { client: spy, calls };
}

const idleNow = { typingDelayMs: 500, idle: (run: () => void) => setTimeout(run, 0) };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

afterEach(() => {
  vi.useRealTimers();
});

describe('the spelling engine', () => {
  it('checks a text once and answers from the cache after that', async () => {
    const { client, calls } = counted();
    const engine = createSpellingEngine(client, RULES, idleNow);
    expect(engine.errorsFor('I recieve it')).toBeNull();
    engine.check(['I recieve it'], 'now');
    engine.check(['I recieve it'], 'now');
    await settle();
    expect(engine.errorsFor('I recieve it')).toEqual([{ start: 2, length: 7 }]);
    engine.check(['I recieve it'], 'idle');
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('sends textblocks in view before the rest, in requests of at most 200', async () => {
    const { client, calls } = counted();
    const engine = createSpellingEngine(client, RULES, idleNow);
    const rest = Array.from({ length: MAX_ITEMS + 10 }, (_, index) => `word ${index}`);
    engine.check(rest, 'idle');
    engine.check(['in view teh'], 'now');
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[0].texts).toEqual(['in view teh']);
    expect(calls.slice(1).map((call) => call.texts.length)).toEqual([MAX_ITEMS, 10]);
  });

  it('checks typed text only after typing pauses for 500 ms, keeping the latest text per textblock', async () => {
    vi.useFakeTimers();
    const { client, calls } = counted();
    const engine = createSpellingEngine(client, RULES, idleNow);
    engine.requestCheck('a:1', 'te');
    vi.advanceTimersByTime(300);
    engine.requestCheck('a:1', 'teh');
    vi.advanceTimersByTime(499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ texts: ['teh'], languages: [] }]);
  });

  it('hides personal, ignored, capitalized, and numbered words without checking again', async () => {
    const client: SpellingClient = {
      ...createWebSpelling(),
      check: (items) =>
        Promise.resolve(
          items.map(({ id, text }) => ({
            id,
            errors: [...text.matchAll(/\S+/g)].map((match) => ({ start: match.index, length: match[0].length })),
          })),
        ),
    };
    const { client: spy, calls } = counted(client);
    const engine = createSpellingEngine(spy, { ...RULES, personalWords: ['opennote', 'McCoy'] }, idleNow);
    const text = 'OpenNote McCoy mccoy NASA abc1 teh';
    engine.check([text], 'now');
    await settle();
    const words = () => engine.errorsFor(text)?.map((error) => text.slice(error.start, error.start + error.length));
    expect(words()).toEqual(['mccoy', 'teh']);
    engine.ignore('teh');
    expect(words()).toEqual(['mccoy']);
    engine.setRules({ ...RULES, ignoreUppercase: false });
    expect(words()).toEqual(['OpenNote', 'McCoy', 'mccoy', 'NASA']);
    expect(calls).toHaveLength(1);
  });

  it('adds and removes personal words through the client', async () => {
    const { client } = counted();
    const engine = createSpellingEngine(client, RULES, idleNow);
    const changes: string[] = [];
    engine.onChange((kind) => changes.push(kind));
    engine.check(['teh'], 'now');
    await settle();
    await engine.addWord('teh');
    expect(engine.errorsFor('teh')).toEqual([]);
    await engine.removeWord('teh');
    expect(engine.errorsFor('teh')).toHaveLength(1);
    expect(changes).toEqual(['results', 'rules', 'rules']);
  });

  it('keys results by language, and turns off when no language has a checker', async () => {
    const { client, calls } = counted();
    const engine = createSpellingEngine(client, RULES, idleNow);
    engine.check(['teh'], 'now');
    await settle();
    engine.setRules({ ...RULES, languages: ['fr-FR'] });
    await settle();
    expect(engine.active()).toBe(false);
    expect(engine.errorsFor('teh')).toEqual([]);
    engine.setRules({ ...RULES, languages: ['en-US'] });
    await settle();
    expect(engine.errorsFor('teh')).toBeNull();
    engine.check(['teh'], 'now');
    await settle();
    expect(calls.map((call) => call.languages)).toEqual([[], ['en-US']]);
  });
});

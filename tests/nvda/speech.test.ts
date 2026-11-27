import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heardInOrder, listenFor } from './speech.ts';

test('heardInOrder wants each phrase after the one before it', () => {
  assert.equal(heardInOrder('Suggestion: a\nInserted: a', [/Suggestion: a/, /Inserted: a/]), true);
  assert.equal(heardInOrder('Inserted: a\nSuggestion: a', [/Suggestion: a/, /Inserted: a/]), false);
  assert.equal(heardInOrder('', [/x/]), false);
});

test('listenFor keeps reading until NVDA has said the phrases', async () => {
  // NVDA speaks late: the first two reads are empty. A single read after a fixed pause would have failed.
  const reads = [[], [], ['Suggestion: a'], ['Suggestion: a', 'Inserted: a']];
  let at = 0;
  const nvda = { spokenPhraseLog: async () => reads[Math.min(at++, reads.length - 1)]! };
  const log = await listenFor(nvda, [/Suggestion: a/, /Inserted: a/], { sleep: async () => undefined });
  assert.equal(log, 'Suggestion: a\nInserted: a');
  assert.equal(at, 4);
});

test('listenFor gives up after the timeout and returns what was said', async () => {
  const nvda = { spokenPhraseLog: async () => ['p', 'r', 'i'] };
  const log = await listenFor(nvda, [/Suggestion/], { timeoutMs: 1000, pollMs: 250, sleep: async () => undefined });
  assert.equal(log, 'p\nr\ni');
});

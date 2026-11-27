import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heardInOrder, listenFor, pressUntilHeard } from './speech.ts';

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

test('pressUntilHeard presses the key again when NVDA said only the selection', async () => {
  // The first press is answered with the selection alone, as on the run of 2026-11-27 that failed.
  const said: string[] = [];
  const presses: string[] = [];
  const nvda = {
    spokenPhraseLog: async () => said,
    press: async (key: string) => {
      presses.push(key);
      said.push(presses.length === 1 ? 'totl selected' : "Line 1: Undefined name totl' (test)");
    },
  };
  const log = await pressUntilHeard(nvda, 'F8', [/Line 1: Undefined name '?totl/], {
    timeoutMs: 500,
    sleep: async () => undefined,
  });
  assert.deepEqual(presses, ['F8', 'F8']);
  assert.match(log, /Line 1: Undefined name/);
});

test('pressUntilHeard stops after its attempts and returns what was said', async () => {
  const presses: string[] = [];
  const nvda = { spokenPhraseLog: async () => ['totl selected'], press: async (key: string) => void presses.push(key) };
  const log = await pressUntilHeard(nvda, 'F8', [/Line 1/], {
    attempts: 2,
    timeoutMs: 250,
    sleep: async () => undefined,
  });
  assert.equal(presses.length, 2);
  assert.equal(log, 'totl selected');
});

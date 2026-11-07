// The time limit of Find in a real browser. A pattern the static check accepts that backtracks without end stops
// at the limit with the problem slow, and the next search still works.
import { expect, it } from 'vitest';
import { scanTexts } from './scan';

const regex = { caseSensitive: false, wholeWord: false, regex: true };
const wildcards = { caseSensitive: false, wholeWord: false, wildcards: true };
const LONG = 'a'.repeat(10_000);

it('stops a catastrophic regular expression at the time limit', async () => {
  const started = performance.now();
  expect(await scanTexts([LONG], 'a*a*a*a*c', regex, 400)).toBe('slow');
  expect(performance.now() - started).toBeLessThan(3000);
});

it('stops a catastrophic wildcard pattern at the time limit', async () => {
  const started = performance.now();
  expect(await scanTexts([LONG], '*a*a*a*c', wildcards, 400)).toBe('slow');
  expect(performance.now() - started).toBeLessThan(3000);
});

it('still searches after a stop', async () => {
  const found = await scanTexts(['one two', 'two'], 'two', regex, 2000);
  expect(found).not.toBe('slow');
  expect(found).toEqual([
    [expect.objectContaining({ start: 4, end: 7 })],
    [expect.objectContaining({ start: 0, end: 3 })],
  ]);
});

it('runs a fast search after a slow one that is still running', async () => {
  const slow = scanTexts([LONG], 'a*a*a*a*c', regex, 5000);
  const fast = scanTexts(['one two'], 'two', regex, 2000);
  expect(await slow).toBe('superseded');
  expect(await fast).toEqual([[expect.objectContaining({ start: 4, end: 7 })]]);
});

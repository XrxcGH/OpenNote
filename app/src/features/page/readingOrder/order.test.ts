// The reading order agrees with the Rust core on the shared fixtures, and moves one block at a time.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PageJson } from '../../../services/pages/types';
import { moveInOrder, readingOrder } from './order';

interface Case {
  name: string;
  about: string;
  page: PageJson;
  expected: string[];
}

const url = new URL('../../../../../docs/format/fixtures/reading-order/cases.json', import.meta.url);
const { cases } = JSON.parse(readFileSync(url, 'utf8')) as { cases: Case[] };

describe('the reading order', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(readingOrder(c.page.blocks, c.page.view.readingOrder ?? [])).toEqual(c.expected);
  });

  it('moves a block up or down, and stops at the ends', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveInOrder(['a', 'b', 'c'], 'c', 1)).toBeNull();
  });
});

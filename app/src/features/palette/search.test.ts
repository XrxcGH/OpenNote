import { describe, expect, it } from 'vitest';
import type { PaletteProvider, PaletteResult } from '../../registries/types';
import { PaletteSearch, RESULT_LIMIT, providersFor, rank } from './search';

function result(id: string, group: string, points: number): PaletteResult {
  return { id, group, title: id, score: points, run() {} };
}

describe('rank', () => {
  it('drops non-matches, orders by score, and groups by where the best result ranks', () => {
    const ranked = rank([
      result('a', 'pages', 10),
      result('b', 'commands', 50),
      result('c', 'pages', 40),
      result('none', 'pages', 0),
    ]);
    expect(ranked.groups.map((group) => group.id)).toEqual(['commands', 'pages']);
    expect(ranked.flat.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(ranked.total).toBe(3);
  });

  it('keeps the provider order for ties and caps the list at 100', () => {
    const many = Array.from({ length: RESULT_LIMIT + 20 }, (_, i) => result(`r${i}`, 'pages', 5));
    const ranked = rank(many);
    expect(ranked.flat).toHaveLength(RESULT_LIMIT);
    expect(ranked.flat[0].id).toBe('r0');
    expect(ranked.total).toBe(RESULT_LIMIT + 20);
  });
});

describe('PaletteSearch', () => {
  const now: PaletteProvider = { id: 'now', filter: 'commands', search: () => [result('now', 'commands', 5)] };
  const later = (ms: number, id: string): PaletteProvider => ({
    id,
    filter: 'pages',
    search: (_query, signal) =>
      new Promise((resolve) =>
        setTimeout(() => resolve(signal.aborted ? [result('stale', 'pages', 99)] : [result(id, 'pages', 9)]), ms),
      ),
  });
  const broken: PaletteProvider = {
    id: 'broken',
    filter: 'all' as never,
    search: () => {
      throw new Error('nope');
    },
  };

  it('shows quick answers at once, adds slow ones later, and survives a broken provider', async () => {
    const search = new PaletteSearch();
    search.run('x', [now, broken, later(10, 'slow')]);
    expect(search.get().flat.map((r) => r.id)).toEqual(['now']);
    expect(search.get().settled).toBe(false);
    const ranked = await search.settled();
    expect(ranked.flat.map((r) => r.id)).toEqual(['slow', 'now']);
    expect(ranked.settled).toBe(true);
  });

  it('drops answers that arrive after a newer query', async () => {
    const search = new PaletteSearch();
    search.run('a', [later(20, 'first')]);
    search.run('b', [later(1, 'second')]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(search.get().flat.map((r) => r.id)).toEqual(['second']);
  });

  it('filters providers', () => {
    expect(providersFor([now, later(1, 'p')], 'pages').map((p) => p.id)).toEqual(['p']);
    expect(providersFor([now, later(1, 'p')], 'all')).toHaveLength(2);
  });
});

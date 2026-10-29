import { describe, expect, it } from 'vitest';
import { newSeriesId, seriesIdInView, seriesIdOf, seriesPages, SERIES_PROPERTY } from './seriesList';
import type { SeriesRow } from './seriesList';

const field = (value: string) => [{ id: 's', name: SERIES_PROPERTY, type: 'text' as const, value }];
const row = (page: string, created: number, id: string | null): SeriesRow => ({
  page,
  title: page,
  created,
  fields: id ? field(id) : [],
});

describe('series ids', () => {
  it('reads the id from the fields or the page view', () => {
    expect(seriesIdOf(field(' abc '))).toBe('abc');
    expect(seriesIdOf([])).toBeNull();
    expect(seriesIdOf(field('  '))).toBeNull();
    expect(seriesIdInView({ properties: { fields: field('xyz') } })).toBe('xyz');
    expect(seriesIdInView(undefined)).toBeNull();
  });

  it('makes ids that differ', () => {
    expect(newSeriesId()).toMatch(/^[0-9a-z]{8}$/);
    expect(newSeriesId()).not.toBe(newSeriesId());
  });
});

describe('the pages of a series', () => {
  it('lists only the series, oldest first', () => {
    const rows = [row('c', 30, 'one'), row('a', 10, 'one'), row('x', 5, 'two'), row('b', 20, 'one'), row('n', 1, null)];
    expect(seriesPages(rows, 'one').map((r) => r.page)).toEqual(['a', 'b', 'c']);
    expect(seriesPages(rows, 'none')).toEqual([]);
  });
});

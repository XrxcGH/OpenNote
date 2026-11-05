// What a smart table keeps in data.smart. Keys a later version wrote stay, at the top and in columns (SPEC 2.9).
// A change writes only the keys it changed, as a JSON merge patch (RFC 7396).
import { describe, expect, it } from 'vitest';
import { applyMergePatch } from '../../../platform/mergePatch';
import { EMPTY_SMART, pruneSmart, readSmart, smartPatch, withColumn } from './data';

const stored = () => ({
  smart: {
    columns: { c: { type: 'number', futureKey: 1 }, d: { type: 'text' } },
    filters: [],
    charts: [],
    futureTop: true,
  },
});

describe('data.smart', () => {
  it('keeps unknown keys at the top and in columns when decimals change, and patches only those', () => {
    const data = stored();
    const before = readSmart(data);
    expect(before.futureTop).toBe(true);
    expect(before.columns.c).toEqual({ type: 'number', futureKey: 1 });
    const next = withColumn(before, 'c', { decimals: 2 });
    const patch = smartPatch(next, before);
    expect(patch).toEqual({ smart: { columns: { c: { decimals: 2 } } } });
    const saved = applyMergePatch(data, patch);
    expect(saved.smart).toEqual({
      columns: { c: { type: 'number', futureKey: 1, decimals: 2 }, d: { type: 'text' } },
      filters: [],
      charts: [],
      futureTop: true,
    });
    expect(readSmart(saved)).toEqual(next);
  });

  it('writes the whole object with unknown keys when it has nothing to compare with', () => {
    const next = withColumn(readSmart(stored()), 'c', { decimals: 2 });
    expect(smartPatch(next).smart).toMatchObject({ futureTop: true, columns: { c: { futureKey: 1, decimals: 2 } } });
  });

  it('sends null for a column it removes, and keeps unknown keys through a prune', () => {
    const before = readSmart(stored());
    const pruned = pruneSmart(before, ['c']);
    expect(pruned.futureTop).toBe(true);
    expect(smartPatch(pruned, before)).toEqual({ smart: { columns: { d: null } } });
  });

  it('drops data.smart only when nothing is left, unknown keys included', () => {
    expect(smartPatch(EMPTY_SMART)).toEqual({ smart: null });
    const onlyUnknown = readSmart({ smart: { futureTop: 1 } });
    expect(smartPatch(onlyUnknown).smart).toEqual({ futureTop: 1, columns: {}, filters: [], charts: [] });
  });

  it('still ignores known keys with values it cannot read', () => {
    const smart = readSmart({ smart: { columns: { c: { type: 'nope', decimals: 'x', futureKey: 'kept' } } } });
    expect(smart.columns.c).toEqual({ futureKey: 'kept' });
  });
});

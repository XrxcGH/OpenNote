import { describe, expect, it } from 'vitest';
import { categoryOf } from './checkCategories';

describe('notebook check categories', () => {
  it('sorts the core codes into plain categories', () => {
    expect(categoryOf('asset.checksum')).toBe('damaged');
    expect(categoryOf('history.assetMissing')).toBe('missing');
    expect(categoryOf('tree.entryWithoutFolder')).toBe('tree');
    expect(categoryOf('something.new')).toBe('other');
  });
});

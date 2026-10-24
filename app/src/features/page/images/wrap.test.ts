import { describe, expect, it } from 'vitest';
import { DEFAULT_WRAP_GAP, mergeData, wrapGapOf, wrapOf, wrapPatch } from './wrap';

describe('text wrap around images', () => {
  it('reads the mode and gap from block data, with safe defaults', () => {
    expect(wrapOf({})).toBe('alone');
    expect(wrapOf({ wrap: 'left' })).toBe('left');
    expect(wrapOf({ wrap: 'diagonal' })).toBe('alone');
    expect(wrapGapOf({})).toBe(DEFAULT_WRAP_GAP);
    expect(wrapGapOf({ wrapGap: 500 })).toBe(64);
    expect(wrapGapOf({ wrapGap: -4 })).toBe(0);
    expect(wrapGapOf({ wrapGap: 'wide' })).toBe(DEFAULT_WRAP_GAP);
  });

  it('keeps only what differs from the defaults', () => {
    expect(wrapPatch('alone', 30)).toEqual({ wrap: null, wrapGap: null });
    expect(wrapPatch('left', DEFAULT_WRAP_GAP)).toEqual({ wrap: 'left', wrapGap: null });
    expect(wrapPatch('right', 24)).toEqual({ wrap: 'right', wrapGap: 24 });
    expect(wrapPatch('inline', 24)).toEqual({ wrap: 'inline', wrapGap: null });
  });

  it('merges a patch the way the page does, with null removing a key', () => {
    const data = { asset: 'a', alt: 'Leaf', wrap: 'left', wrapGap: 24 };
    expect(mergeData(data, wrapPatch('alone', 16))).toEqual({ asset: 'a', alt: 'Leaf' });
    expect(mergeData({ asset: 'a' }, wrapPatch('right', 30))).toEqual({ asset: 'a', wrap: 'right', wrapGap: 30 });
  });
});

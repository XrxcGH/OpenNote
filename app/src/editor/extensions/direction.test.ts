// The DOM attributes direction.ts writes, worked out by hand from text DESIGN.md 2.2. Alignment is logical: start
// is the right edge of a right-to-left paragraph, and end is the left one.
import { describe, expect, it } from 'vitest';
import { directionDom, physicalAlign } from './direction';

describe('physical alignment', () => {
  it('maps start and end by direction, and leaves center and justify alone', () => {
    expect(physicalAlign('start', 'rtl')).toBe('right');
    expect(physicalAlign('end', 'rtl')).toBe('left');
    expect(physicalAlign('start', 'ltr')).toBe('left');
    expect(physicalAlign('end', 'ltr')).toBe('right');
    expect(physicalAlign(undefined, 'rtl')).toBe('right');
    expect(physicalAlign('center', 'rtl')).toBe('center');
    expect(physicalAlign('distribute', 'rtl')).toBe('justify');
  });
});

describe('direction DOM attributes', () => {
  it('sets nothing on a plain paragraph', () => {
    expect(directionDom({ dir: null, lang: null, align: null, hyphenate: null })).toBeNull();
  });

  it('writes dir, lang, and the physical side', () => {
    expect(directionDom({ dir: 'rtl', lang: 'ar-EG' })).toEqual({
      dir: 'rtl',
      lang: 'ar-EG',
      style: 'text-align: right',
    });
    expect(directionDom({ align: 'end' })).toEqual({ style: 'text-align: right' });
    expect(directionDom({ dir: 'rtl', align: 'center' })).toEqual({ dir: 'rtl' });
  });

  it('hyphenates from the paragraph, else from the page', () => {
    expect(directionDom({}, true)).toEqual({ style: 'hyphens: auto; -webkit-hyphens: auto' });
    expect(directionDom({ hyphenate: false }, true)).toEqual({ style: 'hyphens: manual; -webkit-hyphens: manual' });
    expect(directionDom({ hyphenate: true })).toEqual({ style: 'hyphens: auto; -webkit-hyphens: auto' });
  });

  it('ignores values outside the grammar', () => {
    expect(directionDom({ dir: 'up', lang: 'not a tag' })).toBeNull();
    // The decoration never writes dir="auto": a paragraph's first strong letter must not turn it around.
    expect(directionDom({ dir: 'auto' })).toBeNull();
  });
});

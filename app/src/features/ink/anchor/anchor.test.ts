import { describe, expect, it } from 'vitest';
import { codePoints, findAnchor, followDelta, offsetFrom, quoteAt, readAnchor } from './anchor';

const text = 'The quick brown fox jumps over the lazy dog. The quick brown fox sleeps.';

describe('anchors', () => {
  it('quotes the words around a place, counting code points', () => {
    const at = text.indexOf('jumps');
    expect(quoteAt(text, at)).toEqual({
      prefix: 'quick brown fox ',
      exact: 'jumps over t',
      suffix: 'he lazy dog. The',
    });
    expect(codePoints('a😀b')).toBe(3);
    expect(quoteAt('a😀bcd', 2).prefix).toBe('a😀');
  });

  it('finds the place again after words are added before it', () => {
    const at = text.indexOf('jumps');
    const quote = quoteAt(text, at);
    const edited = `Once upon a time. ${text}`;
    expect(findAnchor(edited, at, quote)).toBe(edited.indexOf('jumps'));
  });

  it('keeps the place when the words there are unchanged, and picks the nearest of two like it', () => {
    const second = text.lastIndexOf('The quick');
    const quote = quoteAt(text, second);
    expect(findAnchor(text, second, quote)).toBe(second);
    const edited = `${text} ${text}`;
    expect(findAnchor(edited, second + 1, quote)).toBe(second);
  });

  it('prefers the match with the right words around it', () => {
    const doc = 'cat sat. dog sat. cat sat.';
    const quote = quoteAt(doc, doc.indexOf('dog'));
    expect(findAnchor('cat sat. cat sat. dog sat.', 0, quote)).toBe('cat sat. cat sat. '.length);
  });

  it('loses the place when the words are gone, and keeps the stored one with no quote', () => {
    const quote = quoteAt(text, text.indexOf('jumps'));
    expect(findAnchor('Nothing alike at all.', 5, quote)).toBeNull();
    expect(findAnchor('Anything', 3, undefined)).toBe(3);
  });

  it('moves ink by however far its place moved', () => {
    const offset = offsetFrom({ x: 100, y: 50 }, { x: 110, y: 80 });
    expect(offset).toEqual({ dx: 10, dy: 30 });
    expect(followDelta({ x: 100, y: 90 }, offset, { x: 110, y: 80 })).toEqual({ x: 0, y: 40 });
  });

  it('reads an anchored ink block, and ignores other blocks', () => {
    expect(readAnchor({ role: 'layer' })).toBeNull();
    expect(readAnchor({ role: 'anchored' })).toBeNull();
    expect(
      readAnchor({ role: 'anchored', anchor: { block: 'b1', at: 4, quote: { exact: 'x' }, dx: 2, dy: 3 } }),
    ).toEqual({ block: 'b1', at: 4, quote: { prefix: '', exact: 'x', suffix: '' }, dx: 2, dy: 3 });
  });
});

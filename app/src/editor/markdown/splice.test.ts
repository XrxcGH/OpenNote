import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diffMarkdown, utf8Offset } from './splice';

const RUNS = Number(process.env.FC_RUNS ?? 1000);
const encoder = new TextEncoder();
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Strings with astral characters, accents, and the odd lone surrogate. */
const text = fc
  .array(fc.constantFrom('a', ' ', '\n', 'é', '中', '\u{1F600}', '\u{1F601}', '\u{10FFFF}', '\uD800', '\uDC00'), {
    maxLength: 30,
  })
  .map((parts) => parts.join(''));

describe('UTF-8 offsets', () => {
  it('equal the length TextEncoder gives for the text before the index', () => {
    fc.assert(
      fc.property(text, fc.nat(), (s, pick) => {
        const at = pick % (s.length + 1);
        fc.pre(at === 0 || at === s.length || !(isHigh(s.charCodeAt(at - 1)) && isLow(s.charCodeAt(at))));
        expect(utf8Offset(s, at)).toBe(encoder.encode(s.slice(0, at)).length);
      }),
      { numRuns: RUNS },
    );
  });

  it('clamp indexes outside the text', () => {
    expect(utf8Offset('éa', -1)).toBe(0);
    expect(utf8Offset('éa', 99)).toBe(3);
  });
});

describe('the splice between two strings', () => {
  it('turns the first into the second, and never splits a surrogate pair', () => {
    fc.assert(
      fc.property(text, text, (before, after) => {
        const splice = diffMarkdown(before, after);
        if (before === after) {
          expect(splice).toBeNull();
          return;
        }
        expect(splice).not.toBeNull();
        const { at, del, ins } = splice as NonNullable<typeof splice>;
        expect(before.slice(0, at) + ins + before.slice(at + del.length)).toBe(after);
        expect(before.slice(at, at + del.length)).toBe(del);
        const splits = (s: string, i: number) =>
          i > 0 && i < s.length && isHigh(s.charCodeAt(i - 1)) && isLow(s.charCodeAt(i));
        expect(splits(before, at) || splits(before, at + del.length)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });
});

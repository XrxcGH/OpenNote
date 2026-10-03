// Any string gives a valid document (ARCHITECTURE.md section 9.1): deep nesting, stray delimiters, HTML, carriage
// returns, and lone surrogates included. Hand-edited reserved syntax stays editable text (section 9.5).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shape } from '../shape';
import { propertyRuns } from './arbitrary';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

const RUNS = propertyRuns(400);
const TIMEOUT = 600_000;
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const piece = fc.constantFrom(
  '> ',
  '- ',
  '1. ',
  '  ',
  '    ',
  '\t',
  '\n',
  '\r',
  '\r\n',
  '\n\n',
  '*',
  '**',
  '_',
  '~~',
  '==',
  '`',
  '```',
  '$',
  '$$',
  '[',
  ']',
  '(',
  ')',
  '![',
  '<',
  '>',
  '<u>',
  '</u>',
  '<sub>',
  '<span data-color="moss">',
  '</span>',
  '<script>alert(1)</script>',
  '<!--',
  '-->',
  '<![CDATA[',
  '&#0;',
  '&amp;',
  '\\',
  '#',
  '{',
  '|',
  '[!note]',
  '[ ] ',
  '\uD800',
  '\uDC00',
  '\u{1F600}',
  '\0',
  'word',
);

const hostile = fc.array(piece, { maxLength: 60 }).map((parts) => parts.join(''));

/** Parsing gives a valid document, and the text it writes is clean and stable. */
function expectSafe(source: string): void {
  const parsed = parseTextBlock(source);
  parsed.check();
  const once = serializeTextBlock(parsed);
  expect(once).not.toMatch(/[\r\0]/);
  expect(LONE.test(once)).toBe(false);
  expect(serializeTextBlock(parseTextBlock(once)), JSON.stringify(source)).toBe(once);
}

describe('hostile input', () => {
  it(
    'never throws, and writing what it read is stable',
    () => {
      fc.assert(fc.property(hostile, expectSafe), { numRuns: RUNS });
    },
    TIMEOUT,
  );

  it('survives deep nesting and long delimiter runs', () => {
    const sources = [
      '> '.repeat(500) + 'deep',
      Array.from({ length: 200 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n'),
      '['.repeat(5000) + 'x' + ']'.repeat(5000),
      '*'.repeat(10_000),
      '_a'.repeat(5000),
      '<u>'.repeat(2000) + 'x',
      '`'.repeat(3000) + 'x',
      '$'.repeat(4000),
      '='.repeat(4000),
      '\\'.repeat(4000),
      '\r\n'.repeat(1000),
      '\uD800'.repeat(1000),
    ];
    for (const source of sources) expectSafe(source);
  });

  it('reads carriage returns as line ends and lone surrogates as replacement characters', () => {
    expect(serializeTextBlock(parseTextBlock('one\r\ntwo\rthree'))).toBe('one two three');
    expect(serializeTextBlock(parseTextBlock('a\uD800b'))).toBe('a�b');
  });

  it('writes no lone surrogate from math, image text, or a link', () => {
    const sources = ['$$\uD800$$', '$a\uDC00$', '![\uD800](x\uDC00)', '[a](b\uD800)', '$$\n\uD800\n$$'];
    // Inside a mark, the writer checks that its delimiters read back, which compares the cleaned text.
    for (const source of [...sources, '*$$\uDC00$$*', '*[a](b\uD800)*', '_![a\nb](c)_']) expectSafe(source);
  });
});

describe('hand-edited reserved syntax', () => {
  it('keeps a word-start # and a { as text, and escapes them on the next write', () => {
    const parsed = parseTextBlock('#biology notes {draft} and C# code');
    expect(shape(parsed)).toBe('doc(paragraph("#biology notes {draft} and C# code"))');
    expect(serializeTextBlock(parsed)).toBe('\\#biology notes \\{draft} and C# code');
  });

  it('keeps unknown or inert link schemes as links that are never turned into anything else', () => {
    const parsed = parseTextBlock('[a](ftp://x.y/z) [b](tel:123) [c](file:///etc/hosts) [d](opennote:page/x)');
    expect(shape(parsed)).toBe(
      'doc(paragraph(linkftp://x.y/z("a"), " ", linktel:123("b"), " ", linkfile:///etc/hosts("c"), " ", ' +
        'linkopennote:page/x("d")))',
    );
    expect(serializeTextBlock(parsed)).toBe(
      '[a](ftp://x.y/z) [b](tel:123) [c](file:///etc/hosts) [d](opennote:page/x)',
    );
  });
});

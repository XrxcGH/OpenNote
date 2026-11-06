// Known answers for the list numbering engine (spec 6.9; text DESIGN.md 7.1). Every expected value is worked by hand
// from the counting rule of its format, never taken from the code's output.
import { describe, expect, it } from 'vitest';
import { applyElementData } from '../markdown/elements';
import { parseTextBlock } from '../markdown/parse';
import { formatNumber, levelText, numberItems, readLists, shownStarts } from './numbering';
import type { NumberFormat } from './numbering';

const cases = (format: NumberFormat, pairs: [number, string][]) => pairs.map(([n, text]) => ({ format, n, text }));

/** Hand-worked answers for each format. */
const FORMAT_CASES = [
  ...cases('lowerLetter', [
    [1, 'a'],
    [26, 'z'],
    [27, 'aa'],
    [28, 'bb'],
    [52, 'zz'],
    [53, 'aaa'],
  ]),
  ...cases('upperLetter', [[28, 'BB']]),
  ...cases('upperRoman', [
    [1, 'I'],
    [4, 'IV'],
    [9, 'IX'],
    [14, 'XIV'],
    [40, 'XL'],
    [90, 'XC'],
    [400, 'CD'],
    [1994, 'MCMXCIV'],
    [3999, 'MMMCMXCIX'],
  ]),
  ...cases('lowerRoman', [[3999, 'mmmcmxcix']]),
  ...cases('decimalZero', [
    [1, '01'],
    [9, '09'],
    [10, '10'],
    [100, '100'],
  ]),
  ...cases('ordinal', [
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
  ]),
  ...cases('cardinalText', [
    [1, 'One'],
    [15, 'Fifteen'],
    [21, 'Twenty-one'],
    [100, 'One hundred'],
    [121, 'One hundred twenty-one'],
    [2005, 'Two thousand five'],
  ]),
  ...cases('ordinalText', [
    [1, 'First'],
    [2, 'Second'],
    [3, 'Third'],
    [5, 'Fifth'],
    [8, 'Eighth'],
    [9, 'Ninth'],
    [12, 'Twelfth'],
    [20, 'Twentieth'],
    [21, 'Twenty-first'],
    [100, 'One hundredth'],
  ]),
  ...cases('hebrew1', [
    [1, 'א'],
    [10, 'י'],
    [15, 'טו'],
    [16, 'טז'],
    [17, 'יז'],
    [115, 'קטו'],
    [500, 'תק'],
  ]),
  ...cases('hebrew2', [
    [1, 'א'],
    [22, 'ת'],
    [23, 'אא'],
  ]),
  ...cases('arabicAlpha', [
    [1, 'أ'],
    [2, 'ب'],
    [3, 'ت'],
    [28, 'ي'],
  ]),
  ...cases('arabicAbjad', [
    [1, 'أ'],
    [3, 'ج'],
    [28, 'غ'],
  ]),
  ...cases('hindiNumbers', [[105, '١٠٥']]),
  ...cases('thaiNumbers', [[42, '๔๒']]),
  ...cases('chineseCounting', [
    [1, '一'],
    [10, '十'],
    [11, '十一'],
    [20, '二十'],
    [105, '一百〇五'],
    [110, '一百一十'],
    [1000, '一千'],
  ]),
  ...cases('japaneseCounting', [
    [10, '十'],
    [11, '十一'],
    [100, '百'],
    [105, '百五'],
    [1234, '千二百三十四'],
  ]),
  ...cases('koreanCounting', [
    [1, '일'],
    [11, '십일'],
    [20, '이십'],
    [100, '백'],
  ]),
  ...cases('bullet', [[3, '']]),
  ...cases('none', [[3, '']]),
];

describe('number formats', () => {
  it.each(FORMAT_CASES)('$format $n is $text', ({ format, n, text }) => {
    expect(formatNumber(n, format)).toBe(text);
  });

  it('writes 0 in decimal where a format has no zero', () => {
    expect(formatNumber(0, 'lowerLetter')).toBe('0');
    expect(formatNumber(0, 'upperRoman')).toBe('0');
    expect(formatNumber(0, 'decimalZero')).toBe('00');
  });
});

describe('level text', () => {
  it('fills %1.%2. from each level: 1.1, 1.2, 2.1', () => {
    const formats: NumberFormat[] = ['decimal', 'decimal'];
    expect(levelText('%1.%2.', [1, 1], formats)).toBe('1.1.');
    expect(levelText('%1.%2.', [1, 2], formats)).toBe('1.2.');
    expect(levelText('%1.%2.', [2, 1], formats)).toBe('2.1.');
  });

  it('formats each level by its own format', () => {
    expect(levelText('(%1-%2)', [3, 2], ['upperRoman', 'lowerLetter'])).toBe('(III-b)');
    expect(levelText('Chapter %1', [4], ['cardinalText'])).toBe('Chapter Four');
  });

  it('writes a deeper %k, or a % without a digit, as it is', () => {
    expect(levelText('%1.%2', [5], ['decimal'])).toBe('5.%2');
    expect(levelText('100% %1 %0', [2], ['decimal'])).toBe('100% 2 %0');
  });
});

const ID = (n: number) => `01m3para${String(n).padStart(18, '0')}`;

/** A document of Markdown with the given `paras` entries on its elements, by place. */
function doc(markdown: string, paras: Record<number, unknown>, count: number) {
  const ids = Array.from({ length: count }, (_, i) => ID(i));
  const entries = Object.fromEntries(Object.entries(paras).map(([at, entry]) => [ids[Number(at)], entry]));
  return applyElementData(parseTextBlock(markdown), { ids, paras: entries });
}

describe('numbering a document', () => {
  it('counts on across a paragraph when items name the same list, and starts again on restart', () => {
    const markdown = '1. one\n2. two\n3. three\n\nA paragraph.\n\n1. four\n2. five';
    const list = { list: { id: 'l1' } };
    const continued = doc(markdown, { 0: list, 1: list, 2: list, 4: list, 5: list }, 6);
    expect(numberItems(continued).map((item) => item.label)).toEqual(['1.', '2.', '3.', '4.', '5.']);
    const restarted = doc(markdown, { 0: list, 1: list, 2: list, 4: { list: { id: 'l1', restart: true } } }, 6);
    expect(numberItems(restarted).map((item) => item.label)).toEqual(['1.', '2.', '3.', '1.', '2.']);
  });

  it('labels nested levels from the definition: 1.1, 1.2, 2.1', () => {
    const markdown = '1. a\n\n   1. b\n   2. c\n2. d\n\n   1. e';
    const lists = readLists({ l1: { levels: [{ text: '%1.' }, { format: 'decimal', text: '%1.%2.' }] } });
    const list = { list: { id: 'l1' } };
    const numbered = doc(markdown, { 0: list, 1: list, 2: list, 3: list, 4: list }, 5);
    expect(numberItems(numbered, lists).map((item) => item.label)).toEqual(['1.', '1.1.', '1.2.', '2.', '2.1.']);
  });

  it('gives plain Markdown lists Word and Docs defaults: decimal, then letters, then Roman numerals', () => {
    const markdown = '3. a\n\n   1. b\n\n      1. c\n   2. d';
    expect(numberItems(parseTextBlock(markdown)).map((item) => item.label)).toEqual(['3.', 'a.', 'i.', 'b.']);
  });

  it('writes the start number an ordered list shows for down-level readers: 4 when continued, 1 on restart', () => {
    const markdown = '1. one\n2. two\n3. three\n\nA paragraph.\n\n1. four';
    const list = { list: { id: 'l1' } };
    const continued = doc(markdown, { 0: list, 1: list, 2: list, 4: list }, 5);
    expect(shownStarts(continued).map((entry) => entry.start)).toEqual([4]);
    const restarted = doc('7. one\n\nA paragraph.\n\n5. two', { 0: list, 2: { list: { id: 'l1', restart: true } } }, 3);
    expect(shownStarts(restarted).map((entry) => entry.start)).toEqual([1, 1]);
  });

  it('reads only valid list definitions', () => {
    const lists = readLists({
      good: { levels: [{ format: 'upperRoman', start: 3 }] },
      'Bad-ID': { levels: [{}] },
      empty: { levels: [] },
      broken: { levels: ['x'] },
    });
    expect([...lists.keys()]).toEqual(['good']);
    expect(lists.get('good')).toEqual([{ format: 'upperRoman', start: 3 }]);
  });
});

describe('label size caps', () => {
  it('shows a letter label of more than 64 letters in decimal', () => {
    // 1664 = 26 x 64: the 64th round of z. 1665 would need 65 letters.
    expect(formatNumber(1664, 'lowerLetter')).toBe('z'.repeat(64));
    expect(formatNumber(1665, 'lowerLetter')).toBe('1665');
    expect(formatNumber(1665, 'upperLetter')).toBe('1665');
    // Hebrew has 22 letters (22 x 64 = 1408) and Arabic 28 (28 x 64 = 1792).
    expect(formatNumber(1408, 'hebrew2')).toBe('ת'.repeat(64));
    expect(formatNumber(1409, 'hebrew2')).toBe('1409');
    expect(formatNumber(1793, 'arabicAlpha')).toBe('1793');
    expect(formatNumber(1793, 'arabicAbjad')).toBe('1793');
    expect(formatNumber(999_999_999, 'lowerLetter')).toBe('999999999');
  });

  it('cuts a label off at 256 characters', () => {
    expect(levelText('%1'.repeat(32), [1664], ['upperLetter'])).toBe('Z'.repeat(256));
  });

  it('numbers a hostile list quickly: a 9-digit nested start and a %1 x 32 pattern', () => {
    const markdown = '1. a\n\n   999999999. b\n   999999999. c\n2. d';
    const lists = readLists({ l1: { levels: [{ format: 'upperLetter', start: 1664, text: '%1'.repeat(32) }] } });
    const hostile = doc(markdown, { 3: { list: { id: 'l1' } } }, 4);
    const start = performance.now();
    const labels = numberItems(hostile, lists).map((item) => item.label);
    expect(performance.now() - start).toBeLessThan(50);
    // The nested items need more than 64 letters, so they show in decimal. The second stays at the Markdown cap.
    expect(labels).toEqual(['1.', '999999999.', '999999999.', 'Z'.repeat(256)]);
  });
});

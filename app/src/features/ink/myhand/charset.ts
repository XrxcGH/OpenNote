// What the calibration page asks for (flag ink.myHandwriting): every character on its own, a few times each, then a
// few sentences that together use every letter and the punctuation, for spacing, slant, joins, and the baseline. The
// math and science symbols are asked for only in their own optional section and from uploads.

/** How many times each character is written on the calibration page. */
export const SAMPLES_PER_CHAR = 3;

const range = (from: string, to: string): string[] =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) =>
    String.fromCharCode(from.charCodeAt(0) + i),
  );

export const LOWERCASE: readonly string[] = range('a', 'z');
export const UPPERCASE: readonly string[] = range('A', 'Z');
export const DIGITS: readonly string[] = range('0', '9');
/** Common punctuation and special characters, in the order the page asks for them. */
export const PUNCTUATION: readonly string[] = [
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  "'",
  '"',
  '‘',
  '’',
  '“',
  '”',
  '-',
  '–',
  '—',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '/',
  '\\',
  '|',
  '@',
  '#',
  '$',
  '%',
  '^',
  '&',
  '*',
  '_',
  '+',
  '=',
  '<',
  '>',
  '~',
  '`',
  '€',
  '£',
  '°',
  '•',
  '…',
];

/** The calibration page's groups of characters, one step each. */
export const CHAR_GROUPS = [
  { id: 'lower', chars: LOWERCASE },
  { id: 'upper', chars: UPPERCASE },
  { id: 'digits', chars: DIGITS },
  { id: 'punctuation', chars: PUNCTUATION },
] as const;

export type CharGroupId = (typeof CHAR_GROUPS)[number]['id'];

/**
 * The sentences: pangrams for every letter in both cases, then lines heavy with digits and punctuation. Together they
 * use every character the boxes ask for, so the spacing around each one is measured in running writing too.
 */
export const SENTENCES: readonly string[] = [
  'The quick brown fox jumps over the lazy dog.',
  'Pack my box with five dozen liquor jugs!',
  'Sphinx of black quartz, judge my vow; how vexingly quick daft zebras jump?',
  'JACKDAWS LOVE MY BIG SPHINX OF QUARTZ: WALTZ, NYMPH, FOR QUICK JIGS VEX BUD.',
  "Call 0123-456-789 at 10:45 – it's “urgent” (really) & costs £6, $8 or €7… ok?",
  'Email ann@site.org #42 [x+y=z] {a/b} ~5° • 90% *done*; ‘yes’ — “no” \\ |a| ^2 _1 `tick` <a> "c"!',
];

/** The characters written in the boxes. */
export const CALIBRATION_CHARS: readonly string[] = CHAR_GROUPS.flatMap((group) => group.chars);

/** The math and science symbols: the optional pen section and the uploads add them. */
export const MATH_SYMBOLS: readonly string[] = [
  ...'αβγδεζηθικλμνξπρστυφχψω',
  ...'ΓΔΘΛΞΠΣΦΨΩ',
  '∫',
  '∑',
  '∏',
  '√',
  '∞',
  '≤',
  '≥',
  '≠',
  '≈',
  '±',
  '×',
  '÷',
  '·',
  '→',
  '←',
  '↔',
  '⇒',
  '⇔',
  '∂',
  '∇',
  '′',
  '∈',
  // The vector arrow, the hat, and the dot written over a letter.
  '⃗',
  'ˆ',
  '˙',
];

/** The characters a style can hold: the calibration characters, the math symbols, and a few extra letters. */
export function isStyleChar(char: string): boolean {
  return (
    CALIBRATION_CHARS.includes(char) || MATH_SYMBOLS.includes(char) || /^\p{L}$|^\p{N}$|^\p{S}$|^\p{P}$/u.test(char)
  );
}

/** The ID of one sample: `char:<code point>:<n>`, `math:<code point>:<n>`, or `sentence:<n>`. */
export type SampleId = `char:${number}:${number}` | `math:${number}:${number}` | `sentence:${number}`;

export const charSampleId = (char: string, n: number): SampleId => `char:${char.codePointAt(0) ?? 0}:${n}`;
export const mathSampleId = (char: string, n: number): SampleId => `math:${char.codePointAt(0) ?? 0}:${n}`;
export const sentenceSampleId = (n: number): SampleId => `sentence:${n}`;

/** What a sample ID names: the character (or sentence) and which time it is. */
export function parseSampleId(id: string): { kind: 'char' | 'math' | 'sentence'; char: string; n: number } | null {
  const match = /^(char|math):(\d{1,7}):(\d{1,2})$/.exec(id);
  if (match) {
    const code = Number(match[2]);
    if (code > 0x10ffff) return null;
    return { kind: match[1] as 'char' | 'math', char: String.fromCodePoint(code), n: Number(match[3]) };
  }
  const sentence = /^sentence:(\d{1,2})$/.exec(id);
  return sentence ? { kind: 'sentence', char: '', n: Number(sentence[1]) } : null;
}

/** Every sample the calibration page needs before a style can be made, in the order it asks for them. */
export function requiredSamples(): SampleId[] {
  const ids: SampleId[] = [];
  for (const char of CALIBRATION_CHARS) for (let n = 0; n < SAMPLES_PER_CHAR; n++) ids.push(charSampleId(char, n));
  SENTENCES.forEach((_, n) => ids.push(sentenceSampleId(n)));
  return ids;
}

/** Letters by where they reach: these sit between the baseline and the x-height line. */
export const X_HEIGHT_LETTERS: readonly string[] = [...'acemnorsuvwxz'];
export const ASCENDER_LETTERS: readonly string[] = [...'bdfhklt'];
export const DESCENDER_LETTERS: readonly string[] = [...'gjpqy'];
export const CAP_LETTERS: readonly string[] = [...'ABCDEFGHIKLMNOPRSTUVWXYZ'];

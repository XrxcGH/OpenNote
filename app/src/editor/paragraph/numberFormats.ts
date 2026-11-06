// List number formats (spec 6.9, R-LIST-1; text DESIGN.md 7.1): the OOXML ST_NumberFormat names, so DOCX maps one to
// one. Each format follows its documented counting rule. The known answers in the tests are worked by hand.
export const NUMBER_FORMATS = [
  'decimal',
  'decimalZero',
  'lowerLetter',
  'upperLetter',
  'lowerRoman',
  'upperRoman',
  'ordinal',
  'cardinalText',
  'ordinalText',
  'bullet',
  'none',
  'hebrew1',
  'hebrew2',
  'arabicAlpha',
  'arabicAbjad',
  'hindiNumbers',
  'thaiNumbers',
  'chineseCounting',
  'japaneseCounting',
  'koreanCounting',
] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/** Letters that count like Word's lowerLetter: a to z, then aa, bb, ... zz, then aaa (the letter repeats). */
function repeating(n: number, alphabet: readonly string[]): string {
  const size = alphabet.length;
  return alphabet[(n - 1) % size].repeat(Math.floor((n - 1) / size) + 1);
}

const LATIN = [...'abcdefghijklmnopqrstuvwxyz'];
const ROMAN: readonly [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/** Standard Roman numerals from 1 to 3999. Other numbers have none, so they show in decimal. */
function roman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  let rest = n;
  let out = '';
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out;
}

/** English ordinal suffixes: 1st, 2nd, 3rd, 4th, and 11th, 12th, 13th. */
function ordinal(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** A number in American English words, without "and": 121 is "one hundred twenty-one". */
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  for (const [size, name] of [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1000, 'thousand'],
    [100, 'hundred'],
  ] as const) {
    if (n >= size) {
      const rest = n % size;
      return `${words(Math.floor(n / size))} ${name}${rest ? ` ${words(rest)}` : ''}`;
    }
  }
  return String(n);
}

const ORDINAL_WORDS: Readonly<Record<string, string>> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

/** The ordinal of a number in words: the last word changes, as in "twenty-first" and "one hundredth". */
function ordinalWords(n: number): string {
  const text = words(n);
  const match = /[a-z]+$/.exec(text);
  if (!match) return text;
  const last = match[0];
  const turned = ORDINAL_WORDS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return text.slice(0, match.index) + turned;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Native digits that replace 0 to 9 one for one, from the code point of zero. */
const digitsFrom = (zero: number) => (n: number) =>
  [...String(n)].map((d) => String.fromCodePoint(zero + Number(d))).join('');

const HEBREW_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];
const HEBREW_ALPHABET = [...'אבגדהוזחטיכלמנסעפצקרשת'];

/**
 * Hebrew numerals (hebrew1): letters whose values add up, hundreds first. 15 and 16 are written 9 + 6 and 9 + 7, so
 * they never spell a divine name. Above 400 the hundreds repeat tav (400). Thousands come first, by the same rule.
 */
function hebrew(n: number): string {
  if (n < 1) return String(n);
  const thousands = Math.floor(n / 1000);
  let rest = n % 1000;
  let out = thousands > 0 ? hebrew(thousands) : '';
  let hundreds = Math.floor(rest / 100);
  while (hundreds >= 4) {
    out += HEBREW_HUNDREDS[4];
    hundreds -= 4;
  }
  out += HEBREW_HUNDREDS[hundreds];
  rest %= 100;
  if (rest === 15) return `${out}טו`;
  if (rest === 16) return `${out}טז`;
  return out + HEBREW_TENS[Math.floor(rest / 10)] + HEBREW_ONES[rest % 10];
}

/** The Arabic alphabet in its dictionary (hija'i) order, for arabicAlpha. */
const ARABIC_ALPHA = [...'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'];
/** The Arabic alphabet in its abjad order, for arabicAbjad. */
const ARABIC_ABJAD = [...'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ'];

interface Counting {
  /** The digits 0 to 9; the zero is written between nonzero digits only when `zero` is set. */
  digits: readonly string[];
  /** The units for ten, hundred, thousand, and ten thousand. */
  units: readonly [string, string, string, string];
  zero: boolean;
  /** Whether a 1 before the unit of `place` (1 ten, 2 hundred, 3 thousand) is left out. */
  dropOne(place: number, leading: boolean): boolean;
}

/** A number below 10,000 in a counting system: digit and unit for each place, zeros as the system writes them. */
function countSmall(n: number, system: Counting, top: boolean): string {
  const places = [Math.floor(n / 1000) % 10, Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
  let out = '';
  let gap = false;
  let started = false;
  places.forEach((digit, index) => {
    const place = 3 - index;
    if (digit === 0) {
      gap = started;
      return;
    }
    if (gap && system.zero) out += system.digits[0];
    gap = false;
    const dropped = digit === 1 && place > 0 && system.dropOne(place, top && !started);
    out += (dropped ? '' : system.digits[digit]) + (place > 0 ? system.units[place - 1] : '');
    started = true;
  });
  return out;
}

/** A number in a counting system, by groups of ten thousand. */
function counting(n: number, system: Counting): string {
  if (n === 0) return system.digits[0];
  if (n < 10_000) return countSmall(n, system, true);
  const high = Math.floor(n / 10_000);
  const low = n % 10_000;
  const head = counting(high, system) + system.units[3];
  if (low === 0) return head;
  return head + (system.zero && low < 1000 ? system.digits[0] : '') + countSmall(low, system, false);
}

/** Chinese: 十一 for 11 but 一百一十 for 110, and 〇 for a run of zeros, as in 一百〇五. */
const CHINESE: Counting = {
  digits: [...'〇一二三四五六七八九'],
  units: ['十', '百', '千', '万'],
  zero: true,
  dropOne: (place, leading) => place === 1 && leading,
};

/** Japanese: no 1 before ten, hundred, or thousand (百 is 100), and no zeros. */
const JAPANESE: Counting = {
  digits: [...'〇一二三四五六七八九'],
  units: ['十', '百', '千', '万'],
  zero: false,
  dropOne: () => true,
};

/** Sino-Korean numerals in Hangul: 십일 for 11, 백 for 100, no zeros. */
const KOREAN: Counting = {
  digits: ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'],
  units: ['십', '백', '천', '만'],
  zero: false,
  dropOne: () => true,
};

/** A list number in a format. Letter and Roman formats have nothing for 0, so it shows in decimal. */
export function formatNumber(n: number, format: NumberFormat): string {
  const value = Math.max(0, Math.trunc(n));
  const counted = value >= 1;
  switch (format) {
    case 'decimal':
      return String(value);
    case 'decimalZero':
      return value < 10 ? `0${value}` : String(value);
    case 'lowerLetter':
      return counted ? repeating(value, LATIN) : String(value);
    case 'upperLetter':
      return counted ? repeating(value, LATIN).toUpperCase() : String(value);
    case 'lowerRoman':
      return roman(value);
    case 'upperRoman':
      return roman(value).toUpperCase();
    case 'ordinal':
      return ordinal(value);
    case 'cardinalText':
      return capital(words(value));
    case 'ordinalText':
      return capital(ordinalWords(value));
    case 'bullet':
    case 'none':
      return '';
    case 'hebrew1':
      return hebrew(value);
    case 'hebrew2':
      return counted ? repeating(value, HEBREW_ALPHABET) : String(value);
    case 'arabicAlpha':
      return counted ? repeating(value, ARABIC_ALPHA) : String(value);
    case 'arabicAbjad':
      return counted ? repeating(value, ARABIC_ABJAD) : String(value);
    case 'hindiNumbers':
      return digitsFrom(0x0660)(value);
    case 'thaiNumbers':
      return digitsFrom(0x0e50)(value);
    case 'chineseCounting':
      return counting(value, CHINESE);
    case 'japaneseCounting':
      return counting(value, JAPANESE);
    case 'koreanCounting':
      return counting(value, KOREAN);
  }
}

/**
 * A level's label from its pattern (Word's lvlText): `%k` stands for the number of level k, formatted by that
 * level's format. A `%k` deeper than the item, or a `%` not followed by 1 to 9, is written as it is (R-LIST-1).
 */
export function levelText(pattern: string, values: readonly number[], formats: readonly NumberFormat[]): string {
  return pattern.replace(/%([1-9])/g, (whole, digit: string) => {
    const k = Number(digit) - 1;
    return k < values.length ? formatNumber(values[k], formats[k] ?? 'decimal') : whole;
  });
}

// The answer-leak guard (ADR 0050). A hint before the full solution must not hand over what the student is working
// toward: the final answer, or the very line a later rung would show. The guard compares a hint with those
// "secrets" after both are written the same way (spacing, one kind of minus, superscripts as ^n, LaTeX wrapping
// dropped), with the terms of a sum in any order and the sides of an equation either way round. It also catches a
// value said in words or as another number, such as "x is 2", "x = 4/2" or "y = 3.5" for y = 7/2. A secret the
// student already wrote is not a secret, so it never trips the guard. For subjects whose answer the rules cannot
// work out, `claimsAnswer` is a heuristic: a sentence that states a result the student's text does not hold.

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
};

const superscripts = (text: string) =>
  text.replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => `^${[...run].map((one) => SUPERSCRIPT[one] ?? '').join('')}`);

/**
 * Text in one comparable form. It is lower case with plain signs, superscripts as ^n, and LaTeX wrapping removed.
 * Signs lose their spaces, a number joins its letter, x^(2) becomes x^2, and 2·x becomes 2x. Spaces between words
 * stay, so "get 2x = 4" still shows where "2x = 4" starts.
 */
export function normalizeMath(text: string): string {
  return superscripts(
    text
      .toLowerCase()
      .replace(/\\left|\\right|\\,|\\;|\\!|\\quad/g, ' ')
      .replace(/\\cdot|\\times|×|·|⋅/g, '*')
      .replace(/\\div|÷/g, '/')
      .replace(/[−–—]/g, '-')
      .replace(/\*\*/g, '^'),
  )
    .replace(/[{}$]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ?([^\w\s\\]) ?/g, '$1')
    .replace(/(\d) (?=[a-z])/g, '$1')
    .replace(/\^\((-?[\w.]+)\)/g, '^$1')
    .replace(/(?<![\w.\\])(\d+(?:\.\d+)?)\*(?=[a-z(])/g, '$1')
    .trim()
    .replace(/[.。]+$/, '');
}

const EDGE = /[a-z0-9.^_]/;

/**
 * Whether `part` stands on its own in `text`: not the tail of a longer term, nor the start of a longer number. A part
 * that starts (or ends) with a sign or a bracket carries its own edge there, so "is-sin(x)" holds "-sin(x)".
 */
function standsAlone(text: string, part: string): boolean {
  const edgeBefore = EDGE.test(part[0] ?? '');
  const edgeAfter = EDGE.test(part[part.length - 1] ?? '');
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
    const before = text[at - 1] ?? '';
    const after = text[at + part.length] ?? '';
    if ((!edgeBefore || !EDGE.test(before)) && (!edgeAfter || !/[0-9.^_]/.test(after))) return true;
  }
  return false;
}

/** The terms of each side, sorted, so "5+3x^2" reads as "3x^2+5" and "4=2x" as "2x=4". */
function termKey(expression: string): string {
  const sides = expression.split('=').map((side) => {
    const terms: string[] = [];
    let depth = 0;
    let term = '';
    for (let i = 0; i < side.length; i += 1) {
      const char = side[i] ?? '';
      if (char === '(' || char === '[') depth += 1;
      if (char === ')' || char === ']') depth -= 1;
      const previous = side[i - 1] ?? '';
      if (depth === 0 && (char === '+' || char === '-') && term !== '' && !/[\^*/(]/.test(previous)) {
        terms.push(term);
        term = char === '-' ? '-' : '';
      } else term += char;
    }
    terms.push(term);
    return terms
      .map((one) => (one.startsWith('-') || one.startsWith('+') ? one : `+${one}`))
      .sort()
      .join('');
  });
  return sides.sort().join('=');
}

/** The ways a secret could be written: as it is, without "+ C", or with its sides swapped. */
function variants(plain: string): string[] {
  const found = [plain];
  const noConstant = plain.replace(/\+c$/, '');
  if (noConstant !== plain && noConstant !== '') found.push(noConstant);
  const sides = plain.split('=');
  if (sides.length === 2) found.push(`${sides[1]}=${sides[0]}`);
  return found;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?`;
const NOT_LONGER = String.raw`(?!\d|[./]\d)`;
const LINK = [
  '=',
  ':',
  'is',
  'equals?',
  'must be',
  'should be',
  'should equal',
  'has to be',
  'would be',
  'will be',
  'becomes',
  'gives',
  'turns out(?: to be)?',
  'comes out(?: to| as| at)?',
  'works out(?: to| as)?',
].join('|');
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const NUMBER_WORD = new RegExp(String.raw`\b(${NUMBER_WORDS.join('|')})\b`, 'g');

/** The value of a number such as "2", "-3.5" or "7/2", or NaN. */
function numberOf(text: string): number {
  const [top, bottom] = text.replace(/\s/g, '').split('/');
  const value = Number(top) / (bottom === undefined ? 1 : Number(bottom));
  return Number.isFinite(value) ? value : NaN;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Text as words: lower case, one kind of minus, superscripts as ^n, and small number words as digits. */
function wordsOf(text: string): string {
  return superscripts(text.toLowerCase().replace(/[−–—]/g, '-'))
    .replace(NUMBER_WORD, (word) => String(NUMBER_WORDS.indexOf(word)))
    .replace(/\s+/g, ' ');
}

/** The value side of a secret such as "x = 2", or null when the secret is not that shape. */
function valueOf(secret: string): { letter: string; value: number } | null {
  const found = new RegExp(String.raw`^\s*([a-z]{1,2})\s*=\s*(${NUMBER})\s*$`, 'i').exec(secret);
  if (!found) return null;
  const value = numberOf(found[2] ?? '');
  return Number.isNaN(value) ? null : { letter: (found[1] ?? '').toLowerCase(), value };
}

/** The numbers `pattern` captures in `words`. */
function captured(words: string, pattern: RegExp): number[] {
  return [...words.matchAll(pattern)].map((match) => numberOf(match[1] ?? '')).filter((one) => !Number.isNaN(one));
}

/** Whether `words` says the letter's value in any way: "x = 2.0", "x should equal 2", "the answer: 4/2". */
function saysValue(words: string, shape: { letter: string; value: number }): boolean {
  const told = [
    new RegExp(String.raw`\b${shape.letter}\s*(?:${LINK})\s*(${NUMBER})${NOT_LONGER}`, 'g'),
    new RegExp(String.raw`\b(?:answer|solution|result)\s*(?:is|=|:)?\s*(${NUMBER})${NOT_LONGER}`, 'g'),
  ];
  return told.some((pattern) => captured(words, pattern).some((one) => same(one, shape.value)));
}

/** Long enough to look for: three characters, or two with a sign such as "√2" or "-5". */
const long = (form: string) => form.length >= 3 || (form.length === 2 && /[^a-z0-9]/.test(form));

/** Whether `hint` gives away any of `secrets`. `given` is what the student wrote: what is in it is not secret. */
export function leaks(hint: string, secrets: readonly (string | null | undefined)[], given = ''): boolean {
  const said = normalizeMath(hint);
  const wrote = normalizeMath(given);
  const tokens = said.split(/[\s,;:!?]+/).map((one) => one.replace(/\.+$/, ''));
  const words = wordsOf(hint);
  for (const secret of secrets) {
    if (!secret) continue;
    const plain = normalizeMath(secret);
    if (plain.length === 0 || standsAlone(wrote, plain)) continue;
    for (const form of variants(plain))
      if (long(form) && !standsAlone(wrote, form) && standsAlone(said, form)) return true;
    if (plain.length >= 3) {
      const key = termKey(plain);
      if (tokens.some((token) => token.length >= 3 && termKey(token) === key)) return true;
    }
    const shape = valueOf(secret);
    if (shape && saysValue(words, shape)) return true;
  }
  return false;
}

const UNIT = String.raw`[a-zµμω°%][a-z0-9µμω°%/^*-]{0,7}\b`;
const CLAIMS = [
  new RegExp(String.raw`\b(?:answer|result|solution)\b[^.?!\n]{0,40}?(?:=|:|\bis\b|\bequals\b)\s*(${NUMBER})`, 'g'),
  new RegExp(String.raw`\b(?:so|therefore|thus|hence)\b[^.?!\n]{0,40}?=\s*(${NUMBER})`, 'g'),
  new RegExp(String.raw`=\s*(${NUMBER})\s*${UNIT}`, 'g'),
];

/**
 * Whether `reply` states a result that the student's text (`given`) does not already hold: "the answer is 36 g",
 * "so F = 6 N", or any "= number unit". A heuristic, for problems whose answer the rules cannot work out.
 */
export function claimsAnswer(reply: string, given = ''): boolean {
  const words = wordsOf(reply);
  const known = captured(wordsOf(given), new RegExp(`(${NUMBER})`, 'g'));
  return CLAIMS.some((pattern) => captured(words, pattern).some((one) => !known.some((two) => same(one, two))));
}

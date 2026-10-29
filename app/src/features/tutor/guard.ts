// The answer-leak guard (ADR 0050). A hint before the full solution must not hand over what the student is working
// toward: the final answer, or the very line a later rung would show.
//
// The guard compares a hint with those "secrets" after both are written the same way. Spacing, minus signs,
// full-width signs, superscripts and LaTeX wrapping are evened out, and redundant brackets dropped. The terms of a sum
// may come in any order, and the sides of an equation either way round.
//
// With the math kit loaded, a formula in the hint with the secret's values counts too: "(1/3)x^3" for "x^3/3 + C".
// A value said in words or as another number counts as well, such as "x is 2", "x = 4/2", "Two." or "the limit is 1".
// LaTeX, which most models write by default, is read as plain math first: \frac{x^3}{3} is x^3/3.
//
// A secret the student already wrote is not a secret, so it never trips the guard. For subjects whose answer the
// rules cannot work out, `claimsAnswer` is a heuristic: a sentence that states a result the student's text lacks.
import { mathKit } from './kit';

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

/** Lower case, superscripts as ^n, then full-width and other compatibility forms as plain ones ("ｘ＝２" is "x=2"). */
const plainForms = (text: string) =>
  superscripts(text.toLowerCase()).normalize('NFKC').replace(/[−–—]/g, '-').replace(/⁄/g, '/');

/** The group in braces that starts at `open` (a "{"), and the index after it, or null when it does not close. */
function braced(text: string, open: number): { body: string; end: number } | null {
  if (text[open] !== '{') return null;
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1;
    if (text[at] === '}') depth -= 1;
    if (depth === 0) return { body: text.slice(open + 1, at), end: at + 1 };
  }
  return null;
}

/**
 * LaTeX as plain math, which is how most models write it: \frac{a}{b} is ((a)/(b)), \sqrt{a} is sqrt(a), \sqrt[n]{a}
 * is (a)^(1/(n)), x^{3} is x^(3), and \( \) \[ \] $ wrapping and other commands' backslashes go. Text without a
 * backslash is returned as it is.
 */
export function plainLatex(text: string): string {
  if (!text.includes('\\')) return text;
  let out = text
    .replace(/\\[()[\]]/g, ' ')
    .replace(/\$+/g, ' ')
    .replace(/\\(?:text|mathrm|operatorname|mathit|mathbf|mbox)\s*\{([^{}]*)\}/g, ' $1 ');
  for (let round = 0; round < 20; round += 1) {
    const found = /\\(?:[dt]?frac|sqrt)/.exec(out);
    if (!found) break;
    const command = found[0];
    let at = found.index + command.length;
    while (out[at] === ' ') at += 1;
    let replaced: string | null = null;
    let end = at;
    if (command.endsWith('frac')) {
      const top = braced(out, at);
      let next = top ? top.end : at;
      while (out[next] === ' ') next += 1;
      const bottom = top ? braced(out, next) : null;
      if (top && bottom) {
        replaced = `((${top.body})/(${bottom.body}))`;
        end = bottom.end;
      }
    } else {
      let root: string | null = null;
      if (out[at] === '[') {
        const close = out.indexOf(']', at);
        if (close > at) {
          root = out.slice(at + 1, close);
          at = close + 1;
        }
      }
      const body = braced(out, at);
      if (body) {
        replaced = root === null ? `sqrt(${body.body})` : `(${body.body})^(1/(${root}))`;
        end = body.end;
      }
    }
    // An unclosed command loses its backslash, so the loop moves on.
    out =
      replaced === null
        ? out.replace(command, command.slice(1))
        : out.slice(0, found.index) + replaced + out.slice(end);
  }
  // Powers and subscripts in braces keep their grouping: x^{3} is x^(3), e^{2x} is e^(2x).
  for (let round = 0; round < 8; round += 1) {
    const before = out;
    out = out.replace(/([\^_])\{([^{}]*)\}/g, '$1($2)');
    if (out === before) break;
  }
  return out
    .replace(/\\left|\\right|\\,|\\;|\\!|\\quad|\\displaystyle/g, ' ')
    .replace(/\\(?:cdot|times)/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\(?:pm)/g, '±')
    .replace(/\\(?:approx)/g, '≈')
    .replace(/\\(?:to|rightarrow)/g, '→')
    .replace(/\\(?:infty)/g, '∞')
    .replace(/\\([a-z]+)/gi, '$1');
}

/** Drops brackets around one number, letter or power, and doubled or whole-side brackets: ((x^3)/(3)) is x^3/3. */
function unbracket(text: string): string {
  let out = text;
  for (let round = 0; round < 8; round += 1) {
    const before = out;
    out = out
      .replace(/(?<![a-z0-9\\^_])\((-?[a-z0-9.]+(?:\^-?[a-z0-9.]+)?)\)(?!\^)/g, '$1')
      .replace(/\(\(([^()]*)\)\)/g, '($1)')
      .replace(/(^|=)\(([^()]*)\)(?=$|=|≈)/g, '$1$2')
      // One term in brackets among others, as LaTeX fractions come out: (x^3/3)+c is x^3/3+c.
      .replace(/(^|[=+-])\(([^()+=-]*)\)(?=$|[=+≈-])/g, '$1$2');
    if (out === before) break;
  }
  return out;
}

/**
 * Text in one comparable form. It is lower case with plain signs, superscripts as ^n, and LaTeX wrapping removed.
 * Signs lose their spaces, a number joins its letter, x^(2) becomes x^2, 2·x becomes 2x, and brackets around a single
 * term go. Spaces between words stay, so "get 2x = 4" still shows where "2x = 4" starts.
 */
export function normalizeMath(text: string): string {
  return unbracket(
    plainForms(
      plainLatex(text)
        .replace(/\\left|\\right|\\,|\\;|\\!|\\quad/g, ' ')
        .replace(/\\cdot|\\times|×|·|⋅/g, '*')
        .replace(/\\div|÷/g, '/')
        .replace(/\*\*/g, '^'),
    )
      .replace(/[{}$]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/ ?([^\w\s\\]) ?/g, '$1')
      .replace(/(\d) (?=[a-z])/g, '$1')
      .replace(/\^\((-?[\w.]+)\)/g, '^$1')
      .replace(/(?<![\w.\\])(\d+(?:\.\d+)?)\*(?=[a-z(])/g, '$1')
      .replace(/\b(sin|cos|tan|sec|csc|cot|ln|log|exp|sqrt) (-?[a-z0-9.]+)\b(?![\^(])/g, '$1($2)')
      .trim()
      .replace(/[.。]+$/, ''),
  );
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

/** The ways a secret could be written: as it is, without "+ C", with its sides swapped, or its exact part alone. */
function variants(plain: string): string[] {
  const found = [plain];
  const noConstant = plain.replace(/\+c$/, '');
  if (noConstant !== plain && noConstant !== '') found.push(noConstant);
  const sides = plain.split('=');
  if (sides.length === 2) found.push(`${sides[1]}=${sides[0]}`);
  const exact = plain.split('≈')[0] ?? '';
  if (exact !== plain && exact !== '') found.push(exact);
  return found;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?`;
const NUMBER_ONLY = new RegExp(String.raw`^\s*(${NUMBER})\s*$`);
const NOT_LONGER = String.raw`(?!\d|[./]\d)`;
const MODAL = String.raw`(?:must|should|will|would|could|can|might|has to|have to)\s+`;
const VERB = String.raw`(?:be|equal(?: to)?|come (?:out )?(?:to|as|at)|end up(?: as| at| being)?|work out (?:to|as))`;
/** Words that link a name to its value: "is", "should come to", "ends up as". */
const LINK_WORDS = [
  `${MODAL}${VERB}`,
  String.raw`is(?:\s+(?:equal to|exactly|about|approximately|roughly|just))?`,
  'equals?(?: to)?',
  'becomes',
  'gives',
  'turns out(?: to be)?',
  'comes? (?:out )?(?:to|as|at)',
  'works out(?: to| as)?',
  'ends? up(?: as| at| being| with)?',
  '(?:tends|goes|converges|adds up|sums|amounts) to',
  'approaches',
  'approximately',
  'about',
  'roughly',
].join('|');
/** Signs that link a name to its value. */
const LINK_SIGNS = String.raw`=>|⇒|=|:|→|->|⟶|≈|≃|≡|~|∈\s*\{?`;
const LINK = `${LINK_SIGNS}|${LINK_WORDS}`;

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
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const PARTS: Readonly<Record<string, number>> = { half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4 };
const TENS_WORD = new RegExp(String.raw`\b(${TENS.join('|')})(?:[- ](${ONES.slice(1, 10).join('|')}))?\b`, 'g');
const ONES_WORD = new RegExp(String.raw`\b(${ONES.join('|')})\b`, 'g');

/** Number words as digits: "thirty-six" is 36, "three and a half" 3.5, "seven halves" 7/2, "3 1/2" 3.5, "3,5" 3.5. */
function numberWords(text: string): string {
  return text
    .replace(TENS_WORD, (_, tens: string, one?: string) =>
      String(20 + 10 * TENS.indexOf(tens) + (one ? ONES.indexOf(one) : 0)),
    )
    .replace(ONES_WORD, (word) => String(ONES.indexOf(word)))
    .replace(/\b(\d+|a) hundred(?:(?: and)? (\d+)(?![\d./]))?/g, (_, n: string, rest?: string) =>
      String((n === 'a' ? 1 : Number(n)) * 100 + (rest ? Number(rest) : 0)),
    )
    .replace(/\b(\d+) and a (half|quarter)\b/g, (_, n: string, part: string) =>
      String(Number(n) + 1 / (PARTS[part] ?? 1)),
    )
    .replace(
      /\b(\d+|a) (halves|half|thirds?|quarters?)\b/g,
      (_, n: string, part: string) => `${n === 'a' ? 1 : n}/${PARTS[part] ?? 1}`,
    )
    .replace(/\b(\d+) (\d+)\/(\d+)\b/g, (_, whole: string, top: string, bottom: string) =>
      String(Number(whole) + Number(top) / Number(bottom)),
    )
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
}

/** The value of a number such as "2", "-3.5" or "7/2", or NaN. */
function numberOf(text: string): number {
  const [top, bottom] = text.replace(/\s/g, '').split('/');
  const value = Number(top) / (bottom === undefined ? 1 : Number(bottom));
  return Number.isFinite(value) ? value : NaN;
}

/** The same number, allowing for rounding: 2.000000001 is 2. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

/** Text as words: lower case, plain signs, superscripts as ^n, and number words as digits. */
function wordsOf(text: string): string {
  return numberWords(plainForms(plainLatex(text)).replace(/\s+/g, ' '));
}

/** The value side of a secret such as "x = 2", or null when the secret is not that shape. */
function valueOf(secret: string): { letter: string; value: number } | null {
  const found = new RegExp(String.raw`^\s*([a-z]{1,2})\s*=\s*(${NUMBER})\s*$`).exec(plainForms(secret));
  if (!found) return null;
  const value = numberOf(found[2] ?? '');
  return Number.isNaN(value) ? null : { letter: found[1] ?? '', value };
}

/**
 * The number a secret comes to, when it is one: a bare number ("1", "1/3 ≈ 0.333333") or a line such as "2x = 4"
 * whose right side is a number (then `side` is its left side). Null for a letter's value, which `valueOf` reads.
 */
function numberSecret(secret: string): { values: number[]; side: string | null } | null {
  const plain = normalizeMath(secret);
  const parts = plain.split('≈');
  const values = parts.map((part) => (NUMBER_ONLY.test(part) ? numberOf(part) : NaN)).filter((n) => !Number.isNaN(n));
  if (values.length > 0 && values.length === parts.length) return { values, side: null };
  const sides = plain.split('=');
  if (sides.length !== 2 || valueOf(secret)) return null;
  const right = sides[1] ?? '';
  const left = sides[0] ?? '';
  if (!NUMBER_ONLY.test(right) || left === '' || NUMBER_ONLY.test(left)) return null;
  return { values: [numberOf(right)], side: left };
}

/** The numbers `pattern` captures in `words`. */
function captured(words: string, pattern: RegExp): number[] {
  return [...words.matchAll(pattern)].map((match) => numberOf(match[1] ?? '')).filter((one) => !Number.isNaN(one));
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sentences that are a number and nothing else: "1." or "Thirty-six!". */
function loneNumbers(words: string): number[] {
  return words
    .split(/\n|[!?]|\.(?!\d)/)
    .map((one) => one.trim().replace(/^["'“‘(]+|["'”’):]+$/g, ''))
    .filter((one) => NUMBER_ONLY.test(one))
    .map(numberOf);
}

/** Whether `words` says the letter's value in any way: "x = 2.0", "x should equal 2", "the answer: 4/2". */
function saysValue(words: string, shape: { letter: string; value: number }): boolean {
  const told = [
    new RegExp(String.raw`\b${shape.letter}\s*(?:${LINK})\s*(${NUMBER})${NOT_LONGER}`, 'g'),
    new RegExp(
      String.raw`\b(?:answer|solution|result|root)s?(?:\s+set)?\s*(?:is|are|=|:)?\s*\{?\s*(${NUMBER})${NOT_LONGER}`,
      'g',
    ),
  ];
  // "2" or "Two." alone, the reply to "What is x?", says the value too.
  const found = [...told.flatMap((pattern) => captured(words, pattern)), ...loneNumbers(words)];
  return found.some((one) => same(one, shape.value));
}

const SUBJECT = String.raw`answer|result|solution|limit|sum|total|value|series|derivative|slope|integral|area|it|this|that|which|side`;

/**
 * Whether `words` states a number secret: "= 1", "the limit is 1", "it comes to 1", "1." alone, or for "2x = 4",
 * "2x is 4" (`said` is the hint in math form, where "2 x" reads as "2x"; `wrote` is the student's text in that form).
 */
function saysNumber(
  words: string,
  said: string,
  wrote: string,
  shape: { values: number[]; side: string | null },
): boolean {
  const told = [
    new RegExp(String.raw`\b(?:${LINK_WORDS})\s*(${NUMBER})${NOT_LONGER}(?!\s*[a-z(])`, 'g'),
    new RegExp(String.raw`\b(?:${SUBJECT})\b[^.?!\n]{0,30}?(?:${LINK_WORDS}|:)\s*(${NUMBER})${NOT_LONGER}`, 'g'),
  ];
  const found = [...told.flatMap((pattern) => captured(words, pattern)), ...loneNumbers(words)];
  // "= 1" counts, but not when it is a piece of the question the student wrote, such as the n = 1 of a sum.
  const signed = new RegExp(String.raw`([a-z][\w^]*)?\s*(?:=|≈|≃|~)\s*(${NUMBER})${NOT_LONGER}`, 'g');
  for (const match of words.matchAll(signed)) {
    const before = match[1];
    const piece = normalizeMath(`${before ?? ''}=${match[2] ?? ''}`);
    if (!before || !standsAlone(wrote, piece)) found.push(numberOf(match[2] ?? ''));
  }
  if (shape.side) {
    const side = escaped(shape.side);
    const keyed = new RegExp(String.raw`(?<![\w.^])${side}\s*(?:${LINK})\s*(${NUMBER})${NOT_LONGER}`, 'g');
    found.push(...captured(numberWords(said), keyed));
  }
  return found.some((one) => shape.values.some((value) => same(one, value)));
}

/** Function names a formula may hold between its terms. */
const FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'ln', 'log', 'exp', 'sqrt', 'abs', 'pi']);
const MATH_WORDS: readonly [RegExp, string][] = [
  [/\bsquared\b/g, '^2'],
  [/\bcubed\b/g, '^3'],
  [/\bto the power of\b/g, '^'],
  [/\bdivided by\b/g, '/'],
  [/\btimes\b/g, '*'],
  [/\bover\b/g, '/'],
  [/\bplus\b/g, '+'],
  [/\bminus\b/g, '-'],
];

/** The runs of a hint that could be a formula: what is left between ordinary words, and each side of an "=". */
function formulas(hint: string): string[] {
  let text = wordsOf(hint);
  for (const [pattern, sign] of MATH_WORDS) text = text.replace(pattern, ` ${sign} `);
  const found: string[] = [];
  for (const clause of text.split(/[,;!?\n]|\.(?!\d)/)) {
    let run: string[] = [];
    const flush = () => {
      const joined = run.join(' ').trim();
      run = [];
      if (joined === '') return;
      for (const side of [joined, ...joined.split(/[=:]/)]) {
        const trimmed = side.trim().replace(/^[^\w(√-]+|[^\w)!]+$/g, '');
        if (/[a-z]/.test(trimmed) && trimmed.length <= 80) found.push(trimmed);
      }
    };
    for (const token of clause.split(/\s+/)) {
      const word = /^[a-z]+$/.test(token) && (token.length >= 2 || token === 'a' || token === 'i');
      if (word && !FUNCTION_NAMES.has(token)) flush();
      else run.push(token);
    }
    flush();
  }
  return found.slice(0, 40);
}

/** A value for every name at one trial point: spread out, irregular, and different for each name. */
function pointFor(trial: number): Record<string, number> {
  const valueFor = (name: string) =>
    0.37 + 0.61 * trial + 0.13 * ([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7);
  return new Proxy({}, { get: (_, name) => (typeof name === 'string' ? valueFor(name) : undefined) });
}

/**
 * Whether two formulas have the same values at a few points (or, with `upToConstant`, differ by one constant), read
 * with the math kit. False when the kit is not loaded or either does not read.
 */
export function sameValues(a: string, b: string, upToConstant = false): boolean {
  const kit = mathKit();
  if (!kit) return false;
  try {
    const [f, g] = [kit.evaluator(kit.expression(a, 'text')), kit.evaluator(kit.expression(b, 'text'))];
    const gaps: number[] = [];
    for (let trial = 0; trial < 6; trial += 1) {
      const point = pointFor(trial);
      const [u, v] = [f(point), g(point)];
      if (Number.isFinite(u) && Number.isFinite(v)) gaps.push(u - v);
    }
    const first = gaps[0] ?? 0;
    const scale = Math.max(1, Math.abs(first));
    return gaps.length >= 3 && gaps.every((gap) => Math.abs(gap - (upToConstant ? first : 0)) < 1e-7 * scale);
  } catch {
    return false;
  }
}

/** Whether a formula in `hint` has the values of `secret`, an expression in letters such as "x^3/3 + C". */
function saysFormula(hint: string, secret: string, wrote: string): boolean {
  const plain = normalizeMath(secret);
  if (plain.includes('=') || plain.includes('≈') || !/[a-z]/.test(plain) || plain.length < 3) return false;
  const constant = /\+c$/.test(plain);
  const body = secret.replace(/\+\s*C\s*$/, '');
  return formulas(hint).some((one) => {
    // A "+ C" of the hint's own is the constant, not a letter to try values for.
    const formula = constant ? one.replace(/\+\s*c\s*$/, '') : one;
    const form = normalizeMath(formula);
    if (form === '' || standsAlone(wrote, form)) return false;
    return sameValues(formula, body, constant);
  });
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
    const number = numberSecret(secret);
    if (number) {
      // The question holds numbers of its own; only a line of the student's that ends in the value holds the value.
      const wroteIt = given.split('\n').some((line) => {
        const form = numberWords(normalizeMath(line));
        const tail = form.slice(form.lastIndexOf('=') + 1);
        return form.includes('=') && NUMBER_ONLY.test(tail) && number.values.some((one) => same(numberOf(tail), one));
      });
      if (!wroteIt && saysNumber(words, said, wrote, number)) return true;
    }
    if (plain.length === 0 || standsAlone(wrote, plain)) continue;
    for (const form of variants(plain))
      if (long(form) && !standsAlone(wrote, form) && standsAlone(said, form)) return true;
    if (plain.length >= 3) {
      const key = termKey(plain);
      if (tokens.some((token) => token.length >= 3 && termKey(token) === key)) return true;
    }
    const shape = valueOf(secret);
    if (shape && saysValue(words, shape)) return true;
    if (saysFormula(hint, secret, wrote)) return true;
  }
  return false;
}

/** Units a stated result may carry, so "= 3 or" is not read as 3 of a unit called "or". */
const UNITS = [
  'm/s\\^?2',
  'm/s',
  'km/h',
  'mph',
  'kph',
  'kg',
  'mg',
  'µg',
  'μg',
  'g',
  'mmol',
  'mol',
  'ml',
  'l',
  'km',
  'cm',
  'mm',
  'm',
  'ms',
  'min',
  'hrs?',
  'h',
  's',
  'kn',
  'n',
  'kj',
  'j',
  'kw',
  'w',
  'kpa',
  'pa',
  'atm',
  '°c',
  '°f',
  '°',
  'k',
  'v',
  'ohms?',
  'ω',
  'hz',
  '%',
  'grams?',
  'kilograms?',
  'milligrams?',
  'moles?',
  'lit(?:re|er)s?',
  'millilit(?:re|er)s?',
  'met(?:re|er)s?',
  'centimet(?:re|er)s?',
  'kilomet(?:re|er)s?',
  'seconds?',
  'minutes?',
  'hours?',
  'newtons?',
  'joules?',
  'watts?',
  'pascals?',
  'volts?',
  'amps?',
  'degrees?',
  'kelvin',
  'miles?',
  'feet',
  'foot',
  'inch(?:es)?',
  'percent',
  'dollars?',
  'cents?',
  'calories?',
  'kcal',
];
const UNIT = String.raw`(?:${UNITS.join('|')})(?![a-z0-9/^])`;
const AMOUNT = String.raw`(${NUMBER})${NOT_LONGER}`;
const CLAUSE_END = String.raw`(?=\s*(?:[.,;:!?)]|$|(?:of|for|in|at|and|per|each|so|altogether|total)\b))`;
const STATES = String.raw`is|are|was|get|gets|got|gives?|yields?|produces?|makes?|forms?|equals?|totals?|comes? (?:out )?to|works? out to`;
const CLAIMS = [
  new RegExp(String.raw`\b(?:answer|result|solution)\b[^.?!\n]{0,40}?(?:=|:|\bis\b|\bequals\b)\s*(${NUMBER})`, 'g'),
  new RegExp(String.raw`\b(?:so|therefore|thus|hence)\b[^.?!\n]{0,40}?=\s*(${NUMBER})`, 'g'),
  new RegExp(String.raw`=\s*${AMOUNT}\s*${UNIT}`, 'g'),
  new RegExp(String.raw`=\s*${AMOUNT}\s*(?:[.!?]|$)`, 'g'),
  new RegExp(String.raw`\b(?:${STATES})\s+${AMOUNT}(?:\s*${UNIT})?${CLAUSE_END}`, 'g'),
  new RegExp(String.raw`\b(?:so|therefore|thus|hence)\s+${AMOUNT}\s*${UNIT}`, 'g'),
  new RegExp(String.raw`(?:^|[.!?]\s+)${AMOUNT}\s*${UNIT}\s*(?=[.!?]|$)`, 'g'),
  // "You need 36 g", "to reach 36 g", "That gives you 36 g".
  new RegExp(
    String.raw`\b(?:needs?|needed|reach(?:es|ed)?|gives? you|get|gets|got|leaves?|left with)\s+${AMOUNT}\s*${UNIT}`,
    'g',
  ),
];

/** Results stated outside a question: "What is the mass of 1 mol of water?" asks, it does not tell. */
const STATEMENTS = [
  // "F: 6 N", "Water produced: 36 g".
  new RegExp(String.raw`[a-z)]\s*:\s*${AMOUNT}\s*${UNIT}`, 'g'),
  // "6 N is the force", "36 g of H2O", "36 grams of water form".
  new RegExp(String.raw`(?<![\w.])${AMOUNT}\s*${UNIT}\s+(?:is|are|was|of)\b`, 'g'),
];

/** Words before a letter's value that offer it to try rather than state it: "Try n = 5", "put x = 3 in". */
const TRIES =
  /\b(?:try|trying|pick|choose|put|plug|substitute|test|testing|check|let|set|suppose|assume|if|when|say|guess|like)\b/;

/**
 * The values a reply states for a letter, "x = 3 is the other root", and every number in a list of solutions, "the
 * solutions are 2 and 3". A letter's value offered to try ("Try n = 5") is not stated.
 */
function statedValues(words: string): number[] {
  const found: number[] = [];
  for (const sentence of words.split(/\n|[!?;]|\.(?!\d)/)) {
    for (const match of sentence.matchAll(
      new RegExp(String.raw`(?<![\w^.'])[a-z]\s*(?:=|≡|=>|⇒)\s*${AMOUNT}(?![a-z(^*/]|\s*[(^*/+-]\s*[\w(])`, 'g'),
    )) {
      if (!TRIES.test(sentence.slice(0, match.index))) found.push(numberOf(match[1] ?? ''));
    }
    const listed =
      /\b(?:answers?|results?|solutions?|roots?|zeros?|zeroes)\b(?:\s+set)?[^\d]{0,20}?(?:=|:|\bis\b|\bare\b|\bequals?\b)(.{1,60})/.exec(
        sentence,
      );
    if (listed) found.push(...captured(listed[1] ?? '', new RegExp(`(${NUMBER})${NOT_LONGER}`, 'g')));
  }
  return found.filter((one) => !Number.isNaN(one));
}

/**
 * Whether `reply` states a result that the student's text (`given`) does not already hold. A heuristic, for problems
 * whose answer the rules cannot work out. It catches "the answer is 36 g", "so F = 6 N", "F is 6 N" and "you get 36
 * grams". It also catches "F: 6 N", "36 g of water", "you need 36 g" and a number with a unit on its own ("Forty
 * mph."). A letter's value ("x = 3 is the other root") counts, and so does a list of solutions. A lone number counts
 * when the student's text ends in a question. Numbers in words count the same.
 */
export function claimsAnswer(reply: string, given = ''): boolean {
  const words = wordsOf(reply);
  const known = captured(wordsOf(given), new RegExp(`(${NUMBER})`, 'g'));
  const statements = words
    .split(/(?<=[\n!?]|\.(?!\d))/)
    .filter((one) => !one.trim().endsWith('?'))
    .join(' ');
  const found = [
    ...CLAIMS.flatMap((pattern) => captured(words, pattern)),
    ...STATEMENTS.flatMap((pattern) => captured(statements, pattern)),
    ...statedValues(words),
  ];
  // A question that ends asking for its value ("mass = ?", "How fast is it?"): a number on its own answers it.
  if (/\?\s*$/.test(given.trim())) found.push(...loneNumbers(words));
  return found.some((one) => !known.some((two) => same(one, two)));
}

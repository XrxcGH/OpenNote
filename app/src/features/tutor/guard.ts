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

/**
 * Any script's decimal digits as ASCII ones: "٢" (Arabic-Indic) is "2". Unicode keeps each script's digits in a run of
 * ten from its zero, so a digit's value is its place in that run.
 */
function asciiDigits(text: string): string {
  return text.replace(/(?![0-9])\p{Nd}/gu, (digit) => {
    let code = digit.codePointAt(0) ?? 0;
    let place = 0;
    while (place < 60 && /\p{Nd}/u.test(String.fromCodePoint(code - 1))) {
      code -= 1;
      place += 1;
    }
    return String(place % 10);
  });
}

/** Lower case, superscripts as ^n, then full-width and other compatibility forms as plain ones ("ｘ＝２" is "x=2"). */
const plainForms = (text: string) =>
  asciiDigits(superscripts(text.toLowerCase()).normalize('NFKC')).replace(/[−–—]/g, '-').replace(/⁄/g, '/');

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
  const sides = expression.split('=').map((side) => termsOf(side).sort().join(''));
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
const VERB = String.raw`(?:be|equal(?: to)?|come (?:out )?(?:to|as|at)|end up(?: as| at| being| with)?|work out (?:to|as))`;
/** Verbs that link a name to its value: "is", "should come to", "ends up as". */
const LINK_VERBS = [
  `${MODAL}${VERB}`,
  String.raw`is(?:\s+(?:equal to|exactly|about|approximately|roughly|just))?`,
  'equals?(?: to)?',
  'becomes',
  'gives',
  'turns out(?: to be)?',
  'comes? (?:out )?(?:to|as|at)',
  'works? out(?: to| as)?',
  'ends? up(?: as| at| being| with)?',
  '(?:tends|goes|converges|adds up|sums|amounts) to',
  'approaches',
].join('|');
/** Words that link a name to its value: the verbs, and "about 2" on its own. */
const LINK_WORDS = `${LINK_VERBS}|approximately|about|roughly`;
/** Signs that state a value: "= 2", "→ 1", "≈ 0.33", "∈ {2}". */
const ARROWS = String.raw`=>|⇒|=|→|->|⟶|≈|≃|≡|~|∈\s*\{?`;
/** Signs that link a name to its value: the arrows, and a colon ("x: 2"). */
const LINK_SIGNS = `${ARROWS}|:`;
const LINK = `${LINK_SIGNS}|${LINK_WORDS}`;
/** Every arrow written as "=", to compare a piece of a hint with the student's text. */
const asEquals = (text: string) => text.replace(/=>|⇒|→|->|⟶|≈|≃|≡|~/g, '=');

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
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
    .replace(/\bunity\b/g, '1')
    .replace(/\ba pair\b/g, '2')
    .replace(/\b(?:double|twice) (\d+(?:\.\d+)?)(?!\d|[./]\d)/g, (_, n: string) => String(2 * Number(n)))
    .replace(/\b(?:a )?half of (\d+(?:\.\d+)?)(?!\d|[./]\d)/g, (_, n: string) => String(Number(n) / 2));
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

/** Letters as they are said aloud: "ex equals two". */
const SPOKEN: Readonly<Record<string, string>> = { x: 'ex', y: 'wye', z: 'zed|zee' };

/**
 * The value of a run of numbers and signs at the start of `run`, such as "1 + 1", "6 - 4", "sqrt(4)", "[2]" or "ten
 * minus eight", worked out with the math kit. Null when the run is not that, holds a letter, or the kit is not loaded.
 */
function numericValue(run: string): number | null {
  let text = run;
  for (const [pattern, sign] of MATH_WORDS) text = text.replace(pattern, ` ${sign} `);
  text = normalizeMath(text).replace(/\[/g, '(').replace(/\]/g, ')').replace(/√/g, 'sqrt');
  const lead = /^(?:sqrt|[\d.+\-*/^()])+/.exec(text)?.[0] ?? '';
  // "6 - 4y" is not a number: the run must end where the math does.
  if (!/\d/.test(lead) || /^[a-z0-9(]/.test(text.slice(lead.length))) return null;
  const kit = mathKit();
  if (!kit) return null;
  try {
    const value = kit.evaluator(kit.expression(lead, 'text'))({});
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether `words` says the letter's value in any way: "x = 2.0", "x should equal 2", "the answer: 4/2". */
function saysValue(words: string, shape: { letter: string; value: number }): boolean {
  const spoken = SPOKEN[shape.letter];
  const name = spoken ? `(?:${shape.letter}|${spoken})` : shape.letter;
  // "x = 1 + 1", "x = sqrt(4)", "x = \frac{4}{2}": the value worked out.
  const worked = new RegExp(String.raw`\b${name}\s*(?:${LINK})\s*((?:[^,;!?\n.]|\.(?=\d))+)`, 'g');
  for (const match of words.matchAll(worked)) {
    const value = numericValue(match[1] ?? '');
    if (value !== null && same(value, shape.value)) return true;
  }
  const told = [
    new RegExp(String.raw`\b${name}\s*(?:${LINK})\s*(${NUMBER})${NOT_LONGER}`, 'g'),
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
  const value = String.raw`(?:an?\s+)?(${NUMBER})${NOT_LONGER}`;
  const told = [
    new RegExp(String.raw`\b(?:${LINK_WORDS})\s*(${NUMBER})${NOT_LONGER}(?!\s*[a-z(])`, 'g'),
    new RegExp(String.raw`\b(?:${SUBJECT})\b[^.?!\n]{0,30}?(?:${LINK_WORDS}|:)\s*(${NUMBER})${NOT_LONGER}`, 'g'),
    // A correction that swaps the student's number for the right one: "Replace 10 with 4", "The 10 should be a 4".
    new RegExp(
      String.raw`\b(?:replace|change|swap|switch)\s+(?:the\s+)?${NUMBER}\s+(?:with|for|by|to|into)\s+${value}`,
      'g',
    ),
    new RegExp(String.raw`\binstead of\s+(?:the\s+|an?\s+)?${NUMBER}[,;]?\s+(?:[a-z']+\s+){0,3}?${value}`, 'g'),
    new RegExp(String.raw`(${NUMBER})${NOT_LONGER}\s+instead of\b`, 'g'),
    new RegExp(String.raw`\bnot\s+(?:an?\s+)?${NUMBER}\s*(?:,|;|-|but)\s*(?:but\s+|rather\s+)?${value}`, 'g'),
    new RegExp(String.raw`${NUMBER}\s+(?:should|must|needs to|ought to)\s+(?:be|read|say|become)\s+${value}`, 'g'),
  ];
  const found = [...told.flatMap((pattern) => captured(words, pattern)), ...loneNumbers(words)];
  // "= 1" or "→ 1" counts, but not when it is a piece of the question the student wrote, such as the n = 1 of a sum.
  const signed = new RegExp(String.raw`([a-z][\w^]*)?\s*(?:${ARROWS})\s*(${NUMBER})${NOT_LONGER}`, 'g');
  const question = asEquals(wrote);
  for (const match of words.matchAll(signed)) {
    const before = match[1];
    const piece = asEquals(normalizeMath(`${before ?? ''}=${match[2] ?? ''}`));
    if (!before || !standsAlone(question, piece)) found.push(numberOf(match[2] ?? ''));
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

/**
 * The runs of a hint that could be a formula: what is left between ordinary words, and each side of an "=". `rights`
 * holds the right side of each run with an "=", so an answer given piece by piece can be added up.
 */
function formulas(hint: string): string[] & { rights: string[] } {
  let text = wordsOf(hint);
  for (const [pattern, sign] of MATH_WORDS) text = text.replace(pattern, ` ${sign} `);
  const found = Object.assign([] as string[], { rights: [] as string[] });
  for (const clause of text.split(/[,;!?\n]|\.(?!\d)/)) {
    let run: string[] = [];
    const flush = () => {
      const joined = run.join(' ').trim();
      run = [];
      if (joined === '') return;
      const sides = joined.split(/[=:]/);
      const right = sides.length > 1 ? (sides[sides.length - 1] ?? '').trim() : '';
      if (right !== '' && found.rights.length < 10) found.rights.push(right);
      for (const side of [joined, ...sides]) {
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
  found.splice(40);
  return found;
}

/** A value for every name at one trial point: spread out, irregular, and different for each name. */
function pointFor(trial: number): Record<string, number> {
  const valueFor = (name: string) =>
    0.37 + 0.61 * trial + 0.13 * ([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7);
  return new Proxy({}, { get: (_, name) => (typeof name === 'string' ? valueFor(name) : undefined) });
}

/**
 * Whether two formulas have the same values at a few points (or, with `upToConstant`, differ by one constant), read
 * with the math kit, to within `tolerance` of their size. False when the kit is not loaded or either does not read.
 */
export function sameValues(a: string, b: string, upToConstant = false, tolerance = 1e-7): boolean {
  const kit = mathKit();
  if (!kit) return false;
  try {
    const [f, g] = [kit.evaluator(kit.expression(a, 'text')), kit.evaluator(kit.expression(b, 'text'))];
    const pairs: [number, number][] = [];
    for (let trial = 0; trial < 6; trial += 1) {
      const point = pointFor(trial);
      const [u, v] = [f(point), g(point)];
      if (Number.isFinite(u) && Number.isFinite(v)) pairs.push([u, v]);
    }
    const [u0, v0] = pairs[0] ?? [0, 0];
    const first = upToConstant ? u0 - v0 : 0;
    return (
      pairs.length >= 3 &&
      pairs.every(([u, v]) => Math.abs(u - v - first) < tolerance * Math.max(1, Math.abs(u), Math.abs(v)))
    );
  } catch {
    return false;
  }
}

/** The terms of a sum at its top level: "3x^2+5" is "3x^2" and "+5"; a term keeps its sign. */
function termsOf(side: string): string[] {
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
  return terms.map((one) => (one.startsWith('-') || one.startsWith('+') ? one : `+${one}`));
}

/** A decimal such as 0.333 is a rounded value: it counts to within a little over its last place. */
const toleranceFor = (formula: string) => (/\d\.\d/.test(formula) ? 2e-3 : 1e-7);

/**
 * Whether a formula in `hint` has the values of `secret`, an expression in letters such as "x^3/3 + C". The hint may
 * give it whole, rounded ("0.333x^3 + C"), with the constant anywhere ("(x^3 + 3C)/3"), or piece by piece: the right
 * sides added up ("d/dx(x^3) = 3x^2 and d/dx(5x) = 5") or, with `pieces`, one term of a sum ("the first piece gives
 * 3x^2"). The last rung shows a step that may hold a term, so it passes `pieces` false.
 */
function saysFormula(hint: string, secret: string, wrote: string, pieces: boolean): boolean {
  const plain = normalizeMath(secret);
  if (plain.includes('=') || plain.includes('≈') || !/[a-z]/.test(plain) || plain.length < 3) return false;
  const constant = /\+c$/.test(plain);
  const body = secret.replace(/\+\s*C\s*$/, '');
  const found = formulas(hint);
  const matches = (one: string, target: string, upToConstant: boolean) => {
    const form = normalizeMath(one);
    if (form === '' || standsAlone(wrote, form)) return false;
    // A C of the hint's own is the constant, not a letter to try values for.
    const formula = upToConstant
      ? one.replace(/(\d)\s*c(?![a-z])/g, '$1*0').replace(/(?<![a-z])c(?![a-z])/g, '0')
      : one;
    return sameValues(formula, target, upToConstant, toleranceFor(one));
  };
  if (found.some((one) => matches(one, body, constant))) return true;
  if (found.rights.length >= 2 && matches(found.rights.map((one) => `(${one})`).join('+'), body, constant)) return true;
  if (!pieces) return false;
  const all = termsOf(plain.replace(/\+c$/, '')).map((term) => term.replace(/^\+/, ''));
  if (all.length < 2) return false;
  // A term worth hiding holds a letter, is more than the letter alone, and is not one the student wrote.
  const terms = all.filter((term) => /[a-z]/.test(term) && !/^-?[a-z]$/.test(term) && !standsAlone(wrote, term));
  return terms.some((term) => found.some((one) => matches(one, term, false)));
}

/** Long enough to look for: three characters, or two with a sign such as "√2" or "-5". */
const long = (form: string) => form.length >= 3 || (form.length === 2 && /[^a-z0-9]/.test(form));

/**
 * Whether `hint` gives away any of `secrets`. `given` is what the student wrote: what is in it is not secret. With
 * `pieces` (every rung before the last), one term of an answer that is a sum counts as giving it away.
 */
export function leaks(
  hint: string,
  secrets: readonly (string | null | undefined)[],
  given = '',
  pieces = true,
): boolean {
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
    if (saysFormula(hint, secret, wrote, pieces)) return true;
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
/** Words that state a result: the link verbs ("would be", "ends up with", "works out as") and a few more. */
const STATES = [
  LINK_VERBS,
  'are|was|were|get|gets|got|giving',
  'yields?|yielding|produces?|producing|makes?|making|forms?|forming|totals?|totalling|leaves?|leaving',
].join('|');
const REACHES = String.raw`needs?|needed|reach(?:es|ed)?|gives? you|get|gets|got|leaves?|left with`;
const HAVE = String.raw`(?:have|has|had)(?:\s+(?:your|got|the))?`;
const CLAIMS = [
  new RegExp(
    String.raw`\b(?:answer|result|solution)\b[^.?!\n]{0,40}?(?:${ARROWS}|:|\bis\b|\bequals\b)\s*(${NUMBER})`,
    'g',
  ),
  // "Answer 36 g", "Answer - 6 N".
  new RegExp(String.raw`\banswers?\s*[-:]?\s*${AMOUNT}`, 'g'),
  new RegExp(String.raw`\b(?:so|therefore|thus|hence)\b[^.?!\n]{0,40}?(?:${ARROWS})\s*(${NUMBER})`, 'g'),
  new RegExp(String.raw`(?:${ARROWS})\s*${AMOUNT}\s*${UNIT}`, 'g'),
  new RegExp(String.raw`(?:${ARROWS})\s*${AMOUNT}\s*(?:[.!?]|$)`, 'g'),
  new RegExp(String.raw`\b(?:${STATES})\s+${AMOUNT}(?:\s*${UNIT})?${CLAUSE_END}`, 'g'),
  new RegExp(String.raw`\b(?:so|therefore|thus|hence)\s+${AMOUNT}\s*${UNIT}`, 'g'),
  new RegExp(String.raw`(?:^|[.!?]\s+)${AMOUNT}\s*${UNIT}\s*(?=[.!?]|$)`, 'g'),
  // "You need 36 g", "to reach 36 g", "That gives you 36 g", "and you have your 36 g".
  new RegExp(String.raw`\b(?:${REACHES}|${HAVE})\s+${AMOUNT}\s*${UNIT}`, 'g'),
];

/** Results stated outside a question: "What is the mass of 1 mol of water?" asks, it does not tell. */
const STATEMENTS = [
  // "F: 6 N", "Water produced: 36 g", "Multiply 2 by 3: 6 N".
  new RegExp(String.raw`:\s*${AMOUNT}\s*${UNIT}`, 'g'),
  // "6 N is the force", "36 g of H2O", "36 grams of water form".
  new RegExp(String.raw`(?<![\w.])${AMOUNT}\s*${UNIT}\s+(?:is|are|was|of)\b`, 'g'),
  // "36 g total", "36 g in all", "36 g (two moles)".
  new RegExp(String.raw`(?<![\w.])${AMOUNT}\s*${UNIT}\s*(?:\(|(?:in total|total|altogether|in all|overall)\b)`, 'g'),
];

/** Words just before a letter's value that offer it to try rather than state it: "Try n = 5", "put x = 3 in". */
const TRY_WORDS = [
  'try|trying|pick|choose|put|plug|substitute|test|testing|check|let|set',
  'suppose|assume|if|when|say|guess|like|start|starting|begin',
].join('|');
const TRIES = new RegExp(String.raw`\b(?:${TRY_WORDS})\b[^,;:]{0,16}$`);

/** A list of values, "2", "2 and 3", "2, 3 or 4", each captured whole. */
const VALUES = String.raw`(${NUMBER}${NOT_LONGER}(?:\s*(?:,|or|and)\s*${NUMBER}${NOT_LONGER})*)`;
/** What may not follow a letter's value, so "x = 2x + 1" and "x = 3(...)" are not read as values. */
const VALUE_END = String.raw`(?![a-z(^*/]|\s*[(^*/+-]\s*[\w(])`;
const LETTER_VALUES = new RegExp(String.raw`(?<![\w^.'])[a-z]\s*(?:${LINK})\s*\{?\s*${VALUES}${VALUE_END}`, 'g');
const SOLUTIONS = String.raw`(?:answers?|results?|solutions?|roots?|zeros?|zeroes)\b`;
const LISTED = new RegExp(
  String.raw`\b${SOLUTIONS}(?:\s+set)?[^\d]{0,20}?(?:${ARROWS}|:|\b(?:is|are|equals?)\b)\s*\{?\s*${VALUES}${VALUE_END}`,
  'g',
);
/** "Both 2 and 3 work", "3 is a root too", but not "line 2 works". */
const NOT_AFTER = String.raw`(?<!\b(?:lines?|steps?|rungs?|hints?|pages?|parts?|rows?|columns?)\s)(?<![\w.^])`;
const IS_RIGHT = String.raw`(?:is|are)\s+(?:also\s+)?(?:a\s+|the\s+)?(?:right|correct|${SOLUTIONS})`;
const WORKS = new RegExp(
  String.raw`${NOT_AFTER}${VALUES}\s+(?:both\s+|also\s+)?(?:works?|satisf(?:y|ies)|${IS_RIGHT})\b`,
  'g',
);
const EVERY_NUMBER = new RegExp(`(${NUMBER})${NOT_LONGER}`, 'g');

/**
 * The values a text states for a letter ("x = 3 is the other root", "x equals 3", "x ∈ {2, 3}", "x = 2 or 3"), every
 * number in a list of solutions ("the solutions are 2 and 3"), and values said to work ("both 2 and 3 work"). A
 * letter's value offered to try ("Try n = 5") is not stated, unless `offered` counts those too.
 */
function statedValues(words: string, offered = false): number[] {
  const found: number[] = [];
  for (const sentence of words.split(/\n|[!?;]|\.(?!\d)/)) {
    for (const match of sentence.matchAll(LETTER_VALUES))
      if (offered || !TRIES.test(sentence.slice(0, match.index))) found.push(...captured(match[1] ?? '', EVERY_NUMBER));
    for (const pattern of [LISTED, WORKS])
      for (const match of sentence.matchAll(pattern)) found.push(...captured(match[1] ?? '', EVERY_NUMBER));
  }
  return found.filter((one) => !Number.isNaN(one));
}

/**
 * Whether `reply` states a result that the student's text (`given`) does not already hold. A heuristic, for problems
 * whose answer the rules cannot work out. It catches "the answer is 36 g", "so F = 6 N", "F would be 6 N", "you end
 * up with 36 g" and "F → 6 N". It also catches "F: 6 N", "36 g of water", "36 g total", "you need 36 g" and a number
 * with a unit on its own ("Forty mph."). Numbers in words count the same.
 *
 * Those amounts are results only when the student's text lacks them. A letter's value is stricter: "x = 3", a list
 * of solutions, or "3 works" is a result unless the student stated that value the same way (a line such as x = 3),
 * because the numbers of a problem (the 3 of (x - 3)) are often its answer. A lone number ("Three.") counts when the
 * student's text ends in a question or solves for a letter.
 */
export function claimsAnswer(reply: string, given = ''): boolean {
  const words = wordsOf(reply);
  const wrote = wordsOf(given);
  const known = captured(wrote, new RegExp(`(${NUMBER})`, 'g'));
  const stated = statedValues(wrote, true);
  const statements = words
    .split(/(?<=[\n!?]|\.(?!\d))/)
    .filter((one) => !one.trim().endsWith('?'))
    .join(' ');
  const amounts = [
    ...CLAIMS.flatMap((pattern) => captured(words, pattern)),
    ...STATEMENTS.flatMap((pattern) => captured(statements, pattern)),
  ];
  // A question that ends asking for its value ("mass = ?", "How fast is it?"): a number on its own answers it.
  if (/\?\s*$/.test(given.trim())) amounts.push(...loneNumbers(words));
  const values = statedValues(words);
  // Working that solves for a letter ("x^2 - 5x + 6 = 0"): a number on its own is a value of that letter.
  if (/(?<![a-z])[a-z](?![a-z])/.test(wrote) && wrote.includes('=')) values.push(...loneNumbers(words));
  return (
    amounts.some((one) => !known.some((two) => same(one, two))) ||
    values.some((one) => !stated.some((two) => same(one, two)))
  );
}

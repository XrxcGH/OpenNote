// Splitting a line of worked math into its parts: clauses joined by "and", ",", ";" or "or", and the sides of each
// relation (=, <, >, <=, >=, !=). Brackets of every kind are respected, so the "=" in Σ_(n=1) and the commas in
// [[1, 2], [3, 4]] stay where they are. Text only; the parts are read as math in read.ts.

export type Rel = '=' | '<' | '>' | '<=' | '>=' | '!=';

export interface Clause {
  /** The sides, in order. A line that starts with "=" has an empty first side. */
  sides: string[];
  /** The relations between the sides: one fewer than the sides. */
  rels: Rel[];
}

export interface SplitLine {
  clauses: Clause[];
  /** How the clauses join: all of them ("and", ",", ";") or any of them ("or"). */
  join: 'and' | 'or';
}

const OPEN = '([{';
const CLOSE = ')]}';

const VULGAR: Record<string, string> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅕': '1/5',
  '⅙': '1/6',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅚': '5/6',
  '⅐': '1/7',
  '⅑': '1/9',
  '⅒': '1/10',
};

/** Plain marks for the symbols people type or paste. */
export function normalize(text: string): string {
  return tupleVectors(detCall(groupDivision(normalizeMarks(degrees(text)))));
}

/** cos(60°) is cos(60 pi/180): degrees as radians. Not °C or °F, temperatures. */
function degrees(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?)\s*°(?!\s*[CF]\b)/g, '($1*pi/180)');
}

function normalizeMarks(text: string): string {
  return (
    text
      .replace(/[−–—]/g, '-')
      .replace(/[·⋅∙]/g, '*')
      .replace(/⟨/g, '[')
      .replace(/⟩/g, ']')
      .replace(/≤|⩽/g, '<=')
      .replace(/≥|⩾/g, '>=')
      .replace(/≠/g, '!=')
      // ≈ is checked as =: a side written as a decimal is then compared to the places it shows (see compare.ts).
      .replace(/≈|~=/g, '=')
      .replace(/->/g, '→')
      .replace(/∑/g, 'Σ')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/′/g, "'")
      // Vulgar fractions, and percent as a fraction of 100: 25% of 80 is 25/100 * 80.
      .replace(/[½⅓⅔¼¾⅕⅙⅛⅜⅝⅞⅖⅗⅘⅚⅐⅑⅒]/g, (c) => `(${VULGAR[c]})`)
      .replace(/(\d+(?:\.\d+)?)\s*%\s*of\b/g, '($1/100) *')
      .replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)')
      .replace(/\b(?:infinity|inf|oo)\b/g, '∞')
      .replace(/\blog_\(?(\d+)\)?\s*\(([^()]*)\)/g, '(ln($2)/ln($1))')
      .replace(/\s+/g, ' ')
      .replace(/\bdet\s+\[/g, 'det[')
      // A mixed number, 1 1/2, is one and a half, not one times a half.
      .replace(/(^|[\s(=+\-<>])(\d+) (\d+)\/(\d+)(?![\d.(\w^])/g, '$1($2 + $3/$4)')
      .trim()
  );
}

const STOPS = '+-=<>,;!';

/**
 * a ÷ b, with each side the whole run of marks next to it: 2/3 ÷ 4/5 is (2/3)/(4/5), as every student means it, not
 * ((2/3)/4)/5. A run stops at a space, at + - = < > , ; and at a bracket it did not open; on the right it also stops
 * at × and *, so 12 ÷ 3 × 2 is still (12/3) × 2.
 */
function groupDivision(text: string): string {
  let out = text;
  for (let at = out.indexOf('÷'), guard = 0; at >= 0 && guard < 50; at = out.indexOf('÷'), guard += 1) {
    let l = at;
    while (l > 0 && out[l - 1] === ' ') l -= 1;
    let from = l;
    for (let depth = 0; from > 0; from -= 1) {
      const c = out[from - 1];
      if (CLOSE.includes(c)) depth += 1;
      else if (OPEN.includes(c)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && (c === ' ' || STOPS.includes(c))) break;
    }
    let r = at + 1;
    while (r < out.length && out[r] === ' ') r += 1;
    let to = r;
    if (out[to] === '-' || out[to] === '+') to += 1;
    for (let depth = 0; to < out.length; to += 1) {
      const c = out[to];
      if (OPEN.includes(c)) depth += 1;
      else if (CLOSE.includes(c)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && (c === ' ' || c === '×' || c === '*' || c === '÷' || STOPS.includes(c))) break;
    }
    const [left, right] = [out.slice(from, l), out.slice(r, to)];
    // Nothing on one side: an unreadable line, left for the reader to say so.
    const middle = left && right ? `(${left})/(${right})` : `${left}/${right}`;
    out = out.slice(0, from) + middle + out.slice(to);
  }
  return out;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
/** (1, 2, 3): two to four numbers in round brackets, not the arguments of a function such as C(5, 2). */
const TUPLE = new RegExp(String.raw`(?<![\w)\]])\(\s*${NUM}(?:\s*,\s*${NUM}){1,3}\s*\)`, 'g');
const VECTOR = String.raw`(?:\(\s*${NUM}(?:\s*,\s*${NUM}){1,3}\s*\)|\[[^[\]]*\])`;
const JOINED = new RegExp(String.raw`${VECTOR}\s*[*×+-]\s*${VECTOR}`);
/** 3(1, 2, 3) or 3 × (1, 2, 3): a number times a tuple, a vector scaled. Not C(5, 2), whose letter is a name. */
const SCALED = new RegExp(
  String.raw`(?<![\w.])(\d+(?:\.\d+)?)\s*[*×·]?\s*\(\s*(${NUM}(?:\s*,\s*${NUM}){1,3})\s*\)`,
  'g',
);

/**
 * (1, 2, 3) · (4, -5, 6) and ⟨1, 2⟩ + ⟨3, 4⟩ (whose brackets are square by now): vectors, written as [1, 2, 3]. Only
 * when two of them are joined by a product, a sum or a difference, one is scaled by a number (3(1, 2, 3)), or a
 * line is "= (0, 0, 1)" after such a line: a
 * lone (1, 2) may be a point or an interval.
 */
function tupleVectors(text: string): string {
  const answer = new RegExp(String.raw`^=\s*\(\s*${NUM}(?:\s*,\s*${NUM}){1,3}\s*\)$`).test(text);
  const scaled = new RegExp(SCALED.source).test(text);
  if (!answer && !scaled && !JOINED.test(text)) return text;
  const vectors = text.replace(SCALED, (_, k: string, entries: string) => `${k}[${entries}]`);
  return vectors.replace(TUPLE, (tuple) => `[${tuple.slice(1, -1)}]`);
}

/** det [[2, 1], [5, 3]] is det([[2, 1], [5, 3]]). */
function detCall(text: string): string {
  const at = text.indexOf('det[');
  if (at < 0) return text;
  let depth = 0;
  for (let i = at + 3; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']' && --depth === 0) {
      return `${text.slice(0, at)}det(${text.slice(at + 3, i + 1)})${detCall(text.slice(i + 1))}`;
    }
  }
  return text;
}

/** The names a line may spell out: functions, constants, Greek letters, and the words that set up a substitution. */
const KNOWN = [
  'sqrt',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'ln',
  'log',
  'exp',
  'abs',
  'det',
  'lim',
  'pi',
  'tau',
  'phi',
  'theta',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'lambda',
  'sigma',
  'omega',
  'mu',
  'where',
  'with',
].sort((a, b) => b.length - a.length);

/** True when a run of letters is a word, such as Problem or divide: four or more letters left after the known names. */
function isWord(run: string): boolean {
  const lower = run.toLowerCase();
  let singles = 0;
  for (let i = 0; i < lower.length;) {
    const known = KNOWN.find((name) => lower.startsWith(name, i));
    if (known) i += known.length;
    else {
      singles += 1;
      i += 1;
    }
  }
  return singles >= 4;
}

/** True when the text has a word in it, not just letters multiplied together. */
/**
 * slope = (5 - 1)/(3 - 1) or Area = πr^2: a word naming the value, like LHS, dropped so the rest is checked. Only
 * when one word stands before the first = and nothing after it is a word.
 */
export function dropWordLabel(text: string): string {
  const found = /^([a-zA-Z]+)\s*=\s*(?!=)/.exec(text);
  if (!found || !isWord(found[1])) return text;
  const rest = text.slice(found[0].length);
  return hasWords(rest) ? text : rest;
}

export function hasWords(text: string): boolean {
  return (text.match(/[a-zA-Z]+/g) ?? []).some(isWord);
}

/** Notes in brackets at the end of a line, such as (divide by 2) or [add 3 to both sides]: they are dropped. */
export function dropNotes(text: string): string {
  let out = text;
  for (let guard = 0; guard < 4; guard += 1) {
    const note = /\s*[([]([^()[\]]*)[)\]]\s*$/.exec(out);
    if (!note || !hasWords(note[1]) || note.index === 0) break;
    out = out.slice(0, note.index).trim();
  }
  return out;
}

/** A problem's number or title at the start of a line: 1), 2., (a), Q3, Problem 2, Exercise 4b. */
const PROBLEM = new RegExp(
  [
    String.raw`^(?:(?:problem|question|exercise|example|ex|q|part|#)\s*\.?\s*\d+[a-z]?\s*[.):]?`,
    String.raw`\(?\d+[a-z]?\)`,
    String.raw`\d+[a-z]?\.`,
    String.raw`\(?[a-h]\))(?=\s|$)\s*[:.-]?\s*`,
  ].join('|'),
  'i',
);
/** A step's label at the start of a line, Step 2:, which belongs to the same problem. */
const STEP = /^step\s*\d+\s*[:.)-]?\s*/i;

/**
 * The rest of the line when it starts with a new problem's number or title, so the checker starts again there; or
 * null when it does not. A step label is dropped without starting again.
 */
export function problemLead(text: string): { rest: string; starts: boolean } {
  const step = STEP.exec(text);
  if (step) return { rest: text.slice(step[0].length), starts: false };
  const lead = PROBLEM.exec(text);
  return lead ? { rest: text.slice(lead[0].length), starts: true } : { rest: text, starts: false };
}

const STEP_MARK = /^(?:→|⇒|=>|∴|(?:so|then|therefore|thus|hence)(?![a-zA-Z]))/i;

/**
 * 2x + 3 = 7 → 2x = 4 → x = 2: the steps of one line, split at →, ⇒, ∴, so and therefore outside every bracket. A
 * line with a limit keeps its arrows, since x → 0 there is not a step.
 */
export function splitSteps(text: string): string[] {
  if (/(?<![a-zA-Z])lim(?![a-zA-Z])/.test(text)) return [text];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const mark = STEP_MARK.exec(text.slice(i));
      const word = mark && /^[a-z]/i.test(mark[0]);
      if (mark && (!word || (i > 0 && text[i - 1] === ' '))) {
        parts.push(text.slice(start, i));
        start = i + mark[0].length;
        i = start - 1;
      }
    }
  }
  parts.push(text.slice(start));
  const steps = parts.map((part) => part.trim()).filter((part) => part !== '');
  return steps.length > 0 ? steps : [text];
}

/** Words and marks at the start of a line that only say "so": they are dropped. */
export function dropLead(text: string): string {
  return text
    .replace(/^(?:(?:so|then|thus|hence|therefore|which gives|gives)\b[:,]?|(?:ans|answer|check)\s*:|⇒|=>|∴|→)\s*/i, '')
    .trim();
}

/** Marks at the end of an answer, such as a tick, (ans) or QED: they are dropped. */
export function dropMarks(text: string): string {
  return text.replace(/\s*(?:[✓✔☑∎□■]|\((?:ans|answer)\)|\bQ\.?E\.?D\.?)\s*$/i, '').trim();
}

const SIDE_LABEL = String.raw`(?:L\.?H\.?S\.?|R\.?H\.?S\.?)`;

/**
 * LHS = 3(5) - 4 = 11 = RHS: the side labels of a check are dropped, leaving the values. Null for LHS = RHS alone,
 * which is a note.
 */
export function dropSideLabels(text: string): string | null {
  if (new RegExp(`^${SIDE_LABEL}\\s*=\\s*${SIDE_LABEL}$`, 'i').test(text)) return null;
  return text
    .replace(new RegExp(`^${SIDE_LABEL}\\s*=\\s*`, 'i'), '')
    .replace(new RegExp(`\\s*=\\s*${SIDE_LABEL}$`, 'i'), '')
    .trim();
}

/** Answers listed after one letter, such as x ∈ {2, 3}, written out as x = 2 or x = 3. The braces may be left out. */
export function listedAnswers(text: string): string {
  // x = 2 or -2: the letter is meant on each value, x = 2 or x = -2.
  const either = /^([a-zA-Z])\s*=\s*(-?[\d./]+)((?:\s+or\s+-?[\d./]+)+)$/.exec(text);
  if (either) {
    const values = [either[2], ...either[3].split(/\s+or\s+/).filter(Boolean)];
    return values.map((value) => `${either[1]} = ${value.trim()}`).join(' or ');
  }
  const found = /^([a-zA-Z])\s*(?:=|∈)\s*\{?\s*(-?[\d./]+(?:\s*,\s*-?[\d./]+)+)\s*\}?$/.exec(text);
  if (!found) return text;
  return found[2]
    .split(',')
    .map((value) => `${found[1]} = ${value.trim()}`)
    .join(' or ');
}

/** Splits at a separator found outside every bracket. */
function splitTop(text: string, at: (text: string, i: number) => number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const length = at(text, i);
      if (length > 0) {
        parts.push(text.slice(start, i));
        start = i + length;
        i += length - 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

const wordAt = (word: string) => (text: string, i: number) =>
  text.startsWith(` ${word} `, i - 1) && text[i - 1] === ' ' ? word.length : 0;

/** The relations in one clause, with "<=" read before "<". A "=" right after "!", "<" or ">" belongs to them. */
function relationAt(text: string, i: number): [Rel, number] | null {
  const two = text.slice(i, i + 2);
  if (two === '<=' || two === '>=') return [two, 2];
  // 5! = 120 is a factorial; x != 3 has a space before the mark.
  if (two === '!=' && text[i - 1] === ' ') return [two, 2];
  const c = text[i];
  if (c === '<' || c === '>' || c === '=') return [c, 1];
  return null;
}

function splitClause(text: string): Clause {
  const sides: string[] = [];
  const rels: Rel[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const found = relationAt(text, i);
      if (found) {
        sides.push(text.slice(start, i).trim());
        rels.push(found[0]);
        start = i + found[1];
        i += found[1] - 1;
      }
    }
  }
  sides.push(text.slice(start).trim());
  return { sides, rels };
}

/** A line as clauses and relations. "or" wins over "and" when a line has both, since "x = 1 or x = 2" is common. */
export function splitLine(text: string): SplitLine {
  const or = splitTop(text, wordAt('or'));
  if (or.length > 1) return { clauses: or.map(splitClause), join: 'or' };
  const and = splitTop(text, (t, i) => (t[i] === ';' || (t[i] === ',' && t[i + 1] === ' ') ? 1 : wordAt('and')(t, i)));
  return { clauses: and.filter((part) => part !== '').map(splitClause), join: 'and' };
}

/** The relation turned around, as when both sides are multiplied by a negative number. */
export function flip(rel: Rel): Rel {
  return rel === '<' ? '>' : rel === '>' ? '<' : rel === '<=' ? '>=' : rel === '>=' ? '<=' : rel;
}

const binomial = (n: number, k: number): number => {
  let out = 1;
  for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
  return Math.round(out);
};

/**
 * Notation with its own way of writing, put as plain math: log_2 8 is ln(8)/ln(2), C(5, 2) and 5C2 are the binomial
 * 10, and 7 mod 3 is 1. Only numbers for C and mod, so C(x) stays a function. log_2 x^3 is left unread.
 */
export function notation(text: string): string {
  return (
    text
      .replace(
        /\blog_\{?(\d+(?:\.\d+)?|e)\}?\s*(\([^()]*\)|\d+(?:\.\d+)?(?![\d.^])|[a-zA-Z](?![a-zA-Z(^]))/g,
        (_, base: string, arg: string) => `(ln(${arg.replace(/^\((.*)\)$/, '$1')})/ln(${base}))`,
      )
      .replace(/\b(?:C\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)|(\d{1,3})C(\d{1,3})\b)/g, (whole, a, b, c, d) => {
        const [n, k] = [Number(a ?? c), Number(b ?? d)];
        return k <= n ? `(${binomial(n, k)})` : whole;
      })
      // Not after * or ^, where mod would take more than the number before it; a minus only as a sign.
      .replace(/(?<![*/×·^]\s*)((?:(?<![\w).]\s*)-)?\d+)\s*mod\s*(\d+)\b/g, (whole, a: string, b: string) => {
        const [x, m] = [Number(a), Number(b)];
        return m > 0 ? `(${((x % m) + m) % m})` : whole;
      })
  );
}

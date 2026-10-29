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
};

/** Plain marks for the symbols people type or paste. */
export function normalize(text: string): string {
  return (
    text
      .replace(/[−–—]/g, '-')
      .replace(/[·⋅∙]/g, '*')
      .replace(/÷/g, '/')
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
      .replace(/[½⅓⅔¼¾⅕⅙⅛]/g, (c) => `(${VULGAR[c]})`)
      .replace(/(\d+(?:\.\d+)?)\s*%\s*of\b/g, '($1/100) *')
      .replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)')
      .replace(/\b(?:infinity|inf|oo)\b/g, '∞')
      .replace(/\blog_\(?(\d+)\)?\s*\(([^()]*)\)/g, '(ln($2)/ln($1))')
      .replace(/\s+/g, ' ')
      // A mixed number, 1 1/2, is one and a half, not one times a half.
      .replace(/(^|[\s(=+\-<>])(\d+) (\d+)\/(\d+)(?![\d.(\w^])/g, '$1($2 + $3/$4)')
      .trim()
  );
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

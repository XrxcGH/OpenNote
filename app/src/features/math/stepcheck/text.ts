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

/** Plain marks for the symbols people type or paste. */
export function normalize(text: string): string {
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[·⋅∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤|⩽/g, '<=')
    .replace(/≥|⩾/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/->/g, '→')
    .replace(/∑/g, 'Σ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/′/g, "'")
    .replace(/\b(?:infinity|inf|oo)\b/g, '∞')
    .replace(/\blog_\(?(\d+)\)?\s*\(([^()]*)\)/g, '(ln($2)/ln($1))')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words and marks at the start of a line that only say "so": they are dropped. */
export function dropLead(text: string): string {
  return text.replace(/^(?:(?:so|then|thus|hence|therefore|which gives|gives)\b[:,]?|⇒|=>|∴|→)\s*/i, '').trim();
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

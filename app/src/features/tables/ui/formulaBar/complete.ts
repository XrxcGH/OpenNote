// Autocomplete and argument hints for a formula being typed. Autocomplete offers functions (from the function
// registry), defined names, tables, and a table's columns after "Table[". The hint names the function the caret is
// in and which argument it is on.
import { allFunctions, fnInfo, partOfArg, specOf } from './functions';
import { formulaSeparator, scanFormula } from './scan';
import type { Token } from './scan';

export type SuggestionKind = 'function' | 'name' | 'table' | 'column';

export interface Suggestion {
  readonly kind: SuggestionKind;
  /** What the list shows. */
  readonly label: string;
  /** What replaces the typed part: "VLOOKUP(" for a function. */
  readonly insert: string;
  /** One line about it: the function's summary, or the name's formula. */
  readonly detail: string;
}

export interface CompleteContext {
  /** Defined names the formula can use, with their formulas. */
  readonly names?: readonly { name: string; ref: string }[];
  /** The tables of the page by name, with their column names. */
  readonly tables?: readonly { name: string; columns: readonly string[] }[];
  readonly separator?: ',' | ';';
}

export interface Completion {
  /** The typed part the suggestions would replace. */
  readonly start: number;
  readonly end: number;
  readonly items: Suggestion[];
}

const LIMIT = 50;

/** Ranks a match: the exact name first, then names that start with the typed part, alphabetically. */
const byRank = (typed: string) => (a: Suggestion, b: Suggestion) => {
  const exact = (s: Suggestion) => (s.label.toUpperCase() === typed ? 0 : 1);
  return exact(a) - exact(b) || a.label.localeCompare(b.label);
};

/** The word the caret ends, when it can start a function, a name, or a table. */
function typedWord(tokens: readonly Token[], caret: number): Token | undefined {
  const token = tokens.find((t) => t.end === caret && t.start < caret);
  if (!token || !['function', 'name', 'ref', 'bool'].includes(token.kind)) return undefined;
  if (token.kind === 'ref' && token.sheet !== undefined) return undefined;
  return token;
}

/** The suggestions for the caret's place in the formula, or null when nothing is being typed there. */
export function complete(text: string, caret: number, context: CompleteContext = {}): Completion | null {
  if (!text.startsWith('=')) return null;
  const tokens = scanFormula(text.slice(0, caret), { separator: context.separator ?? formulaSeparator() });
  const last = tokens.at(-1);
  // After "Table[": the table's columns.
  if (last?.kind === 'struct' && !last.text.endsWith(']')) {
    const open = last.text.indexOf('[');
    const tableName = last.text.slice(0, open);
    const typed = last.text.slice(open + 1).replace(/^@/, '');
    const table = context.tables?.find((t) => t.name.toLowerCase() === tableName.toLowerCase());
    if (!table) return null;
    const items = table.columns
      .filter((c) => c.toLowerCase().startsWith(typed.toLowerCase()))
      .map((c): Suggestion => ({ kind: 'column', label: c, insert: `${c}]`, detail: tableName }));
    const start = last.start + open + 1 + (last.text[open + 1] === '@' ? 1 : 0);
    return items.length ? { start, end: caret, items: items.slice(0, LIMIT) } : null;
  }
  const word = typedWord(tokens, caret);
  if (!word) return null;
  const typed = word.text.toUpperCase();
  const items: Suggestion[] = [];
  for (const name of allFunctions()) {
    if (!name.startsWith(typed)) continue;
    items.push({ kind: 'function', label: name, insert: `${name}(`, detail: fnInfo(name)?.summary ?? '' });
  }
  for (const entry of context.names ?? []) {
    if (entry.name.toUpperCase().startsWith(typed))
      items.push({ kind: 'name', label: entry.name, insert: entry.name, detail: `=${entry.ref}` });
  }
  for (const table of context.tables ?? []) {
    if (table.name.toUpperCase().startsWith(typed))
      items.push({ kind: 'table', label: table.name, insert: `${table.name}[`, detail: '' });
  }
  items.sort(byRank(typed));
  return items.length ? { start: word.start, end: caret, items: items.slice(0, LIMIT) } : null;
}

/** Puts a suggestion in place of the typed part. */
export function accept(text: string, completion: Completion, item: Suggestion): { text: string; caret: number } {
  const next = text.slice(0, completion.start) + item.insert + text.slice(completion.end);
  return { text: next, caret: completion.start + item.insert.length };
}

export interface Hint {
  readonly name: string;
  /** Which argument the caret is on, zero-based, and the hint part to show in bold (-1: none). */
  readonly arg: number;
  readonly part: number;
}

/** The function call the caret is inside and the argument it is on, or null outside every known function. */
export function hintAt(text: string, caret: number, separator = formulaSeparator()): Hint | null {
  if (!text.startsWith('=')) return null;
  const tokens = scanFormula(text.slice(0, caret), { separator });
  const stack: { name: string | null; arg: number }[] = [];
  let previous: Token | undefined;
  for (const token of tokens) {
    if (token.kind === 'open') stack.push({ name: previous?.kind === 'function' ? previous.text : null, arg: 0 });
    else if (token.kind === 'brace' && token.text === '{') stack.push({ name: null, arg: 0 });
    else if (token.kind === 'close' || (token.kind === 'brace' && token.text === '}')) stack.pop();
    else if (token.kind === 'sep' && stack.length > 0) stack[stack.length - 1]!.arg += 1;
    if (token.kind !== 'space') previous = token;
  }
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const frame = stack[i]!;
    if (frame.name === null) continue;
    const spec = specOf(frame.name);
    if (!spec) return null;
    return { name: spec.name, arg: frame.arg, part: partOfArg(spec, frame.arg) };
  }
  return null;
}

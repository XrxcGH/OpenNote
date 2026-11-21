// A lenient scanner for formula text as it is typed. The engine's lexer refuses text it cannot read, but the formula
// bar colors, completes, and hints text that is half written, so this scanner never fails: what it cannot read
// becomes an 'other' token. It finds functions, names, references (with a table and a range), numbers, text, errors,
// operators, brackets, and separators, each with its place in the text.
import { appLocale } from '../../smart/locale';

export type TokenKind =
  | 'equals'
  | 'number'
  | 'string'
  | 'ref'
  | 'function'
  | 'name'
  | 'bool'
  | 'error'
  | 'struct'
  | 'op'
  | 'open'
  | 'close'
  | 'sep'
  | 'brace'
  | 'space'
  | 'other';

/** One cell of a reference: zero-based column and row as written (row 0 is "1"), and which parts carry "$". */
export interface CellRef {
  readonly col: number;
  readonly row: number;
  readonly colAbs: boolean;
  readonly rowAbs: boolean;
}

export interface Token {
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** For a reference: the table it names before "!", if any. */
  readonly sheet?: string;
  /** For a reference: its first cell, and its last cell when it is a range. */
  readonly first?: CellRef;
  readonly last?: CellRef;
}

export interface ScanOptions {
  /** The argument separator people type: "," or ";". The person's region gives it when left out. */
  separator?: ',' | ';';
}

/** The argument separator of the person's region: ";" where the decimal mark is a comma, else ",". */
export function formulaSeparator(): ',' | ';' {
  return appLocale().list;
}

const ERRORS =
  /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!|BUSY!|FIELD!|BLOCKED!|CONNECT!|UNKNOWN!)/i;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const WORD = /^[\p{L}_\\$][\p{L}\p{N}_.$]*/u;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;
const OPERATORS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', '@', ':', '#'];

/** Column letters to a zero-based column: column A is 0, Z is 25, and AA is 26. */
export function columnOf(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A zero-based column to its letters. */
export function lettersOf(col: number): string {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Reads "B2", "$B$2", "B$2" as a cell, or null. */
export function readCell(text: string): CellRef | null {
  const m = CELL.exec(text);
  if (!m) return null;
  const col = columnOf(m[2]!);
  const row = Number(m[4]) - 1;
  if (col > 16383 || row < 0 || row > 1048575) return null;
  return { col, row, colAbs: m[1] === '$', rowAbs: m[3] === '$' };
}

/** A cell as formulas write it. */
export function cellText(cell: CellRef): string {
  return `${cell.colAbs ? '$' : ''}${lettersOf(cell.col)}${cell.rowAbs ? '$' : ''}${cell.row + 1}`;
}

/** The text of a reference token without "$" and in capitals, so the same cells read as one reference. */
export function refKey(token: Token): string {
  const plain = (cell: CellRef) => `${lettersOf(cell.col)}${cell.row + 1}`;
  const sheet = token.sheet ? `${token.sheet.toUpperCase()}!` : '';
  return `${sheet}${token.first ? plain(token.first) : ''}${token.last ? `:${plain(token.last)}` : ''}`;
}

/** The end of a bracketed part that starts at `at` ("[" ... "]", nested brackets included). */
function bracketEnd(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']' && --depth === 0) return i + 1;
  }
  return text.length;
}

/** The end of a quoted part that starts at `at`, where a doubled quote stands for one. Unclosed runs to the end. */
function quotedEnd(text: string, at: number, quote: string): number {
  for (let i = at + 1; i < text.length; i += 1) {
    if (text[i] !== quote) continue;
    if (text[i + 1] === quote) i += 1;
    else return i + 1;
  }
  return text.length;
}

const nextSolid = (text: string, at: number): number => {
  let i = at;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
};

/** Reads a reference at `at`: a cell or a range of two cells. Returns its end and cells, or null. */
function readRefAt(text: string, at: number): { end: number; first: CellRef; last?: CellRef } | null {
  const word = WORD.exec(text.slice(at))?.[0];
  const first = word ? readCell(word) : null;
  if (!word || !first) return null;
  const end = at + word.length;
  if (text[end] === ':') {
    const second = WORD.exec(text.slice(end + 1))?.[0];
    const last = second ? readCell(second) : null;
    if (second && last) return { end: end + 1 + second.length, first, last };
  }
  if (text[end] === '(') return null;
  return { end, first };
}

/** One token a reader found at a place: its kind, where it ends, and the reference's parts. */
type Piece = { kind: TokenKind; end: number; extra?: Partial<Token> };
type Reader = (text: string, i: number, separator: string) => Piece | null;

const refPiece = (ref: { end: number; first: CellRef; last?: CellRef }, sheet?: string): Piece => ({
  kind: 'ref',
  end: ref.end,
  extra: { ...(sheet !== undefined ? { sheet } : {}), first: ref.first, ...(ref.last ? { last: ref.last } : {}) },
});

const readSpace: Reader = (text, i) => {
  let j = i;
  while (j < text.length && /\s/.test(text[j]!)) j += 1;
  return j > i ? { kind: 'space', end: j } : null;
};

const readString: Reader = (text, i) => (text[i] === '"' ? { kind: 'string', end: quotedEnd(text, i, '"') } : null);

/** 'Quoted name'!A1, or a quoted run that names no reference. */
const readQuoted: Reader = (text, i) => {
  if (text[i] !== "'") return null;
  const end = quotedEnd(text, i, "'");
  const ref = text[end] === '!' ? readRefAt(text, end + 1) : null;
  return ref ? refPiece(ref, text.slice(i + 1, end - 1).replace(/''/g, "'")) : { kind: 'other', end };
};

const readError: Reader = (text, i) => {
  const m = text[i] === '#' ? ERRORS.exec(text.slice(i)) : null;
  return m ? { kind: 'error', end: i + m[0].length } : null;
};

const readNumber: Reader = (text, i) => {
  const ch = text[i]!;
  if (!/\d/.test(ch) && !(ch === '.' && /\d/.test(text[i + 1] ?? ''))) return null;
  return { kind: 'number', end: i + NUMBER.exec(text.slice(i))![0].length };
};

/** A word: Table!A1, a function before "(", Table[Column], a cell or range, TRUE or FALSE, or a name. */
const readWord: Reader = (text, i) => {
  const word = WORD.exec(text.slice(i))?.[0];
  if (!word) return null;
  const end = i + word.length;
  const qualified = text[end] === '!' ? readRefAt(text, end + 1) : null;
  if (qualified) return refPiece(qualified, word);
  if (text[nextSolid(text, end)] === '(') return { kind: 'function', end };
  if (text[end] === '[') return { kind: 'struct', end: bracketEnd(text, end) };
  const ref = readRefAt(text, i);
  if (ref) return refPiece(ref);
  return { kind: /^(TRUE|FALSE)$/i.test(word) ? 'bool' : 'name', end };
};

const readMark: Reader = (text, i, separator) => {
  const ch = text[i]!;
  if (ch === '[') return { kind: 'struct', end: bracketEnd(text, i) };
  if (ch === '(') return { kind: 'open', end: i + 1 };
  if (ch === ')') return { kind: 'close', end: i + 1 };
  if (ch === '{' || ch === '}') return { kind: 'brace', end: i + 1 };
  if (ch === separator) return { kind: 'sep', end: i + 1 };
  const op = OPERATORS.find((o) => text.startsWith(o, i));
  return { kind: op ? 'op' : 'other', end: i + (op?.length ?? 1) };
};

const READERS: readonly Reader[] = [readSpace, readString, readQuoted, readError, readNumber, readWord, readMark];

/** Splits formula text into tokens that cover it exactly, never failing. */
export function scanFormula(text: string, options: ScanOptions = {}): Token[] {
  const separator = options.separator ?? formulaSeparator();
  const tokens: Token[] = text.startsWith('=') ? [{ kind: 'equals', start: 0, end: 1, text: '=' }] : [];
  let i = tokens.length;
  while (i < text.length) {
    let piece: Piece | null = null;
    for (const read of READERS) if ((piece = read(text, i, separator))) break;
    const { kind, end, extra } = piece!;
    tokens.push({ kind, start: i, end, text: text.slice(i, end), ...extra });
    i = end;
  }
  return tokens;
}

/** The last token before `at` that is not space, or undefined. */
export function solidBefore(tokens: readonly Token[], at: number): Token | undefined {
  let found: Token | undefined;
  for (const token of tokens) {
    if (token.end > at) break;
    if (token.kind !== 'space') found = token;
  }
  return found;
}

/** The bracket that matches the one at `at` (either side of it), or null. */
export function matchingBracket(tokens: readonly Token[], at: number): [number, number] | null {
  const brackets = tokens.filter((t) => t.kind === 'open' || t.kind === 'close');
  const here = brackets.find((t) => t.start === at) ?? brackets.find((t) => t.end === at);
  if (!here) return null;
  const forward = here.kind === 'open';
  const list = forward ? brackets : [...brackets].reverse();
  let depth = 0;
  for (const t of list.slice(list.indexOf(here))) {
    depth += t.kind === here.kind ? 1 : -1;
    if (depth === 0) return forward ? [here.start, t.start] : [t.start, here.start];
  }
  return null;
}

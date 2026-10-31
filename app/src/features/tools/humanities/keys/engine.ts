// Identification keys from a character table. The dichotomous key picks, at each couplet, the character that best
// splits the taxa left: the largest information gain, with ties going to fewer missing values. The multi-access key
// filters by any answers, and the runner walks the dichotomous key. A taxon whose state is missing, or covers both
// sides of a split, goes down both leads, as printed keys do. Errors are codes under kitHumanities.keys.errors.

export type Cell =
  { kind: 'missing' } | { kind: 'states'; states: readonly string[] } | { kind: 'range'; low: number; high: number };

export interface Character {
  name: string;
  numeric: boolean;
  /** The states seen in the column, in the order they first appear; empty for a numeric character. */
  states: readonly string[];
}

export interface Matrix {
  characters: readonly Character[];
  taxa: readonly string[];
  /** cells[taxon][character] */
  cells: readonly (readonly Cell[])[];
}

export const MAX_TAXA = 500;
export const MAX_CHARACTERS = 100;

const MISSING = new Set(['', '?', '-', 'na', 'n/a']);

function splitLine(line: string): string[] {
  const separator = line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ',';
  return line.split(separator).map((cell) => cell.trim());
}

function numberCell(text: string): { low: number; high: number } | null {
  const match = /^(-?\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?))?$/.exec(text.replace(/−/g, '-'));
  if (!match) return null;
  const a = Number(match[1]);
  const b = match[2] === undefined ? a : Number(match[2]);
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

/**
 * Reads a table: a header line (a first column name, then one name for each character) and one line for each taxon.
 * Cells are split by tabs, semicolons, or commas. A cell of ?, -, or nothing is missing; a/b lists two states (a
 * polymorphic taxon). A column of numbers is numeric when it has a range such as 3-5 or more than
 * two values; a column of just 0 and 1 is binary.
 */
export function parseMatrix(text: string): Matrix {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length < 2) throw new Error('empty');
  const header = splitLine(lines[0]!);
  const names = header.slice(1);
  if (names.length === 0) throw new Error('noCharacters');
  if (names.length > MAX_CHARACTERS) throw new Error('tooMany');
  const rows = lines.slice(1).map(splitLine);
  if (rows.length > MAX_TAXA) throw new Error('tooMany');
  const taxa = rows.map((row) => row[0] ?? '');
  if (taxa.some((name) => name === '')) throw new Error('unnamed');
  if (new Set(taxa).size !== taxa.length) throw new Error('duplicate');
  if (rows.some((row) => row.length > header.length)) throw new Error('width');

  const raw = (row: number, column: number) => rows[row]![column + 1] ?? '';
  const characters: Character[] = names.map((name, column) => {
    const present = rows.map((_, row) => raw(row, column)).filter((cell) => !MISSING.has(cell.toLowerCase()));
    // Two numbers such as 0 and 1 are states (a binary character); a range or a third number makes it numeric.
    const numbers = present.map(numberCell);
    const distinct = new Set(present);
    const numeric =
      present.length > 0 &&
      numbers.every((cell) => cell !== null) &&
      (distinct.size > 2 || numbers.some((cell) => cell!.low !== cell!.high));
    const states: string[] = [];
    if (!numeric)
      for (const cell of present)
        for (const state of cell.split('/').map((part) => part.trim()))
          if (state !== '' && !states.includes(state)) states.push(state);
    return { name: name === '' ? `#${column + 1}` : name, numeric, states };
  });
  const cells = rows.map((_, row) =>
    characters.map((character, column): Cell => {
      const cell = raw(row, column);
      if (MISSING.has(cell.toLowerCase())) return { kind: 'missing' };
      if (character.numeric) return { kind: 'range', ...numberCell(cell)! };
      const states = cell
        .split('/')
        .map((part) => part.trim())
        .filter((part) => part !== '');
      return states.length === 0 ? { kind: 'missing' } : { kind: 'states', states };
    }),
  );
  return { characters, taxa, cells };
}

/** One side of a couplet: the states it takes, or a numeric bound. */
export type Lead =
  { kind: 'states'; states: readonly string[] } | { kind: 'atMost'; value: number } | { kind: 'above'; value: number };

export interface Split {
  character: number;
  leads: [Lead, Lead];
  /** The taxa down each lead (a taxon can be in both). */
  sides: [number[], number[]];
  /** Bits of information the split gives about which taxon it is. */
  gain: number;
  missing: number;
}

export type KeyNode =
  | { kind: 'couplet'; number: number; split: Split; taxa: number[]; next: [KeyNode, KeyNode] }
  | { kind: 'end'; taxa: number[] };

export type Couplet = Extract<KeyNode, { kind: 'couplet' }>;

/** Whether a taxon goes down a lead. Missing goes down both. */
export function follows(cell: Cell, lead: Lead): boolean {
  if (cell.kind === 'missing') return true;
  if (lead.kind === 'states') return cell.kind === 'states' && cell.states.some((state) => lead.states.includes(state));
  if (cell.kind !== 'range') return true;
  return lead.kind === 'atMost' ? cell.low <= lead.value : cell.high > lead.value;
}

const log2 = (n: number) => (n > 0 ? Math.log2(n) : 0);

/** Bits gained: log2 of the taxa before, less the log2 of each side weighted by the side's share. */
export function informationGain(before: number, left: number, right: number): number {
  const total = left + right;
  return log2(before) - (left / total) * log2(left) - (right / total) * log2(right);
}

function candidates(matrix: Matrix, character: number, taxa: readonly number[]): [Lead, Lead][] {
  const info = matrix.characters[character]!;
  if (info.numeric) {
    const ends = new Set<number>();
    for (const taxon of taxa) {
      const cell = matrix.cells[taxon]![character]!;
      if (cell.kind === 'range') ends.add(cell.low).add(cell.high);
    }
    const sorted = [...ends].sort((a, b) => a - b);
    return sorted.slice(0, -1).map((value, index): [Lead, Lead] => {
      const cut = (value + sorted[index + 1]!) / 2;
      return [
        { kind: 'atMost', value: cut },
        { kind: 'above', value: cut },
      ];
    });
  }
  const seen = info.states.filter((state) =>
    taxa.some((taxon) => {
      const cell = matrix.cells[taxon]![character]!;
      return cell.kind === 'states' && cell.states.includes(state);
    }),
  );
  if (seen.length < 2) return [];
  if (seen.length === 2)
    return [
      [
        { kind: 'states', states: [seen[0]!] },
        { kind: 'states', states: [seen[1]!] },
      ],
    ];
  return seen.map((state): [Lead, Lead] => [
    { kind: 'states', states: [state] },
    { kind: 'states', states: seen.filter((other) => other !== state) },
  ]);
}

/** The split of these taxa with the largest information gain, or null when no character separates any of them. */
export function bestSplit(matrix: Matrix, taxa: readonly number[]): Split | null {
  let best: Split | null = null;
  matrix.characters.forEach((_, character) => {
    const missing = taxa.filter((taxon) => matrix.cells[taxon]![character]!.kind === 'missing').length;
    for (const leads of candidates(matrix, character, taxa)) {
      const sides: [number[], number[]] = [
        taxa.filter((taxon) => follows(matrix.cells[taxon]![character]!, leads[0])),
        taxa.filter((taxon) => follows(matrix.cells[taxon]![character]!, leads[1])),
      ];
      // A split helps only when each side leaves out at least one taxon.
      if (sides.some((side) => side.length === 0 || side.length === taxa.length)) continue;
      const gain = informationGain(taxa.length, sides[0].length, sides[1].length);
      const current: Split | null = best;
      const better =
        current === null ||
        gain > current.gain + 1e-12 ||
        (Math.abs(gain - current.gain) <= 1e-12 && missing < current.missing);
      if (better) best = { character, leads, sides, gain, missing };
    }
  });
  return best;
}

export interface DichotomousKey {
  root: KeyNode;
  couplets: number;
  /** The most couplets on any path from the first couplet to an end. */
  depth: number;
  /** Groups of taxa the characters cannot tell apart. */
  inseparable: number[][];
}

/** Builds the key, numbering couplets in the order they are printed (depth first, the first lead first). */
export function buildKey(matrix: Matrix): DichotomousKey {
  if (matrix.taxa.length === 0) throw new Error('empty');
  let count = 0;
  let depth = 0;
  const inseparable: number[][] = [];
  // Each side of a split is strictly smaller than the set it came from, so the key always ends.
  const grow = (taxa: number[], level: number): KeyNode => {
    depth = Math.max(depth, level);
    const split = taxa.length > 1 ? bestSplit(matrix, taxa) : null;
    if (!split) {
      if (taxa.length > 1 && !inseparable.some((group) => group.join() === taxa.join())) inseparable.push(taxa);
      return { kind: 'end', taxa };
    }
    const number = ++count;
    const first = grow(split.sides[0], level + 1);
    const second = grow(split.sides[1], level + 1);
    return { kind: 'couplet', number, split, taxa, next: [first, second] };
  };
  const root = grow(
    matrix.taxa.map((_, index) => index),
    0,
  );
  return { root, couplets: count, depth, inseparable };
}

/** The couplets in printed order. */
export function couplets(node: KeyNode): Couplet[] {
  if (node.kind === 'end') return [];
  return [node, ...couplets(node.next[0]), ...couplets(node.next[1])];
}

/** A multi-access answer: a state, or a measured number. */
export type Answer = { kind: 'state'; state: string } | { kind: 'value'; value: number };

/** Whether a taxon is still possible with this answer. A missing cell never rules a taxon out. */
export function fits(cell: Cell, answer: Answer): boolean {
  if (cell.kind === 'missing') return true;
  if (answer.kind === 'state') return cell.kind === 'states' && cell.states.includes(answer.state);
  return cell.kind === 'range' && answer.value >= cell.low && answer.value <= cell.high;
}

/** The taxa that fit every answer, by character index. */
export function remaining(matrix: Matrix, answers: ReadonlyMap<number, Answer>): number[] {
  return matrix.taxa
    .map((_, index) => index)
    .filter((taxon) => [...answers].every(([character, answer]) => fits(matrix.cells[taxon]![character]!, answer)));
}

/** The node reached by taking these leads (0 for the first, 1 for the second) from the first couplet. */
export function walk(root: KeyNode, path: readonly (0 | 1)[]): KeyNode {
  let node = root;
  for (const step of path) {
    if (node.kind === 'end') throw new Error('pastEnd');
    node = node.next[step];
  }
  return node;
}

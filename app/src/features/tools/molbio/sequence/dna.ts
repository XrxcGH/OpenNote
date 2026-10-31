// Nucleotide sequences: reading FASTA or raw text, IUPAC ambiguity sets, complements, translation with any listed
// genetic code, and numbered display. The other tools of the kit build on these. Pure; no RegExp is made from what
// the student typed: motifs compile to per-position base sets.
import { fail } from '../shared';
import type { GeneticCode } from './codes';

export interface SeqRecord {
  name: string;
  seq: string;
}

/** Base sets as bit masks: A 1, C 2, G 4, T 8, so an ambiguity code is the union of its bases. */
export const IUPAC: { readonly [code: string]: number } = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
  R: 5,
  Y: 10,
  S: 6,
  W: 9,
  K: 12,
  M: 3,
  B: 14,
  D: 13,
  H: 11,
  V: 7,
  N: 15,
};

const PAIR: { readonly [code: string]: string } = {
  A: 'T',
  T: 'A',
  U: 'A',
  C: 'G',
  G: 'C',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
  '-': '-',
};

/** The records of FASTA text; text with no header line is one unnamed record. Line breaks inside are dropped. */
export function readFasta(text: string): SeqRecord[] {
  const records: SeqRecord[] = [];
  let current: SeqRecord | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('>') || line.startsWith(';')) {
      if (line.startsWith(';')) continue;
      current = { name: line.slice(1).trim(), seq: '' };
      records.push(current);
      continue;
    }
    if (line === '') continue;
    if (!current) {
      current = { name: '', seq: '' };
      records.push(current);
    }
    current.seq += line;
  }
  return records;
}

export interface Cleaned {
  name: string;
  seq: string;
  /** Spaces, digits, and line breaks dropped, as in pasted GenBank text. */
  removed: number;
  rna: boolean;
}

/**
 * The first record's bases in capitals with numbers and spaces dropped. Throws a message naming the first character
 * that is not a nucleotide or IUPAC code (gaps are allowed only when `gaps` is set).
 */
export function cleanDna(text: string, gaps = false): Cleaned {
  const records = readFasta(text);
  const first = records[0];
  if (!first) return fail('e.noSequence');
  let seq = '';
  let removed = 0;
  for (const ch of first.seq) {
    if (/[\s\d]/.test(ch)) {
      removed += 1;
      continue;
    }
    const up = ch.toUpperCase();
    if (IUPAC[up] === undefined && !(gaps && (up === '-' || up === '.'))) {
      return fail('e.badBase', { char: ch, position: String(seq.length + 1) });
    }
    seq += up === '.' ? '-' : up;
  }
  if (seq === '') return fail('e.noSequence');
  const rna = seq.includes('U') && !seq.includes('T');
  return { name: first.name, seq: seq.replace(/U/g, 'T'), removed, rna };
}

export const complement = (seq: string): string => [...seq].map((b) => PAIR[b] ?? 'N').join('');
export const reverse = (seq: string): string => [...seq].reverse().join('');
export const revComp = (seq: string): string => reverse(complement(seq));
export const toRna = (seq: string): string => seq.replace(/T/g, 'U');

const ORDER: { readonly [base: string]: number } = { T: 0, C: 1, A: 2, G: 3 };
const BASES = ['A', 'C', 'G', 'T'];

/** The plain bases an IUPAC code stands for. */
export const expand = (code: string): string[] => BASES.filter((b) => ((IUPAC[code] ?? 0) & (IUPAC[b] ?? 0)) !== 0);

/** The amino acid a codon codes for; an ambiguous codon gives its amino acid when every reading agrees, else X. */
export function codonAa(codon: string, code: GeneticCode): string {
  if (codon.length !== 3) return '';
  const [a, b, c] = [...codon].map(expand) as [string[], string[], string[]];
  let found = '';
  for (const x of a)
    for (const y of b)
      for (const z of c) {
        const aa = code.aas[16 * ORDER[x]! + 4 * ORDER[y]! + ORDER[z]!]!;
        if (found === '') found = aa;
        else if (found !== aa) return 'X';
      }
  return found || 'X';
}

/** Translates from `offset` (0, 1, or 2) to the end in whole codons, stops shown as *. */
export function translate(seq: string, code: GeneticCode, offset = 0): string {
  let out = '';
  for (let i = offset; i + 3 <= seq.length; i += 3) out += codonAa(seq.slice(i, i + 3), code);
  return out;
}

/** Whether every base of `seq` from `at` lies inside the matching set of the compiled motif. */
export function matchesAt(seq: string, at: number, motif: readonly number[]): boolean {
  for (let k = 0; k < motif.length; k++) {
    const base = IUPAC[seq[at + k] ?? ''] ?? 0;
    if (base === 0 || (base & ~motif[k]!) !== 0) return false;
  }
  return true;
}

/** A motif in IUPAC letters as base sets; throws on a letter that is not a nucleotide code. */
export function compileMotif(text: string): number[] {
  const letters = text.replace(/\s/g, '').toUpperCase();
  if (letters === '') return fail('e.noMotif');
  return [...letters].map((ch, i) => IUPAC[ch] ?? fail('e.badMotif', { char: ch, position: String(i + 1) }));
}

/** 0-based starts of every match of the motif on the given strand text. */
export function findAll(seq: string, motif: readonly number[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i + motif.length <= seq.length; i++) if (matchesAt(seq, i, motif)) hits.push(i);
  return hits;
}

/** The sequence in rows of 60 with groups of 10 and the position of each row's first base. */
export function numbered(seq: string, perLine = 60): string {
  const width = String(seq.length).length;
  const rows: string[] = [];
  for (let i = 0; i < seq.length; i += perLine) {
    const chunk = seq.slice(i, i + perLine);
    const groups = chunk.match(/.{1,10}/g) ?? [];
    rows.push(`${String(i + 1).padStart(width)} ${groups.join(' ')}`);
  }
  return rows.join('\n');
}

/** Fraction of G and C among the unambiguous bases, or NaN when there are none. */
export function gcFraction(seq: string): number {
  let gc = 0;
  let all = 0;
  for (const b of seq) {
    if (b === 'G' || b === 'C') gc += 1;
    if (b === 'A' || b === 'C' || b === 'G' || b === 'T') all += 1;
  }
  return all === 0 ? NaN : gc / all;
}

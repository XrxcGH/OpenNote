// The effect on the protein of a coding-sequence change written in HGVS c. notation, such as c.4G>T, c.5del,
// c.5_7del, c.5_6insTG, or c.5dup. The classes are silent, missense, nonsense, start loss, stop loss, in-frame
// change, and frameshift. The protein change is in HGVS p. notation; c.1 is the first base of the coding sequence.
import { fail } from '../shared';
import type { MolKey } from '../shared';
import { THREE } from './codes';
import type { GeneticCode } from './codes';
import { codonAa } from './dna';

export type MutationClass =
  | 'silent'
  | 'missense'
  | 'nonsense'
  | 'startLoss'
  | 'stopLoss'
  | 'frameshift'
  | 'inframeDel'
  | 'inframeIns'
  | 'inframeDelins';

export interface Change {
  kind: 'sub' | 'del' | 'ins' | 'dup';
  from: number;
  to: number;
  ref?: string;
  alt: string;
}

export interface MutationResult {
  change: Change;
  mutated: string;
  cls: MutationClass;
  protein: string;
  refProtein: string;
  mutProtein: string;
  /** For a substitution: the codon number and the codon before and after. */
  codon?: { number: number; before: string; after: string };
}

const SUB = /^c\.(\d+)([ACGTU])>([ACGTU])$/i;
const DEL = /^c\.(\d+)(?:_(\d+))?del([ACGTU]*)$/i;
const INS = /^c\.(\d+)_(\d+)ins([ACGTU]+)$/i;
const DUP = /^c\.(\d+)(?:_(\d+))?dup([ACGTU]*)$/i;

/** Reads c. notation into 1-based positions; throws a message for anything else. */
export function parseChange(text: string): Change {
  const s = text.replace(/\s/g, '');
  const up = (v: string | undefined) => (v ?? '').toUpperCase().replace(/U/g, 'T');
  let m = SUB.exec(s);
  if (m) return { kind: 'sub', from: Number(m[1]), to: Number(m[1]), ref: up(m[2]), alt: up(m[3]) };
  m = DEL.exec(s);
  if (m) return { kind: 'del', from: Number(m[1]), to: Number(m[2] ?? m[1]), ref: up(m[3]) || undefined, alt: '' };
  m = INS.exec(s);
  if (m) {
    if (Number(m[2]) !== Number(m[1]) + 1) return fail('sequence.e.insAdjacent');
    return { kind: 'ins', from: Number(m[1]), to: Number(m[2]), alt: up(m[3]) };
  }
  m = DUP.exec(s);
  if (m) return { kind: 'dup', from: Number(m[1]), to: Number(m[2] ?? m[1]), alt: up(m[3]) };
  return fail('sequence.e.notation');
}

/** The coding sequence with the change made; checks the stated reference bases against the sequence. */
export function applyChange(seq: string, change: Change): string {
  const { from, to } = change;
  if (from < 1 || to > seq.length || to < from) return fail('sequence.e.outside', { length: String(seq.length) });
  const span = seq.slice(from - 1, to);
  if (change.ref && change.ref !== span) return fail('sequence.e.refMismatch', { stated: change.ref, found: span });
  switch (change.kind) {
    case 'sub':
      return seq.slice(0, from - 1) + change.alt + seq.slice(to);
    case 'del':
      return seq.slice(0, from - 1) + seq.slice(to);
    case 'ins':
      return seq.slice(0, from) + change.alt + seq.slice(from);
    case 'dup':
      if (change.alt && change.alt !== span) return fail('sequence.e.refMismatch', { stated: change.alt, found: span });
      return seq.slice(0, to) + span + seq.slice(to);
  }
}

/** Translation from the first base up to and including the first stop (or the last whole codon). */
function protein(seq: string, code: GeneticCode): string {
  let out = '';
  for (let i = 0; i + 3 <= seq.length; i += 3) {
    const aa = codonAa(seq.slice(i, i + 3), code);
    out += aa;
    if (aa === '*') break;
  }
  return out;
}

const three = (aa: string | undefined): string => THREE[aa ?? 'X'] ?? 'Xaa';

function frameshift(ref: string, mut: string): string {
  let i = 0;
  while (i < ref.length && i < mut.length && ref[i] === mut[i]) i++;
  if (i >= ref.length) return 'p.(=)';
  if (mut[i] === '*') return `p.${three(ref[i])}${i + 1}Ter`;
  const stop = mut.indexOf('*', i);
  const ter = stop === -1 ? '?' : String(stop - i + 1);
  return `p.${three(ref[i])}${i + 1}${three(mut[i])}fsTer${ter}`;
}

function inframe(ref: string, mut: string): { cls: MutationClass; text: string } {
  let a = 0;
  while (a < ref.length && a < mut.length && ref[a] === mut[a]) a++;
  let b = 0;
  while (b < Math.min(ref.length, mut.length) - a && ref[ref.length - 1 - b] === mut[mut.length - 1 - b]) b++;
  const gone = ref.slice(a, ref.length - b);
  const added = mut.slice(a, mut.length - b);
  const span = (from: number, to: number) =>
    from === to ? `${three(ref[from])}${from + 1}` : `${three(ref[from])}${from + 1}_${three(ref[to])}${to + 1}`;
  const addedText = [...added].map(three).join('');
  if (gone === '' && added === '') return { cls: 'silent', text: 'p.(=)' };
  if (added === '') return { cls: 'inframeDel', text: `p.${span(a, a + gone.length - 1)}del` };
  if (gone === '') {
    const before = ref.slice(a - added.length, a);
    if (before === added) return { cls: 'inframeIns', text: `p.${span(a - added.length, a - 1)}dup` };
    return { cls: 'inframeIns', text: `p.${span(a - 1, a)}ins${addedText}` };
  }
  return { cls: 'inframeDelins', text: `p.${span(a, a + gone.length - 1)}delins${addedText}` };
}

function substitution(seq: string, mutated: string, change: Change, code: GeneticCode) {
  const n = Math.ceil(change.from / 3);
  const before = seq.slice(3 * (n - 1), 3 * n);
  const after = mutated.slice(3 * (n - 1), 3 * n);
  const x = codonAa(before, code);
  const y = codonAa(after, code);
  let cls: MutationClass;
  let text: string;
  if (x === y) [cls, text] = ['silent', `p.${three(x)}${n}=`];
  else if (n === 1 && x === 'M') [cls, text] = ['startLoss', 'p.Met1?'];
  else if (y === '*') [cls, text] = ['nonsense', `p.${three(x)}${n}Ter`];
  else if (x === '*') {
    const rest = protein(mutated.slice(3 * n), code);
    [cls, text] = ['stopLoss', `p.Ter${n}${three(y)}extTer${rest.endsWith('*') ? rest.length : '?'}`];
  } else [cls, text] = ['missense', `p.${three(x)}${n}${three(y)}`];
  return { cls, text, codon: { number: n, before, after } };
}

export function mutationEffect(seq: string, notation: string, code: GeneticCode): MutationResult {
  const change = parseChange(notation);
  const mutated = applyChange(seq, change);
  const refProtein = protein(seq, code);
  const mutProtein = protein(mutated, code);
  if (change.kind === 'sub') {
    const sub = substitution(seq, mutated, change, code);
    return { change, mutated, cls: sub.cls, protein: sub.text, refProtein, mutProtein, codon: sub.codon };
  }
  const delta = mutated.length - seq.length;
  if (change.from <= 3 && refProtein[0] === 'M' && mutProtein[0] !== 'M') {
    return { change, mutated, cls: 'startLoss', protein: 'p.Met1?', refProtein, mutProtein };
  }
  if (delta % 3 !== 0) {
    return { change, mutated, cls: 'frameshift', protein: frameshift(refProtein, mutProtein), refProtein, mutProtein };
  }
  const result = inframe(refProtein, mutProtein);
  return { change, mutated, cls: result.cls, protein: result.text, refProtein, mutProtein };
}

export const CLASS_WORD: Record<MutationClass, MolKey> = {
  silent: 'sequence.w.silent',
  missense: 'sequence.w.missense',
  nonsense: 'sequence.w.nonsense',
  startLoss: 'sequence.w.startLoss',
  stopLoss: 'sequence.w.stopLoss',
  frameshift: 'sequence.w.frameshift',
  inframeDel: 'sequence.w.inframeDel',
  inframeIns: 'sequence.w.inframeIns',
  inframeDelins: 'sequence.w.inframeDelins',
};

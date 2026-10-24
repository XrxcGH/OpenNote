// The sequence tool's calculations: composition, translation in every frame, open reading frames, GC windows,
// motif and k-mer searches, and CRISPR guides. Mutation effects live in mutation.ts. Positions are 1-based on the
// plus strand, as a student reads them; ORFs and guides on the minus strand are given in plus-strand positions.
import { fail } from '../shared';
import type { GeneticCode } from './codes';
import { codonAa, compileMotif, findAll, gcFraction, revComp, translate } from './dna';

export interface Composition {
  length: number;
  counts: { A: number; C: number; G: number; T: number; other: number };
  gc: number;
}

export function composition(seq: string): Composition {
  const counts = { A: 0, C: 0, G: 0, T: 0, other: 0 };
  for (const b of seq) {
    if (b === 'A' || b === 'C' || b === 'G' || b === 'T') counts[b] += 1;
    else counts.other += 1;
  }
  return { length: seq.length, counts, gc: gcFraction(seq) };
}

export interface FrameText {
  /** +1, +2, +3, -1, -2, -3. */
  frame: number;
  /** The plus-strand position of the frame's first base. */
  from: number;
  protein: string;
}

/** Translations in frames +1..+3 and, when `six`, -1..-3 (read on the reverse complement from the last base). */
export function frames(seq: string, code: GeneticCode, count: 1 | 3 | 6): FrameText[] {
  const out: FrameText[] = [];
  const rc = revComp(seq);
  for (let f = 0; f < Math.min(count, 3); f++)
    out.push({ frame: f + 1, from: f + 1, protein: translate(seq, code, f) });
  if (count === 6) {
    for (let f = 0; f < 3; f++) out.push({ frame: -(f + 1), from: seq.length - f, protein: translate(rc, code, f) });
  }
  return out;
}

export interface Orf {
  strand: '+' | '-';
  frame: number;
  /** Plus-strand position of the start codon's first base. */
  start: number;
  /** Plus-strand position of the stop codon's last base. */
  end: number;
  codons: number;
  protein: string;
  nested: boolean;
}

export interface OrfOptions {
  minCodons: number;
  /** 'atg' for ATG only, 'alt' for every start the genetic code allows. */
  starts: 'atg' | 'alt';
  nested: boolean;
  strands: 'both' | 'plus';
}

function scanFrame(strandSeq: string, offset: number, code: GeneticCode, options: OrfOptions): Orf[] {
  const found: Orf[] = [];
  let open: number[] = [];
  const isStart = (codon: string) => (options.starts === 'atg' ? codon === 'ATG' : code.starts.includes(codon));
  for (let i = offset; i + 3 <= strandSeq.length; i += 3) {
    const codon = strandSeq.slice(i, i + 3);
    const aa = codonAa(codon, code);
    if (aa === '*') {
      open.forEach((at, k) => {
        const codons = (i - at) / 3;
        if (codons < options.minCodons) return;
        const protein = translate(strandSeq.slice(at, i), code).replace(/^./, 'M');
        found.push({ strand: '+', frame: offset + 1, start: at + 1, end: i + 3, codons, protein, nested: k > 0 });
      });
      open = [];
    } else if (isStart(codon) && (open.length === 0 || options.nested)) {
      open.push(i);
    }
  }
  return found;
}

/** Start-to-stop open reading frames of at least `minCodons` codons before the stop. */
export function findOrfs(seq: string, code: GeneticCode, options: OrfOptions): Orf[] {
  const out: Orf[] = [];
  for (let f = 0; f < 3; f++) out.push(...scanFrame(seq, f, code, options));
  if (options.strands === 'both') {
    const rc = revComp(seq);
    const n = seq.length;
    for (let f = 0; f < 3; f++) {
      for (const orf of scanFrame(rc, f, code, options)) {
        out.push({ ...orf, strand: '-', frame: f + 1, start: n - orf.start + 1, end: n - orf.end + 1 });
      }
    }
  }
  return out.sort((a, b) => b.codons - a.codons || Math.min(a.start, a.end) - Math.min(b.start, b.end));
}

export interface GcWindows {
  mids: number[];
  gc: number[];
  skew: number[];
  cpg: number;
}

/** GC percentage and GC skew (G - C)/(G + C) in sliding windows, by running sums; CpG observed over expected. */
export function gcWindows(seq: string, window: number, step: number): GcWindows {
  if (window > seq.length) return fail('sequence.e.windowLong', { window: String(window), length: String(seq.length) });
  const g = [0];
  const c = [0];
  const acgt = [0];
  for (const b of seq) {
    g.push(g.at(-1)! + (b === 'G' ? 1 : 0));
    c.push(c.at(-1)! + (b === 'C' ? 1 : 0));
    acgt.push(acgt.at(-1)! + ('ACGT'.includes(b) ? 1 : 0));
  }
  const out: GcWindows = { mids: [], gc: [], skew: [], cpg: cpgRatio(seq) };
  for (let i = 0; i + window <= seq.length; i += step) {
    const gs = g[i + window]! - g[i]!;
    const cs = c[i + window]! - c[i]!;
    const all = acgt[i + window]! - acgt[i]!;
    out.mids.push(i + (window + 1) / 2);
    out.gc.push(all === 0 ? NaN : ((gs + cs) / all) * 100);
    out.skew.push(gs + cs === 0 ? 0 : (gs - cs) / (gs + cs));
  }
  return out;
}

/** CpG observed / expected = (CpG count x length) / (C count x G count); NaN without both C and G. */
export function cpgRatio(seq: string): number {
  let cpg = 0;
  let cs = 0;
  let gs = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === 'C') cs += 1;
    if (seq[i] === 'G') gs += 1;
    if (seq[i] === 'C' && seq[i + 1] === 'G') cpg += 1;
  }
  return cs === 0 || gs === 0 ? NaN : (cpg * seq.length) / (cs * gs);
}

export interface Hit {
  strand: '+' | '-' | 'both';
  start: number;
  end: number;
  text: string;
}

/** Every site of an IUPAC motif, on the plus strand and, when `both`, the minus strand (as plus positions). */
export function motifHits(seq: string, motifText: string, both: boolean): { hits: Hit[]; palindrome: boolean } {
  const motif = compileMotif(motifText);
  if (motif.length > seq.length) return fail('sequence.e.motifLong');
  const letters = motifText.replace(/\s/g, '').toUpperCase();
  const rcMotif = compileMotif(revComp(letters.replace(/U/g, 'T')));
  const palindrome = rcMotif.every((mask, i) => mask === motif[i]);
  const span = motif.length;
  const hits: Hit[] = findAll(seq, motif).map((i) => ({
    strand: both && palindrome ? 'both' : '+',
    start: i + 1,
    end: i + span,
    text: seq.slice(i, i + span),
  }));
  if (both && !palindrome) {
    for (const i of findAll(seq, rcMotif)) {
      hits.push({ strand: '-', start: i + span, end: i + 1, text: revComp(seq.slice(i, i + span)) });
    }
  }
  return { hits: hits.sort((a, b) => Math.min(a.start, a.end) - Math.min(b.start, b.end)), palindrome };
}

/** Counts of every k-mer of plain bases, most common first, then in alphabetical order. */
export function kmers(seq: string, k: number): [string, number][] {
  const counts = new Map<string, number>();
  for (let i = 0; i + k <= seq.length; i++) {
    const word = seq.slice(i, i + k);
    if (/^[ACGT]+$/.test(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

export interface Guide {
  strand: '+' | '-';
  /** Plus-strand span of the spacer, first and last base in reading order of its own strand. */
  start: number;
  end: number;
  spacer: string;
  pam: string;
  gc: number;
  /** The plus-strand base after which a 3' PAM nuclease cuts, 3 bases from the PAM; null for a 5' PAM. */
  cut: number | null;
  polyT: boolean;
}

export interface GuideOptions {
  pam: string;
  length: number;
  /** '3' when the PAM follows the spacer (Cas9), '5' when it comes before it (Cas12a). */
  side: '3' | '5';
}

function guidesOn(strandSeq: string, options: GuideOptions): Omit<Guide, 'strand'>[] {
  const pam = compileMotif(options.pam);
  const out: Omit<Guide, 'strand'>[] = [];
  for (const p of findAll(strandSeq, pam)) {
    const from = options.side === '3' ? p - options.length : p + pam.length;
    if (from < 0 || from + options.length > strandSeq.length) continue;
    const spacer = strandSeq.slice(from, from + options.length);
    if (!/^[ACGT]+$/.test(spacer)) continue;
    out.push({
      start: from + 1,
      end: from + options.length,
      spacer,
      pam: strandSeq.slice(p, p + pam.length),
      gc: gcFraction(spacer),
      cut: options.side === '3' ? p - 3 : null,
      polyT: spacer.includes('TTTT'),
    });
  }
  return out;
}

/** Spacers next to every PAM on both strands. No off-target search is made. */
export function crisprGuides(seq: string, options: GuideOptions): Guide[] {
  const n = seq.length;
  const plus = guidesOn(seq, options).map((g) => ({ ...g, strand: '+' as const }));
  const minus = guidesOn(revComp(seq), options).map((g) => ({
    ...g,
    strand: '-' as const,
    start: n - g.start + 1,
    end: n - g.end + 1,
    cut: g.cut === null ? null : n - g.cut,
  }));
  return [...plus, ...minus].sort((a, b) => Math.min(a.start, a.end) - Math.min(b.start, b.end));
}

import { describe, expect, it } from 'vitest';
import { KitError } from '../shared';
import { GENETIC_CODES, codeById } from './codes';
import { cleanDna, numbered, revComp, translate } from './dna';
import { composition, cpgRatio, crisprGuides, findOrfs, frames, gcWindows, kmers, motifHits } from './engine';
import { mutationEffect } from './mutation';
import { spec } from './tool';
import { runTool } from '../spec';

const standard = codeById(1)!;
const vertMito = codeById(2)!;
const EXAMPLE = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG';

const errorKey = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof KitError) return error.key;
    throw error;
  }
  return 'no error';
};

describe('DNA basics', () => {
  it('reverse-complements ATGCGTAC to GTACGCAT', () => {
    expect(revComp('ATGCGTAC')).toBe('GTACGCAT');
  });

  it('cleans FASTA, numbers, spaces and case, and reads RNA', () => {
    const cleaned = cleanDna('>seq one\n1 atgc gtac\n9 aug');
    expect(cleaned).toMatchObject({ name: 'seq one', seq: 'ATGCGTACATG', removed: 5, rna: false });
    expect(cleanDna('AUGC').rna).toBe(true);
    expect(cleanDna('AUGC').seq).toBe('ATGC');
  });

  it('names the first character that is not a base', () => {
    expect(errorKey(() => cleanDna('ACGTZ'))).toBe('e.badBase');
    expect(errorKey(() => cleanDna('  \n'))).toBe('e.noSequence');
  });

  it('counts composition and GC', () => {
    const c = composition('AAGCGN');
    expect(c.counts).toEqual({ A: 2, C: 1, G: 2, T: 0, other: 1 });
    expect(c.gc).toBeCloseTo(3 / 5, 12);
  });

  it('numbers rows of 60 in groups of 10', () => {
    const text = numbered('A'.repeat(65));
    expect(text.split('\n')).toEqual([` 1 ${Array(6).fill('A'.repeat(10)).join(' ')}`, `61 AAAAA`]);
  });
});

describe('translation', () => {
  it('translates with the standard and vertebrate mitochondrial codes', () => {
    expect(translate(EXAMPLE, standard)).toBe('MAIVMGR*KGAR*');
    expect(translate(EXAMPLE, vertMito)).toBe('MAIVMGRWKGAR*');
  });

  it('lists every code with 64 codons', () => {
    expect(GENETIC_CODES.map((code) => code.id)).toEqual([
      1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 33,
    ]);
    for (const code of GENETIC_CODES) expect(code.aas).toHaveLength(64);
  });

  it('gives an amino acid for an ambiguous codon only when every reading agrees', () => {
    expect(translate('GCN', standard)).toBe('A');
    expect(translate('ATN', standard)).toBe('X');
  });

  it('reads six frames, the minus frames from the last base', () => {
    const list = frames('ATGAAATAG', standard, 6);
    expect(list.map((f) => f.frame)).toEqual([1, 2, 3, -1, -2, -3]);
    expect(list[0]!.protein).toBe('MK*');
    expect(list[3]).toMatchObject({ from: 9, protein: 'LFH' });
  });
});

describe('open reading frames', () => {
  it('finds the ATG at 1 to the TGA ending at 24, with the M at 13 nested', () => {
    const found = findOrfs(EXAMPLE, standard, { minCodons: 3, starts: 'atg', nested: true, strands: 'plus' });
    expect(found).toEqual([
      { strand: '+', frame: 1, start: 1, end: 24, codons: 7, protein: 'MAIVMGR', nested: false, partial: false },
      { strand: '+', frame: 1, start: 13, end: 24, codons: 3, protein: 'MGR', nested: true, partial: false },
    ]);
  });

  it('keeps only the outer ORF when nested ones are not wanted, and honors the minimum', () => {
    expect(findOrfs(EXAMPLE, standard, { minCodons: 3, starts: 'atg', nested: false, strands: 'plus' })).toHaveLength(
      1,
    );
    expect(findOrfs(EXAMPLE, standard, { minCodons: 8, starts: 'atg', nested: true, strands: 'plus' })).toHaveLength(0);
  });

  it('reports an ORF that runs off the end as partial, ending on its last whole codon', () => {
    // ATG AAA CCC: three codons, no stop, so bases 1 to 9 read M K P.
    const opts = { minCodons: 2, starts: 'atg', nested: false, strands: 'plus' } as const;
    expect(findOrfs('ATGAAACCC', standard, opts)).toEqual([
      { strand: '+', frame: 1, start: 1, end: 9, codons: 3, protein: 'MKP', nested: false, partial: true },
    ]);
    // A trailing half codon is not read: ATG AAA CC ends at base 6.
    expect(findOrfs('ATGAAACC', standard, opts)).toMatchObject([{ end: 6, codons: 2, partial: true }]);
    // On the minus strand it keeps plus positions, start after end.
    expect(findOrfs(revComp('ATGAAACCC'), standard, { ...opts, strands: 'both' })).toContainEqual(
      expect.objectContaining({ strand: '-', start: 9, end: 1, codons: 3, partial: true }),
    );
  });

  it('gives minus-strand ORFs in plus positions, start after end', () => {
    const plus = 'ATGAAATAG';
    const found = findOrfs(revComp(plus), standard, { minCodons: 2, starts: 'atg', nested: false, strands: 'both' });
    expect(found).toContainEqual({
      strand: '-',
      frame: 1,
      start: 9,
      end: 1,
      codons: 2,
      protein: 'MK',
      nested: false,
      partial: false,
    });
  });
});

describe('GC windows and CpG', () => {
  it('slides windows by running sums', () => {
    const w = gcWindows('GGGGAAAACC', 4, 2);
    expect(w.gc).toEqual([100, 50, 0, 50]);
    expect(w.skew).toEqual([1, 1, 0, -1]);
    expect(w.mids).toEqual([2.5, 4.5, 6.5, 8.5]);
  });

  it('computes CpG observed over expected', () => {
    // CGCG: 2 CpG, 4 bases, 2 C, and 2 G: 2 x 4 / (2 x 2) = 2.
    expect(cpgRatio('CGCG')).toBe(2);
    expect(cpgRatio('AAAA')).toBeNaN();
  });

  it('refuses a window longer than the sequence', () => {
    expect(errorKey(() => gcWindows('ACGT', 5, 1))).toBe('sequence.e.windowLong');
  });
});

describe('motifs and k-mers', () => {
  it('finds GAATTC at 2-7 and RRYY at 3-6 on the plus strand of AGAATTCGG', () => {
    expect(motifHits('AGAATTCGG', 'GAATTC', false).hits).toEqual([{ strand: '+', start: 2, end: 7, text: 'GAATTC' }]);
    expect(motifHits('AGAATTCGG', 'RRYY', false).hits).toEqual([{ strand: '+', start: 3, end: 6, text: 'AATT' }]);
  });

  it('marks a palindromic site as on both strands and finds others on the minus strand', () => {
    const eco = motifHits('AGAATTCGG', 'GAATTC', true);
    expect(eco.palindrome).toBe(true);
    expect(eco.hits).toEqual([{ strand: 'both', start: 2, end: 7, text: 'GAATTC' }]);
    // CCG on the plus strand is CGG read on the minus strand.
    expect(motifHits('AACCGAA', 'CGG', true).hits).toEqual([{ strand: '-', start: 5, end: 3, text: 'CGG' }]);
  });

  it('refuses a motif letter that is not an IUPAC code', () => {
    expect(errorKey(() => motifHits('ACGT', 'AXG', false))).toBe('e.badMotif');
  });

  it('counts k-mers, most common first', () => {
    expect(kmers('AAAT', 2)).toEqual([
      ['AA', 2],
      ['AT', 1],
    ]);
  });
});

describe('mutation effects', () => {
  it('calls c.4G>T in ATGGCC a missense change p.Ala2Ser', () => {
    const r = mutationEffect('ATGGCC', 'c.4G>T', standard);
    expect(r.cls).toBe('missense');
    expect(r.protein).toBe('p.Ala2Ser');
    expect(r.codon).toEqual({ number: 2, before: 'GCC', after: 'TCC' });
  });

  it('calls silent, nonsense and start-loss substitutions', () => {
    expect(mutationEffect('ATGGCC', 'c.6C>T', standard)).toMatchObject({ cls: 'silent', protein: 'p.Ala2=' });
    expect(mutationEffect('ATGTGGTAA', 'c.6G>A', standard)).toMatchObject({ cls: 'nonsense', protein: 'p.Trp2Ter' });
    expect(mutationEffect('ATGGCC', 'c.1A>G', standard)).toMatchObject({ cls: 'startLoss', protein: 'p.Met1?' });
  });

  it('calls a frameshift with the new stop counted from the first changed residue', () => {
    // ATG GCC AAA TGA -> delete c.4: ATG CCA AAT GA: Met Pro Asn, no stop.
    expect(mutationEffect('ATGGCCAAATGA', 'c.4del', standard)).toMatchObject({
      cls: 'frameshift',
      protein: 'p.Ala2ProfsTer?',
    });
    // ATG GCC TAA GGG -> delete c.5: ATG GCT AAG GG: Ala2 kept, Leu3? no: GCT is Ala, AAG Lys.
    expect(mutationEffect('ATGAAGCTGATAG', 'c.4del', standard).cls).toBe('frameshift');
  });

  it('calls in-frame deletions and insertions in p. notation', () => {
    expect(mutationEffect('ATGGCCAAATGA', 'c.4_6del', standard)).toMatchObject({
      cls: 'inframeDel',
      protein: 'p.Ala2del',
    });
    expect(mutationEffect('ATGGCCAAATGA', 'c.6_7insGGG', standard)).toMatchObject({
      cls: 'inframeIns',
      protein: 'p.Ala2_Lys3insGly',
    });
    expect(mutationEffect('ATGGCCAAATGA', 'c.4_6dup', standard)).toMatchObject({
      cls: 'inframeIns',
      protein: 'p.Ala2dup',
    });
  });

  it('checks the stated reference base and the notation', () => {
    expect(errorKey(() => mutationEffect('ATGGCC', 'c.4A>T', standard))).toBe('sequence.e.refMismatch');
    expect(errorKey(() => mutationEffect('ATGGCC', 'c.9A>T', standard))).toBe('sequence.e.outside');
    expect(errorKey(() => mutationEffect('ATGGCC', '4G>T', standard))).toBe('sequence.e.notation');
    expect(errorKey(() => mutationEffect('ATGGCC', 'c.4_6insA', standard))).toBe('sequence.e.insAdjacent');
  });
});

describe('CRISPR guides', () => {
  it('finds 20-nt spacers 5′ of NGG on both strands with the Cas9 cut site', () => {
    const spacer = 'ACGTACGTACGTACGTACGA';
    const plus = crisprGuides(`${spacer}TGG`, { pam: 'NGG', length: 20, side: '3' });
    expect(plus).toEqual([{ strand: '+', start: 1, end: 20, spacer, pam: 'TGG', gc: 0.5, cut: 17, polyT: false }]);
    const minus = crisprGuides(revComp(`${spacer}TGG`), { pam: 'NGG', length: 20, side: '3' });
    expect(minus).toEqual([{ strand: '-', start: 23, end: 4, spacer, pam: 'TGG', gc: 0.5, cut: 6, polyT: false }]);
  });
});

describe('the sequence tool', () => {
  it('answers every mode on its example without an error', () => {
    for (const mode of ['basics', 'translate', 'orfs', 'gc', 'motif', 'kmers', 'mutation', 'crispr']) {
      const result = runTool(spec, { mode });
      expect(result.ok, mode).toBe(true);
    }
  });

  it('says what is wrong with a bad sequence', () => {
    expect(runTool(spec, { mode: 'basics', seq: 'ACGT!' })).toMatchObject({ ok: false, error: 'e.badBase' });
  });
});

// The NCBI genetic codes (public domain, US government): the amino acid of each codon in TCAG order (TTT, TTC,
// TTA, TTG, TCT, ... GGG) and the codons each code allows as alternative starts. Written from the NCBI genetic-code
// definitions; only the tables in use for teaching are listed.
export interface GeneticCode {
  id: number;
  /** 64 one-letter amino acids, * for stop, in TCAG order. */
  aas: string;
  starts: readonly string[];
}

export const GENETIC_CODES: readonly GeneticCode[] = [
  { id: 1, aas: 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['TTG', 'CTG', 'ATG'] },
  {
    id: 2,
    aas: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG',
    starts: ['ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  { id: 3, aas: 'FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['ATA', 'ATG', 'GTG'] },
  {
    id: 4,
    aas: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['TTA', 'TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 5,
    aas: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSSSVVVVAAAADDEEGGGG',
    starts: ['TTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  { id: 6, aas: 'FFLLSSSSYYQQCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['ATG'] },
  { id: 9, aas: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG', starts: ['ATG', 'GTG'] },
  { id: 10, aas: 'FFLLSSSSYY**CCCWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['ATG'] },
  {
    id: 11,
    aas: 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  { id: 12, aas: 'FFLLSSSSYY**CC*WLLLSPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['CTG', 'ATG'] },
  {
    id: 13,
    aas: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSGGVVVVAAAADDEEGGGG',
    starts: ['TTG', 'ATA', 'ATG', 'GTG'],
  },
  { id: 14, aas: 'FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNNKSSSSVVVVAAAADDEEGGGG', starts: ['ATG'] },
  { id: 15, aas: 'FFLLSSSSYY*QCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['ATG'] },
  { id: 16, aas: 'FFLLSSSSYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['ATG'] },
  { id: 21, aas: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNNKSSSSVVVVAAAADDEEGGGG', starts: ['ATG', 'GTG'] },
  { id: 22, aas: 'FFLLSS*SYY*LCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['ATG'] },
  { id: 23, aas: 'FF*LSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['ATT', 'ATG', 'GTG'] },
  {
    id: 24,
    aas: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATG', 'GTG'],
  },
  { id: 25, aas: 'FFLLSSSSYY**CCGWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', starts: ['TTG', 'ATG', 'GTG'] },
  {
    id: 33,
    aas: 'FFLLSSSSYYY*CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSSKVVVVAAAADDEEGGGG',
    starts: ['TTG', 'CTG', 'ATG', 'GTG'],
  },
];

export const codeById = (id: number): GeneticCode | undefined => GENETIC_CODES.find((code) => code.id === id);

/** Three-letter amino acid names for protein change notation. */
export const THREE: Record<string, string> = {
  A: 'Ala',
  R: 'Arg',
  N: 'Asn',
  D: 'Asp',
  C: 'Cys',
  Q: 'Gln',
  E: 'Glu',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  L: 'Leu',
  K: 'Lys',
  M: 'Met',
  F: 'Phe',
  P: 'Pro',
  S: 'Ser',
  T: 'Thr',
  W: 'Trp',
  Y: 'Tyr',
  V: 'Val',
  U: 'Sec',
  O: 'Pyl',
  X: 'Xaa',
  '*': 'Ter',
};

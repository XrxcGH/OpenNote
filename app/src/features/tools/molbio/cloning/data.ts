// Reference facts for cloning: recognition sites and cut positions of common Type II restriction enzymes, the
// unified nearest-neighbor parameters for DNA duplexes, and nearest-neighbor extinction coefficients for single-
// stranded DNA. Sites and cut positions are facts about the enzymes; the thermodynamic and absorbance values are the
// published numbers named in SOURCES.

/** An enzyme as its site with a caret where the top strand is cut, such as G^AATTC. Every site here is a palindrome. */
export const ENZYMES: readonly (readonly [name: string, site: string])[] = [
  ['AatII', 'GACGT^C'],
  ['AflII', 'C^TTAAG'],
  ['AgeI', 'A^CCGGT'],
  ['AluI', 'AG^CT'],
  ['ApaI', 'GGGCC^C'],
  ['AscI', 'GG^CGCGCC'],
  ['AvaI', 'C^YCGRG'],
  ['AvrII', 'C^CTAGG'],
  ['BamHI', 'G^GATCC'],
  ['BglI', 'GCCNNNN^NGGC'],
  ['BglII', 'A^GATCT'],
  ['BsrGI', 'T^GTACA'],
  ['BstBI', 'TT^CGAA'],
  ['ClaI', 'AT^CGAT'],
  ['DraI', 'TTT^AAA'],
  ['EagI', 'C^GGCCG'],
  ['EcoRI', 'G^AATTC'],
  ['EcoRV', 'GAT^ATC'],
  ['FseI', 'GGCCGG^CC'],
  ['HaeIII', 'GG^CC'],
  ['HhaI', 'GCG^C'],
  ['HincII', 'GTY^RAC'],
  ['HindIII', 'A^AGCTT'],
  ['HpaI', 'GTT^AAC'],
  ['KpnI', 'GGTAC^C'],
  ['MfeI', 'C^AATTG'],
  ['MluI', 'A^CGCGT'],
  ['MspI', 'C^CGG'],
  ['NcoI', 'C^CATGG'],
  ['NdeI', 'CA^TATG'],
  ['NheI', 'G^CTAGC'],
  ['NotI', 'GC^GGCCGC'],
  ['NruI', 'TCG^CGA'],
  ['NsiI', 'ATGCA^T'],
  ['PacI', 'TTAAT^TAA'],
  ['PstI', 'CTGCA^G'],
  ['PvuI', 'CGAT^CG'],
  ['PvuII', 'CAG^CTG'],
  ['RsaI', 'GT^AC'],
  ['SacI', 'GAGCT^C'],
  ['SacII', 'CCGC^GG'],
  ['SalI', 'G^TCGAC'],
  ['Sau3AI', '^GATC'],
  ['SbfI', 'CCTGCA^GG'],
  ['ScaI', 'AGT^ACT'],
  ['SmaI', 'CCC^GGG'],
  ['SpeI', 'A^CTAGT'],
  ['SphI', 'GCATG^C'],
  ['SspI', 'AAT^ATT'],
  ['StuI', 'AGG^CCT'],
  ['SwaI', 'ATTT^AAAT'],
  ['TaqI', 'T^CGA'],
  ['XbaI', 'T^CTAGA'],
  ['XhoI', 'C^TCGAG'],
  ['XmaI', 'C^CCGGG'],
  ['XmnI', 'GAANN^NNTTC'],
];

/** ΔH° (kcal/mol) and ΔS° (cal/(mol·K)) in 1 M NaCl for each nearest-neighbor pair, read 5'→3' on one strand. */
export const NN: { readonly [pair: string]: readonly [dH: number, dS: number] } = {
  AA: [-7.9, -22.2],
  TT: [-7.9, -22.2],
  AT: [-7.2, -20.4],
  TA: [-7.2, -21.3],
  CA: [-8.5, -22.7],
  TG: [-8.5, -22.7],
  GT: [-8.4, -22.4],
  AC: [-8.4, -22.4],
  CT: [-7.8, -21.0],
  AG: [-7.8, -21.0],
  GA: [-8.2, -22.2],
  TC: [-8.2, -22.2],
  CG: [-10.6, -27.2],
  GC: [-9.8, -24.4],
  GG: [-8.0, -19.9],
  CC: [-8.0, -19.9],
};

/** Initiation terms for a terminal G·C or A·T pair, and the symmetry term for a self-complementary duplex. */
export const NN_INIT = { GC: [0.1, -2.8], AT: [2.3, 4.1], symmetry: [0, -1.4] } as const;

/** Molar extinction coefficients at 260 nm (1/(M·cm)) of single-stranded DNA dinucleotides and nucleotides. */
export const EPS_PAIR: { readonly [pair: string]: number } = {
  AA: 27400,
  AC: 21200,
  AG: 25000,
  AT: 22800,
  CA: 21200,
  CC: 14600,
  CG: 18000,
  CT: 15200,
  GA: 25200,
  GC: 17600,
  GG: 21600,
  GT: 20000,
  TA: 23400,
  TC: 16200,
  TG: 19000,
  TT: 16800,
};
export const EPS_BASE: { readonly [base: string]: number } = { A: 15400, C: 7400, G: 11500, T: 8700 };

/** Anhydrous residue masses (g/mol) of DNA nucleotides in a chain, and the correction for a 5'-OH oligo. */
export const RESIDUE = { A: 313.21, T: 304.2, C: 289.18, G: 329.21, end: -61.96 } as const;

/** Average mass of a base pair of double-stranded DNA (g/mol) and Avogadro's number (exact, SI 2019). */
export const BP_MASS = 650;
export const AVOGADRO = 6.02214076e23;

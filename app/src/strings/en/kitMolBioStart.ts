// The molecular biology kit's start-up words: its window title and its palette commands. The rest of kitMolBio.ts
// joins this object when the kit's code loads (features/tools/molbio/text.ts), so it stays out of start-up.
import type { kitMolBio as all } from './kitMolBio';

const START = {
  window: 'Biology tools',
  open: 'Open the biology tools',
  openKeywords: 'molecular biology genetics evolution bioinformatics pedigree dna protein',
  sequence: {
    title: 'DNA and RNA sequences',
    keywords:
      'dna rna fasta complement translation codon genetic code orf gc skew cpg motif iupac kmer mutation hgvs crispr pam',
  },
  cloning: {
    title: 'Cloning, PCR, and gels',
    keywords:
      'cloning restriction enzyme digest site map plasmid vector gel electrophoresis ladder band size primer melting temperature tm wallace nearest neighbor santalucia pcr annealing oligo extinction coefficient a260 ligation insert ratio copy number molarity',
  },
  protein: {
    title: 'Proteins and peptides',
    keywords:
      'protein peptide amino acid mass monoisotopic isoelectric point pi pka charge extinction a280 hydropathy gravy helix',
  },
  align: {
    title: 'Sequence alignment',
    keywords:
      'alignment needleman wunsch smith waterman global local semi-global gap affine gotoh blosum pam dot plot dynamic programming',
  },
  phylo: {
    title: 'Phylogenetic trees',
    keywords:
      'phylogeny phylogenetic tree evolution distance jukes cantor kimura p-distance upgma neighbor joining parsimony fitch bootstrap consensus newick reroot outgroup ladderize cladogram phylogram radial common ancestor monophyletic clade sister group',
  },
  crosses: {
    title: 'Genetic crosses and linkage',
    keywords:
      'punnett square mendel cross dihybrid trihybrid ratio epistasis lethal sex linked x-linked abo multiple alleles chi square recombination map distance centimorgan haldane kosambi three point test cross interference coincidence lod linkage bayes carrier risk',
  },
  popgen: {
    title: 'Population genetics',
    keywords:
      'population genetics allele frequency genotype hardy weinberg equilibrium chi square exact test inbreeding coefficient heterozygosity selection fitness heterozygote advantage mutation selection balance migration island model genetic drift wright fisher fixation effective population size linkage disequilibrium heritability breeder equation',
  },
  family: {
    title: 'Family, pedigree, and kinship charts',
    keywords:
      'pedigree family tree chart inheritance pattern autosomal dominant recessive x-linked y-linked mitochondrial carrier proband consanguinity coefficient of relationship kinship inbreeding genealogy ancestors descendants succession kin type cousin parallel cross genogram ecomap household',
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in kitMolBio.ts. */
export const kitMolBio = START as unknown as typeof all;
export const kitMolBioStart = START;

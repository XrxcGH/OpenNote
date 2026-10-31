// Interlinear glosses in the manner of the Leipzig Glossing Rules: the words of the example line up with their
// glosses, morpheme by morpheme. A hyphen joins segmentable morphemes, an equals sign joins a clitic, and a period
// joins the several meanings of one morpheme in the gloss. Grammatical labels are written in capitals.

/** The standard abbreviations listed with the Leipzig Glossing Rules, with person numbers 1, 2, and 3. */
export const LEIPZIG: Readonly<Record<string, string>> = {
  '1': 'first person',
  '2': 'second person',
  '3': 'third person',
  A: 'agent-like argument of a transitive verb',
  ABL: 'ablative',
  ABS: 'absolutive',
  ACC: 'accusative',
  ADJ: 'adjective',
  ADV: 'adverb(ial)',
  AGR: 'agreement',
  ALL: 'allative',
  ANTIP: 'antipassive',
  APPL: 'applicative',
  ART: 'article',
  AUX: 'auxiliary',
  BEN: 'benefactive',
  CAUS: 'causative',
  CLF: 'classifier',
  COM: 'comitative',
  COMP: 'complementizer',
  COMPL: 'completive',
  COND: 'conditional',
  COP: 'copula',
  CVB: 'converb',
  DAT: 'dative',
  DECL: 'declarative',
  DEF: 'definite',
  DEM: 'demonstrative',
  DET: 'determiner',
  DIST: 'distal',
  DISTR: 'distributive',
  DU: 'dual',
  DUR: 'durative',
  ERG: 'ergative',
  EXCL: 'exclusive',
  F: 'feminine',
  FOC: 'focus',
  FUT: 'future',
  GEN: 'genitive',
  IMP: 'imperative',
  INCL: 'inclusive',
  IND: 'indicative',
  INDF: 'indefinite',
  INF: 'infinitive',
  INS: 'instrumental',
  INTR: 'intransitive',
  IPFV: 'imperfective',
  IRR: 'irrealis',
  LOC: 'locative',
  M: 'masculine',
  N: 'neuter',
  NEG: 'negation, negative',
  NMLZ: 'nominalizer/nominalization',
  NOM: 'nominative',
  OBJ: 'object',
  OBL: 'oblique',
  P: 'patient-like argument of a transitive verb',
  PASS: 'passive',
  PFV: 'perfective',
  PL: 'plural',
  POSS: 'possessive',
  PRED: 'predicative',
  PRF: 'perfect',
  PRS: 'present',
  PROG: 'progressive',
  PROH: 'prohibitive',
  PROX: 'proximal/proximate',
  PST: 'past',
  PTCP: 'participle',
  PURP: 'purposive',
  Q: 'question particle/marker',
  QUOT: 'quotative',
  RECP: 'reciprocal',
  REFL: 'reflexive',
  REL: 'relative',
  RES: 'resultative',
  S: 'single argument of an intransitive verb',
  SBJ: 'subject',
  SBJV: 'subjunctive',
  SG: 'singular',
  TOP: 'topic',
  TR: 'transitive',
  VOC: 'vocative',
};

export interface GlossWord {
  word: string;
  gloss: string;
  /** The morphemes and their glosses, paired in order. */
  morphemes: { form: string; gloss: string }[];
}

export interface GlossProblem {
  /** 1 for the first word. */
  position: number;
  word: string;
  gloss: string;
  kind: 'missingGloss' | 'extraGloss' | 'morphemes' | 'joiners';
  forms: number;
  glosses: number;
}

export interface GlossResult {
  words: GlossWord[];
  problems: GlossProblem[];
  translation: string;
  /** Capitalized labels found in the glosses, each with its meaning, or null when it is not a standard label. */
  labels: { label: string; meaning: string | null }[];
}

const split = (line: string) => line.trim().split(/\s+/).filter(Boolean);
const pieces = (word: string) => word.split(/[-=]/);
const joiners = (word: string) => word.replace(/[^-=]/g, '');

/** A gloss's grammatical labels: runs of capitals and person digits, as in 1SG, PL, or POSS. */
export function labelsOf(gloss: string): string[] {
  const out: string[] = [];
  for (const part of gloss.split(/[-=.]/)) {
    const m = /^([123])?([A-Z]+)?$/.exec(part);
    if (!m || part === '') continue;
    if (m[1]) out.push(m[1]);
    if (m[2]) {
      // A person digit with a number, as in 3PL, is a person and a number; a word in capitals is one label.
      out.push(m[2]);
    }
  }
  return out;
}

export function checkGloss(example: string, glossLine: string, translation = ''): GlossResult {
  const words = split(example);
  const glosses = split(glossLine);
  if (words.length === 0) throw new Error('empty');
  const result: GlossWord[] = [];
  const problems: GlossProblem[] = [];
  const count = Math.max(words.length, glosses.length);
  for (let i = 0; i < count; i++) {
    const word = words[i] ?? '';
    const gloss = glosses[i] ?? '';
    const forms = word ? pieces(word) : [];
    const meanings = gloss ? pieces(gloss) : [];
    const base = { position: i + 1, word, gloss, forms: forms.length, glosses: meanings.length };
    if (!gloss) problems.push({ ...base, kind: 'missingGloss' });
    else if (!word) problems.push({ ...base, kind: 'extraGloss' });
    else if (forms.length !== meanings.length) problems.push({ ...base, kind: 'morphemes' });
    else if (joiners(word) !== joiners(gloss)) problems.push({ ...base, kind: 'joiners' });
    if (word) {
      result.push({
        word,
        gloss,
        morphemes: forms.map((form, k) => ({ form, gloss: meanings[k] ?? '' })),
      });
    }
  }
  const seen = new Set<string>();
  const labels: GlossResult['labels'] = [];
  for (const g of glosses) {
    for (const label of labelsOf(g)) {
      if (seen.has(label)) continue;
      seen.add(label);
      labels.push({ label, meaning: LEIPZIG[label] ?? null });
    }
  }
  return { words: result, problems, translation: translation.trim(), labels };
}

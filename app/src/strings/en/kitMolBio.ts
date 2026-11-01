// The molecular biology, genetics, and evolution kit: the window, what every tool shares, and one part per tool.
import { align } from './kitMolBio/align';
import { cloning } from './kitMolBio/cloning';
import { family } from './kitMolBio/family';
import { crosses } from './kitMolBio/crosses';
import { phylo } from './kitMolBio/phylo';
import { popgen } from './kitMolBio/popgen';
import { protein } from './kitMolBio/protein';
import { sequence } from './kitMolBio/sequence';

export const kitMolBio = {
  window: 'Biology tools',
  open: 'Open the biology tools',
  openKeywords: 'molecular biology genetics evolution bioinformatics pedigree dna protein',
  tabs: 'Biology tools',
  coursework: 'For coursework and lab planning, not for clinical or diagnostic use.',
  loading: 'Loading the tool…',
  results: 'Results',
  steps: 'Worked steps',
  equation: 'Equation',
  assumptions: 'Assumptions and notes',
  source: 'Source: {source}',
  insert: 'Insert into the page',
  insertAnswer: 'Insert answer',
  insertEquation: 'Insert equation',
  insertTable: 'Insert results table',
  insertSteps: 'Insert steps',
  insertShort: 'Insert',
  insertPicture: 'Insert picture',
  insertThis: 'Insert {what}',
  figureOf: 'Figure: {what}',
  textOf: 'Text: {what}',
  inserted: 'Inserted into the page.',
  noPage: 'Nothing was inserted: open a page and click where it should go, then insert again.',
  example: 'Reset to the example',
  w: { yes: 'Yes', no: 'No' },
  e: {
    number: '{field} needs a number.',
    positive: '{field} must be more than zero.',
    wholeRange: '{field} must be a whole number from {min} to {max}.',
    range: '{field} must be from {min} to {max}.',
    listNumber: '“{text}” in {field} is not a number.',
    choice: 'Choose a value for {field}.',
    noSequence: 'Type or paste a sequence.',
    badBase: '“{char}” at position {position} is not a base or an IUPAC code.',
    noMotif: 'Type a motif.',
    badMotif: '“{char}” at position {position} of the motif is not an IUPAC code.',
    ratioLength:
      'There {classes, plural, one {is # count} other {are # counts}} but {ratio, plural, one {# ratio part} other {# ratio parts}}.',
    fewClasses: 'A test needs at least 2 classes.',
    ratioPositive: 'Counts cannot be negative, and every ratio part must be more than zero.',
    noCounts: 'The counts add up to zero.',
    noDf: 'No degrees of freedom are left. Add classes or fit fewer parameters.',
    zeroDenominator: 'A fraction cannot have a zero denominator.',
    probability: '{field} needs a probability, such as 1/4, 0.25, or 25%.',
    probabilityRange: '{field} must be from 0 to 1.',
  },
  sequence,
  cloning,
  protein,
  align,
  phylo,
  crosses,
  popgen,
  family,
} as const;

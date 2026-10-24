// The molecular biology, genetics, and evolution kit: the window, what every tool shares, and one part per tool.
import { align } from './kitMolBio/align';
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
  inserted: 'Inserted into the page.',
  noPage: 'Open a page to insert into.',
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
  },
  sequence,
  protein,
  align,
} as const;

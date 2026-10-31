// The inter-rater agreement tool's fields and examples. The outcomes live in categorical.ts and measures.ts.
import type { ToolSpec, Values } from '../kit/spec';
import { runCodes, runFleiss, runMatrix } from './categorical';
import { runBland, runIcc, runKripp } from './measures';

const isMode = (mode: string) => (v: Values) => v.mode === mode;

const CODES = [
  'yes, yes',
  'yes, yes',
  'yes, no',
  'no, no',
  'no, no',
  'yes, yes',
  'no, yes',
  'no, no',
  'yes, yes',
  'no, no',
].join('\n');
const FLEISS = [
  '0 0 0 0 14',
  '0 2 6 4 2',
  '0 0 3 5 6',
  '0 3 9 2 0',
  '2 2 8 1 1',
  '7 7 0 0 0',
  '3 2 6 3 0',
  '2 5 3 2 2',
  '6 5 2 1 0',
  '0 2 2 3 7',
].join('\n');
const UNITS = ['a, a, a', 'a, b, a', 'b, b, b', 'b, b, .', 'c, c, c', 'a, a, b'].join('\n');
const ICC = ['9 2 5 8', '6 1 3 2', '8 4 6 8', '7 1 2 6', '10 5 6 9', '6 2 4 7'].join('\n');
const PAIRS = [
  'method a, method b',
  '10.2, 9.7',
  '11.5, 11.7',
  '9.8, 9.5',
  '12.1, 12.0',
  '10.9, 10.5',
  '11.0, 11.1',
].join('\n');

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['codes', 'matrix', 'fleiss', 'kripp', 'icc', 'bland'], first: 'codes' },
    { id: 'codes', type: 'text', rows: 8, first: CODES, when: isMode('codes') },
    { id: 'order', type: 'line', first: '', when: isMode('codes') },
    { id: 'matrix', type: 'text', rows: 4, first: '20 5\n10 15', when: isMode('matrix') },
    {
      id: 'weights',
      type: 'choice',
      options: ['none', 'linear', 'quadratic'],
      first: 'none',
      when: (v) => v.mode === 'codes' || v.mode === 'matrix',
    },
    { id: 'counts', type: 'text', rows: 8, first: FLEISS, when: isMode('fleiss') },
    { id: 'data', type: 'text', rows: 7, first: UNITS, when: isMode('kripp') },
    { id: 'layout', type: 'choice', options: ['unitsRows', 'codersRows'], first: 'unitsRows', when: isMode('kripp') },
    {
      id: 'level',
      type: 'choice',
      options: ['nominal', 'ordinal', 'interval', 'ratio'],
      first: 'nominal',
      when: isMode('kripp'),
    },
    { id: 'boot', type: 'number', first: '1000', when: isMode('kripp') },
    { id: 'seed', type: 'number', first: '1', when: isMode('kripp') },
    { id: 'ratings', type: 'text', rows: 6, first: ICC, when: isMode('icc') },
    { id: 'input', type: 'choice', options: ['pairs', 'diffs'], first: 'pairs', when: isMode('bland') },
    { id: 'pairs', type: 'text', rows: 7, first: PAIRS, when: isMode('bland') },
  ],
  run(values) {
    if (values.mode === 'matrix') return runMatrix(values);
    if (values.mode === 'fleiss') return runFleiss(values);
    if (values.mode === 'kripp') return runKripp(values);
    if (values.mode === 'icc') return runIcc(values);
    if (values.mode === 'bland') return runBland(values);
    return runCodes(values);
  },
  examples: [
    { id: 'codes', values: { mode: 'codes' } },
    { id: 'kappa', values: { mode: 'matrix', matrix: '20 5\n10 15' } },
    { id: 'ordinal', values: { mode: 'matrix', matrix: 'low mid high\n10 3 1\n2 12 4\n0 3 15', weights: 'quadratic' } },
    { id: 'fleiss', values: { mode: 'fleiss' } },
    { id: 'kripp', values: { mode: 'kripp', data: 'a a\na b\nb b\nb b\nc c\na a', boot: '0' } },
    { id: 'icc', values: { mode: 'icc' } },
    { id: 'bland', values: { mode: 'bland', input: 'diffs', pairs: '0.5\n-0.2\n0.3\n0.1\n0.4\n-0.1' } },
  ],
};

// The scales and psychometrics tool's fields and examples. The outcomes live in reports.ts and testing.ts.
import type { ToolSpec, Values } from '../kit/spec';
import { runProphecy, runReliability, runScore } from './reports';
import { runIrt, runItems, runSus, runTransform } from './testing';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const onData = (v: Values) => v.mode === 'reliability' || v.mode === 'score';

const LIKERT = ['q1 q2 q3 q4', '3 4 3 5', '2 2 3 2', '4 5 4 4', '3 3 2 3', '5 4 5 5', '1 2 1 2'].join('\n');
const BINARY = ['1 1 0 1 1', '1 0 0 1 0', '1 1 1 1 1', '0 0 0 1 0', '1 1 0 0 1', '1 1 1 1 0'].join('\n');
const ANSWERS = ['ABC', 'ABC', 'ABD', 'ACC', 'ABD', 'ADD', 'ACD', 'BCD'].join('\n');

export const spec: ToolSpec = {
  fields: [
    {
      id: 'mode',
      type: 'choice',
      options: ['reliability', 'score', 'prophecy', 'items', 'transform', 'irt', 'sus'],
      first: 'reliability',
    },
    { id: 'data', type: 'text', rows: 7, first: LIKERT, when: onData },
    { id: 'reversed', type: 'line', first: '', when: isMode('score') },
    { id: 'low', type: 'number', first: '1', when: isMode('score') },
    { id: 'high', type: 'number', first: '5', when: isMode('score') },
    { id: 'subscales', type: 'text', rows: 3, first: '', when: isMode('score') },
    { id: 'method', type: 'choice', options: ['sum', 'mean'], first: 'sum', when: isMode('score') },
    { id: 'maxMissing', type: 'number', first: '0', when: isMode('score') },
    { id: 'r', type: 'number', first: '0.7', when: isMode('prophecy') },
    { id: 'factor', type: 'number', first: '2', when: isMode('prophecy') },
    { id: 'target', type: 'number', first: '0.9', optional: true, when: isMode('prophecy') },
    { id: 'answers', type: 'text', rows: 8, first: ANSWERS, when: isMode('items') },
    { id: 'key', type: 'line', first: 'A B C', when: isMode('items') },
    { id: 'score', type: 'number', first: '115', when: isMode('transform') },
    { id: 'mean', type: 'number', first: '100', when: isMode('transform') },
    { id: 'sd', type: 'number', first: '15', when: isMode('transform') },
    { id: 'rxx', type: 'number', first: '0.91', when: isMode('transform') },
    { id: 'level', type: 'number', first: '0.95', when: isMode('transform') },
    { id: 'norms', type: 'line', first: '', when: isMode('transform') },
    { id: 'model', type: 'choice', options: ['1pl', '2pl', '3pl', 'grm'], first: '2pl', when: isMode('irt') },
    { id: 'scaling', type: 'choice', options: ['d1', 'd1702'], first: 'd1', when: isMode('irt') },
    { id: 'items', type: 'text', rows: 4, first: '1.5, 0.5\n1, -1\n0.8, 1.2', when: isMode('irt') },
    { id: 'theta', type: 'number', first: '0', when: isMode('irt') },
    { id: 'sus', type: 'text', rows: 4, first: '4 2 4 1 5 2 4 2 4 1\n3 3 3 3 3 3 3 3 3 3', when: isMode('sus') },
  ],
  run(values) {
    if (values.mode === 'score') return runScore(values);
    if (values.mode === 'prophecy') return runProphecy(values);
    if (values.mode === 'items') return runItems(values);
    if (values.mode === 'transform') return runTransform(values);
    if (values.mode === 'irt') return runIrt(values);
    if (values.mode === 'sus') return runSus(values);
    return runReliability(values);
  },
  examples: [
    { id: 'alpha', values: { mode: 'reliability' } },
    { id: 'kr20', values: { mode: 'reliability', data: BINARY } },
    {
      id: 'subscales',
      values: { mode: 'score', reversed: '2', subscales: 'first: 1, 2\nsecond: 3, 4', method: 'mean' },
    },
    { id: 'prophecy', values: { mode: 'prophecy', r: '0.6', factor: '2', target: '' } },
    { id: 'items', values: { mode: 'items' } },
    { id: 'transform', values: { mode: 'transform' } },
    { id: 'threePl', values: { mode: 'irt', model: '3pl', scaling: 'd1702', items: '1.2, 0, 0.2\n1.5, 1, 0.15' } },
    { id: 'graded', values: { mode: 'irt', model: 'grm', scaling: 'd1702', items: '1.2, -1, 0, 1.5\n0.9, -0.5, 0.8' } },
    { id: 'sus', values: { mode: 'sus' } },
  ],
};

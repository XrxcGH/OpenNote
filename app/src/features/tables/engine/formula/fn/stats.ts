// Statistical functions. Owner: tables:fn-stats. These are the functions tables had before the library; their
// behavior is unchanged.

import { err, finish, isNumber, type Value } from '../../values';
import { numbersIn, type FnSpec2 } from './types';

const VALUES = [{ repeat: [{ name: 'value', kind: 'range' as const }], min: 1 }];

function aggregate(name: string, run: (nums: number[]) => Value, example: string): FnSpec2 {
  return {
    name,
    family: 'stats',
    params: VALUES,
    run: (args) => {
      const nums = numbersIn(args);
      return Array.isArray(nums) ? run(nums) : nums;
    },
    meta: { signature: `${name}(value, ...)`, example },
  };
}

function median(nums: number[]): Value {
  if (nums.length === 0) return err('NUM');
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : finish((sorted[mid - 1] + sorted[mid]) / 2);
}

export const functions: readonly FnSpec2[] = [
  aggregate(
    'AVERAGE',
    (n) => (n.length ? finish(n.reduce((a, b) => a + b, 0) / n.length) : err('DIV0')),
    '=AVERAGE(2, 4, 9) gives 5',
  ),
  aggregate('MIN', (n) => (n.length ? Math.min(...n) : 0), '=MIN(4, -1, 7) gives -1'),
  aggregate('MAX', (n) => (n.length ? Math.max(...n) : 0), '=MAX(4, -1, 7) gives 7'),
  {
    name: 'COUNT',
    family: 'stats',
    params: VALUES,
    run: (args) => args.filter(isNumber).length,
    meta: { signature: 'COUNT(value, ...)', example: '=COUNT(1, 2, 3) gives 3' },
  },
  {
    name: 'COUNTA',
    family: 'stats',
    params: [{ repeat: [{ name: 'value', kind: 'range', direct: 'raw' }], min: 1 }],
    run: (args) => args.filter((v) => v !== null && v !== '').length,
    meta: { signature: 'COUNTA(value, ...)', example: '=COUNTA("a", 1, TRUE) gives 3' },
  },
  aggregate('MEDIAN', median, '=MEDIAN(5, 1, 3, 2) gives 2.5'),
];

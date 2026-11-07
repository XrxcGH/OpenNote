// Date and time functions. Owner: tables:fn-datetime. Dates are serials (days since 1899-12-30), so a date minus a
// date is a number of days. These are the functions tables had before the library; their behavior is unchanged.

import { daysToYmd, ymdToSerial } from '../../dates';
import { err, finish, toNumber, toNumbers } from '../../values';
import type { FnSpec2 } from './types';

function datePart(name: string, pick: (ymd: ReturnType<typeof daysToYmd>) => number, example: string): FnSpec2 {
  return {
    name,
    family: 'datetime',
    params: [{ name: 'date', kind: 'number' }],
    run: ([v]) => {
      const n = toNumber(v);
      return typeof n === 'number' ? pick(daysToYmd(n)) : n;
    },
    meta: { signature: `${name}(date)`, example },
  };
}

export const functions: readonly FnSpec2[] = [
  {
    name: 'TODAY',
    family: 'datetime',
    params: [],
    volatile: true,
    run: (_args, env) => env.today(),
    meta: { signature: 'TODAY()', example: '=TODAY()-1 gives yesterday' },
  },
  {
    name: 'DATE',
    family: 'datetime',
    params: [
      { name: 'year', kind: 'number' },
      { name: 'month', kind: 'number' },
      { name: 'day', kind: 'number' },
    ],
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const [year, m, d] = nums.map(Math.trunc);
      // Years 0 to 99 mean 1900 to 1999. Other years count as written, so 1899-12-30 is serial 0 and earlier
      // dates are negative serials, as in Sheets (DIFFERENCES.md lists Excel's rule).
      const y = year >= 0 && year < 100 ? year + 1900 : year;
      return y < 0 || y > 9999 ? err('NUM') : finish(ymdToSerial(y, m, d));
    },
    meta: { signature: 'DATE(year, month, day)', example: '=DATE(2024, 1, 1) gives 45292' },
  },
  datePart('YEAR', (p) => p.y, '=YEAR(45292) gives 2024'),
  datePart('MONTH', (p) => p.m, '=MONTH(45292) gives 1'),
  datePart('DAY', (p) => p.d, '=DAY(45292) gives 1'),
  {
    name: 'DAYS',
    family: 'datetime',
    params: [
      { name: 'end', kind: 'number' },
      { name: 'start', kind: 'number' },
    ],
    run: (args) => {
      const nums = toNumbers(args);
      return Array.isArray(nums) ? Math.floor(nums[0]) - Math.floor(nums[1]) : nums;
    },
    meta: { signature: 'DAYS(end, start)', example: '=DAYS(45351, 45322) gives 29' },
  },
];

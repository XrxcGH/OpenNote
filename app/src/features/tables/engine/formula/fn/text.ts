// Text functions. Owner: tables:fn-text. These are the functions tables had before the library; their behavior is
// unchanged.

import { err, toNumber, toText, type Value } from '../../values';
import type { FnSpec2 } from './types';

function text1(name: string, f: (s: string) => Value, example: string): FnSpec2 {
  return {
    name,
    family: 'text',
    params: [{ name: 'text', kind: 'text' }],
    run: ([v]) => {
      const s = toText(v);
      return typeof s === 'string' ? f(s) : s;
    },
    meta: { signature: `${name}(text)`, example },
  };
}

function edge(name: string, pick: (s: string, n: number) => string, example: string): FnSpec2 {
  return {
    name,
    family: 'text',
    params: [
      { name: 'text', kind: 'text' },
      { name: 'count', kind: 'number', optional: true, default: 1 },
    ],
    run: ([v, count = 1]) => {
      const s = toText(v);
      const n = toNumber(count);
      if (typeof s !== 'string') return s;
      if (typeof n !== 'number') return n;
      return n < 0 ? err('VALUE') : pick(s, Math.trunc(n));
    },
    meta: { signature: `${name}(text, [count])`, example },
  };
}

export const functions: readonly FnSpec2[] = [
  {
    name: 'CONCAT',
    family: 'text',
    params: [{ repeat: [{ name: 'text', kind: 'text' }], min: 1 }],
    run: (args) => {
      let out = '';
      for (const v of args) {
        const s = toText(v);
        if (typeof s !== 'string') return s;
        out += s;
      }
      return out;
    },
    meta: { signature: 'CONCAT(text, ...)', example: '=CONCAT("pen", "cil") gives pencil' },
  },
  text1('LEN', (s) => s.length, '=LEN("paper") gives 5'),
  text1('LOWER', (s) => s.toLowerCase(), '=LOWER("Ink") gives ink'),
  text1('UPPER', (s) => s.toUpperCase(), '=UPPER("Ink") gives INK'),
  text1('TRIM', (s) => s.trim().replace(/\s+/g, ' '), '=TRIM("  a   b ") gives a b'),
  edge('LEFT', (s, n) => s.slice(0, n), '=LEFT("notebook", 4) gives note'),
  edge('RIGHT', (s, n) => (n === 0 ? '' : s.slice(-n)), '=RIGHT("notebook", 4) gives book'),
];

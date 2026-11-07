// Logical functions and LAMBDA helpers. Owner: tables:fn-logic-info. IF and IFERROR take lazy arguments, so the
// compiler evaluates them itself and only the branch it needs runs. These are the functions tables had before the
// library; their behavior is unchanged.

import { err, toBool, type Value } from '../../values';
import type { FnSpec2 } from './types';

function logic(name: string, combine: (bools: boolean[]) => boolean, example: string): FnSpec2 {
  return {
    name,
    family: 'logical',
    params: [{ repeat: [{ name: 'logical', kind: 'bool' }], min: 1 }],
    run: (args) => {
      const bools: boolean[] = [];
      for (const v of args) {
        const b = toBool(v);
        if (typeof b !== 'boolean') return b;
        bools.push(b);
      }
      return combine(bools);
    },
    meta: { signature: `${name}(logical, ...)`, example },
  };
}

/** The compiler evaluates functions with lazy arguments itself. */
const special = (): Value => err('VALUE');

export const functions: readonly FnSpec2[] = [
  logic('AND', (b) => b.every(Boolean), '=AND(TRUE, 1>2) gives FALSE'),
  logic('OR', (b) => b.some(Boolean), '=OR(TRUE, 1>2) gives TRUE'),
  {
    name: 'NOT',
    family: 'logical',
    params: [{ name: 'logical', kind: 'value' }],
    run: ([v]) => {
      const b = toBool(v);
      return typeof b === 'boolean' ? !b : b;
    },
    meta: { signature: 'NOT(logical)', example: '=NOT(1>2) gives TRUE' },
  },
  {
    name: 'IF',
    family: 'logical',
    params: [
      { name: 'test', kind: 'bool' },
      { name: 'then', kind: 'lazy' },
      { name: 'otherwise', kind: 'lazy', optional: true, default: false },
    ],
    run: special,
    meta: { signature: 'IF(test, then, [otherwise])', example: '=IF(3>2, "yes", "no") gives yes' },
  },
  {
    name: 'IFERROR',
    family: 'logical',
    params: [
      { name: 'value', kind: 'lazy' },
      { name: 'on_error', kind: 'lazy' },
    ],
    run: special,
    meta: { signature: 'IFERROR(value, on_error)', example: '=IFERROR(1/0, 0) gives 0' },
  },
];

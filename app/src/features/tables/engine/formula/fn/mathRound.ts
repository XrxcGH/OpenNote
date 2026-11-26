// Rounding functions of the math family: ROUND and its kin, CEILING and FLOOR in their several forms, MROUND, EVEN,
// ODD, TRUNC, QUOTIENT. Written from the documented behavior; angles and other families are elsewhere.

import { err, finish } from '../../values';
import type { FnSpec2 } from './types';
import { number, optional, quotient, roundAt, scalar } from './mathKit';

function roundWith(name: string, mode: 'half' | 'up' | 'down', example: string): FnSpec2 {
  return scalar(
    name,
    [number(), optional('digits', 0)],
    ([x, d = 0]) => {
      const digits = Math.trunc(d);
      const round = mode === 'half' ? Math.round : mode === 'up' ? Math.ceil : Math.floor;
      return finish(roundAt(x, digits, round));
    },
    example,
  );
}

/** The step a CEILING or FLOOR call uses when none is given: 1, as Google Sheets does (Excel requires the step). */
const stepFor = (_n: number, step: number | undefined) => step ?? 1;

export const functions: readonly FnSpec2[] = [
  roundWith('ROUND', 'half', '=ROUND(2.675, 2) gives 2.68'),
  roundWith('ROUNDUP', 'up', '=ROUNDUP(2.01, 1) gives 2.1'),
  roundWith('ROUNDDOWN', 'down', '=ROUNDDOWN(-2.09, 1) gives -2'),
  scalar(
    'TRUNC',
    [number(), optional('digits', 0)],
    ([x, d = 0]) => finish(roundAt(x, Math.trunc(d), Math.floor)),
    '=TRUNC(-8.9) gives -8',
  ),
  scalar(
    'MROUND',
    [number(), number('multiple')],
    ([n, m]) => {
      if (m === 0) return 0;
      if (n * m < 0) return err('NUM');
      return finish(Math.sign(n) * Math.round(quotient(Math.abs(n), Math.abs(m))) * Math.abs(m));
    },
    '=MROUND(10, 3) gives 9',
  ),
  scalar(
    'CEILING',
    [number(), optional('step')],
    ([n, s0]) => {
      const s = stepFor(n, s0);
      if (n > 0 && s < 0) return err('NUM');
      if (s === 0 || n === 0) return 0;
      // A negative number with a negative step moves away from zero, as the documentation says.
      return finish(n < 0 && s < 0 ? -Math.ceil(quotient(-n, -s)) * -s : Math.ceil(quotient(n, s)) * s);
    },
    '=CEILING(2.5, 1) gives 3',
  ),
  scalar(
    'CEILING.MATH',
    [number(), optional('step'), optional('mode', 0)],
    ([n, s0, mode = 0]) => {
      const s = Math.abs(s0 ?? 1);
      if (s === 0 || n === 0) return 0;
      const q = quotient(n, s);
      return finish((n < 0 && mode !== 0 ? Math.floor(q) : Math.ceil(q)) * s);
    },
    '=CEILING.MATH(-4.5) gives -4',
  ),
  scalar(
    'CEILING.PRECISE',
    [number(), optional('step')],
    ([n, s0]) => {
      const s = Math.abs(s0 ?? 1);
      return s === 0 || n === 0 ? 0 : finish(Math.ceil(quotient(n, s)) * s);
    },
    '=CEILING.PRECISE(-4.1, 2) gives -4',
  ),
  scalar(
    'ISO.CEILING',
    [number(), optional('step')],
    ([n, s0]) => {
      const s = Math.abs(s0 ?? 1);
      return s === 0 || n === 0 ? 0 : finish(Math.ceil(quotient(n, s)) * s);
    },
    '=ISO.CEILING(4.3) gives 5',
  ),
  scalar(
    'FLOOR',
    [number(), optional('step')],
    ([n, s0]) => {
      const s = stepFor(n, s0);
      if (s === 0) return n === 0 ? 0 : err('DIV0');
      if (n > 0 && s < 0) return err('NUM');
      if (n === 0) return 0;
      // A negative number with a positive step moves away from zero, as the documentation says.
      return finish(n < 0 && s < 0 ? -Math.floor(quotient(-n, -s)) * -s : Math.floor(quotient(n, s)) * s);
    },
    '=FLOOR(3.7, 2) gives 2',
  ),
  scalar(
    'FLOOR.MATH',
    [number(), optional('step'), optional('mode', 0)],
    ([n, s0, mode = 0]) => {
      const s = Math.abs(s0 ?? 1);
      if (s === 0 || n === 0) return 0;
      const q = quotient(n, s);
      return finish((n < 0 && mode !== 0 ? Math.ceil(q) : Math.floor(q)) * s);
    },
    '=FLOOR.MATH(-5.5, 2, -1) gives -4',
  ),
  scalar(
    'FLOOR.PRECISE',
    [number(), optional('step')],
    ([n, s0]) => {
      const s = Math.abs(s0 ?? 1);
      return s === 0 || n === 0 ? 0 : finish(Math.floor(quotient(n, s)) * s);
    },
    '=FLOOR.PRECISE(-3.1) gives -4',
  ),
  scalar(
    'EVEN',
    [number()],
    ([n]) => finish(Math.sign(n) * 2 * Math.ceil(quotient(Math.abs(n), 2))),
    '=EVEN(-1) gives -2',
  ),
  scalar(
    'ODD',
    [number()],
    ([n]) => {
      const a = Math.ceil(Math.abs(n));
      return finish(Math.sign(n) * (a % 2 === 0 ? a + 1 : a) || 1);
    },
    '=ODD(2) gives 3',
  ),
  scalar(
    'QUOTIENT',
    [number('dividend'), number('divisor')],
    ([n, d]) => (d === 0 ? err('DIV0') : finish(Math.trunc(quotient(n, d)))),
    '=QUOTIENT(-10, 3) gives -3',
  ),
];

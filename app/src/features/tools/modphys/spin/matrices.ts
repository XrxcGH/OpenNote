// Typed complex matrices and the named ones: Pauli and Dirac gamma matrices (Dirac representation). An entry is a
// complex number such as 1, -0.5, 2i, -i, 1/2, or 1+2i, read by the small parser here.
import { cx, ONE, ZERO } from '../../kits/num/complex';
import type { Complex } from '../../kits/num/complex';
import { fail } from '../shared/errors';
import type { CMatrix } from './engine';

/** One real part: a number or a fraction, with an optional sign; an empty coefficient before i means 1. */
function real(text: string, allowEmpty: boolean): number {
  if (text === '' || text === '+' || text === '-') {
    if (!allowEmpty) fail('badMatrix');
    return text === '-' ? -1 : 1;
  }
  const m = /^([+-]?)(\d+\.?\d*|\.\d+)(?:e([+-]?\d+))?(?:\/(\d+\.?\d*))?$/i.exec(text);
  if (!m) fail('badMatrix');
  let value = Number(`${m[2]}${m[3] ? `e${m[3]}` : ''}`);
  if (m[4]) {
    const den = Number(m[4]);
    if (den === 0) fail('badMatrix');
    value /= den;
  }
  return m[1] === '-' ? -value : value;
}

/** A complex entry: a, bi, a+bi, or a−bi. */
export function parseComplex(raw: string): Complex {
  const text = raw.replace(/[−–]/g, '-').replace(/\s+/g, '').replace(/j/gi, 'i');
  if (text === '') fail('badMatrix');
  if (!text.endsWith('i')) return cx(real(text, false));
  const body = text.slice(0, -1);
  // The split between the parts is the last + or − that is not the leading sign or an exponent's sign.
  let split = -1;
  for (let k = body.length - 1; k > 0; k -= 1) {
    const ch = body[k];
    if ((ch === '+' || ch === '-') && !/e/i.test(body[k - 1] ?? '')) {
      split = k;
      break;
    }
  }
  if (split < 0) return cx(0, real(body, true));
  return cx(real(body.slice(0, split), false), real(body.slice(split), true));
}

/** A square matrix typed with rows on lines (or separated by ;) and entries by spaces or commas. */
export function parseMatrix(text: string): CMatrix {
  const rows = text
    .split(/\r?\n|;/)
    .map((line) => line.trim().replace(/^\[|\]$/g, ''))
    .filter(Boolean)
    .map((line) =>
      line
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(parseComplex),
    );
  const n = rows.length;
  if (n === 0 || n > 8 || rows.some((row) => row.length !== n)) fail('badMatrix');
  return rows;
}

const I = cx(0, 1);
const NI = cx(0, -1);
const M1 = cx(-1);
const PAULI: Record<'x' | 'y' | 'z', CMatrix> = {
  x: [
    [ZERO, ONE],
    [ONE, ZERO],
  ],
  y: [
    [ZERO, NI],
    [I, ZERO],
  ],
  z: [
    [ONE, ZERO],
    [ZERO, M1],
  ],
};

const block = (a: CMatrix, b: CMatrix, c: CMatrix, d: CMatrix): CMatrix => [
  ...a.map((row, i) => [...row, ...b[i]!]),
  ...c.map((row, i) => [...row, ...d[i]!]),
];
const ID2: CMatrix = [
  [ONE, ZERO],
  [ZERO, ONE],
];
const Z2: CMatrix = [
  [ZERO, ZERO],
  [ZERO, ZERO],
];
const neg = (a: CMatrix): CMatrix => a.map((row) => row.map((x) => cx(-x.re + 0, -x.im + 0)));

export const NAMED: Record<string, CMatrix> = {
  pauliX: PAULI.x,
  pauliY: PAULI.y,
  pauliZ: PAULI.z,
  gamma0: block(ID2, Z2, Z2, neg(ID2)),
  gamma1: block(Z2, PAULI.x, neg(PAULI.x), Z2),
  gamma2: block(Z2, PAULI.y, neg(PAULI.y), Z2),
  gamma3: block(Z2, PAULI.z, neg(PAULI.z), Z2),
};

export type NamedMatrix = keyof typeof NAMED;

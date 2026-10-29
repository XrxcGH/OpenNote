// The one error the kit numerics throw. Its code names a message in the kits strings (kits.error.<code>), so a tool
// can say in words what went wrong: a singular matrix, a root that is not bracketed, a value out of range.

export type NumErrorCode =
  | 'empty'
  | 'shape'
  | 'notSquare'
  | 'tooLarge'
  | 'singular'
  | 'notSymmetric'
  | 'notPositiveDefinite'
  | 'noConvergence'
  | 'noBracket'
  | 'domain'
  | 'notFinite';

export class NumError extends Error {
  constructor(
    readonly code: NumErrorCode,
    detail = '',
  ) {
    super(detail === '' ? code : `${code}: ${detail}`);
    this.name = 'NumError';
  }
}

/** Throws a NumError with `code` unless `ok`. */
export function ensure(ok: boolean, code: NumErrorCode, detail = ''): asserts ok {
  if (!ok) throw new NumError(code, detail);
}

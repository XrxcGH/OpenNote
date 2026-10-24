// The one error the subject engines throw. Its code names a message in the kitSubjects strings
// (kitSubjects.error.<code>), so a tool can say in words what went wrong, and `detail` names the input at fault.

export type SubjectErrorCode =
  | 'empty'
  | 'notFinite'
  | 'domain'
  | 'tooFew'
  | 'tooLarge'
  | 'shape'
  | 'singular'
  | 'noConvergence'
  | 'noBracket'
  | 'cycle'
  | 'cancelled';

export class SubjectError extends Error {
  constructor(
    readonly code: SubjectErrorCode,
    readonly detail = '',
  ) {
    super(detail === '' ? code : `${code}: ${detail}`);
    this.name = 'SubjectError';
  }
}

/** Throws a SubjectError with `code` unless `ok`. */
export function ensure(ok: boolean, code: SubjectErrorCode, detail = ''): asserts ok {
  if (!ok) throw new SubjectError(code, detail);
}

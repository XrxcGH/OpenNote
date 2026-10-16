// What can go wrong in an expression. The codes are for the UI to turn into words with t(); none carry text.
// They are the engine's codes (core/expr) that a calculator expression can produce.

export type CalcErrorCode =
  | 'empty'
  | 'too-long'
  | 'too-deep'
  | 'bad-character'
  | 'bad-number'
  | 'unexpected-token'
  | 'unexpected-end'
  | 'unclosed-paren'
  | 'needs-parens'
  | 'unknown-name'
  | 'arity'
  | 'domain'
  | 'divide-by-zero'
  | 'overflow';

export interface CalcError {
  code: CalcErrorCode;
  /** The index in the source text where the problem starts, or -1 if it has no place. */
  position: number;
  /** The name involved, for 'unknown-name', 'arity', and 'needs-parens'. */
  detail?: string;
}

export type CalcResult = { ok: true; value: number } | { ok: false; error: CalcError };

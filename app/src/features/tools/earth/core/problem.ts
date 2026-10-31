// What an engine says when its input cannot give an answer: a code the tool's strings word, and the values the
// message names. Engines throw it; the form shows the message where the answer would be.

export class Problem extends Error {
  constructor(
    readonly code: string,
    readonly vars: Readonly<Record<string, string | number>> = {},
  ) {
    super(code);
    this.name = 'Problem';
  }
}

/** Throws a Problem with `code` unless `ok` holds. */
export function check(ok: boolean, code: string, vars: Readonly<Record<string, string | number>> = {}): void {
  if (!ok) throw new Problem(code, vars);
}

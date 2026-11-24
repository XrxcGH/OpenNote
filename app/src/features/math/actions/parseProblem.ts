// What is wrong with an equation the actions could not read, when it is only unfinished (T3-D08-6): an operator with
// nothing after it, a bracket left open, or an equals sign with nothing on one side. Other failures stay "unsupported".
import { tryParse } from '../../../core/expr';
import { Unsupported, latexToText } from './convert';

export type ParseProblem = 'unfinished' | 'unclosed' | 'emptySide';

/** The end of the text, to say where the problem is. */
const nearEnd = (latex: string): string => {
  const text = latex.trim();
  return text.length > 12 ? `\u2026${text.slice(-12)}` : text;
};

function firstProblem(latex: string): ParseProblem | null {
  if (latex.trim() === '') return 'emptySide';
  try {
    const parsed = tryParse(latexToText(latex));
    if (parsed.ok) return null;
    const { code } = parsed.error;
    if (code === 'unexpected-end') return 'unfinished';
    // An operator against a closing bracket or equals sign has nothing after it: the editor closes brackets as one
    // types, so "(2+" arrives as "(2+)".
    const { detail, expected } = parsed.error;
    if (code === 'unexpected-token' && expected === 'operand' && [')', ']', '}', '='].includes(detail ?? '')) {
      return 'unfinished';
    }
    return code === 'unclosed-paren' || code === 'unclosed-bracket' ? 'unclosed' : null;
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

/** The problem with an unreadable equation, whose sides are given (the one place of its equals sign, or -1). */
export function parseProblem(latex: string, equalsAt: number): { reason: ParseProblem; near: string } | null {
  const sides = equalsAt < 0 ? [latex] : [latex.slice(0, equalsAt), latex.slice(equalsAt + 1)];
  for (const side of sides) {
    const reason = firstProblem(side);
    if (reason) return { reason, near: nearEnd(reason === 'emptySide' ? latex : side) };
  }
  return null;
}

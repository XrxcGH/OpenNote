// Solving a tool of the chemistry and materials kit for the window.
import './text';
import { hasNonFinite, isRangeError } from '../../../core/finite';
import type { Input, ToolSpec } from './spec';
import type { Outcome } from './types';

/**
 * Solves a tool. An absurd input (1e12 of anything) becomes the named problem "out of range".
 * A NaN or infinite number in a row or a plot is never shown (an equilibrium constant of Infinity).
 * A RangeError from an array sized by the input is not a crash, and a slip in a tool reads as a problem.
 */
export function solveChecked(spec: Pick<ToolSpec, 'solve'>, input: Input): Outcome {
  try {
    const outcome = spec.solve(input);
    if (outcome.ok && hasNonFinite([outcome.rows, outcome.plot?.series])) {
      return { ok: false, key: 'kitChemMat.err.outOfRange' };
    }
    return outcome;
  } catch (error) {
    return { ok: false, key: isRangeError(error) ? 'kitChemMat.err.outOfRange' : 'kitChemMat.err.unexpected' };
  }
}

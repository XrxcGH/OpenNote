// What an engine says when an input is impossible. Engines hold no interface text: they throw a rule and the
// quantity it applies to (or a problem name), and the window turns that into a sentence from the strings.

/** Rules on one quantity. Each message names the quantity. */
export type Rule =
  'positive' | 'nonNegative' | 'integer' | 'fraction' | 'tooLarge' | 'notNumber' | 'empty' | 'atLeastOne';

/** Problems that are not about one quantity. */
export type Problem =
  | 'noBoundState'
  | 'noConvergence'
  | 'aboveBarrier'
  | 'belowBarrier'
  | 'badPotential'
  | 'badGrid'
  | 'badQuantumNumbers'
  | 'badSpin'
  | 'badConfiguration'
  | 'badFormula'
  | 'unknownElement'
  | 'badCouplings'
  | 'badCircuit'
  | 'badMatrix'
  | 'badList'
  | 'badDate'
  | 'neverRises'
  | 'neverSets'
  | 'badCosmology'
  | 'notBound'
  | 'saturated'
  | 'belowSurface'
  | 'noTransit'
  | 'outsideFit'
  | 'badBand'
  | 'noComponent'
  | 'badMagnitude';

export class PhysicsError extends Error {
  constructor(
    readonly rule: Rule | null,
    readonly quantity: string,
    readonly problem: Problem | null = null,
  ) {
    super(problem ?? `${rule}:${quantity}`);
    this.name = 'PhysicsError';
  }
}

/** Throws: the quantity breaks the rule. */
export function need(rule: Rule, quantity: string): never {
  throw new PhysicsError(rule, quantity);
}

/** Throws: the inputs have this problem. */
export function fail(problem: Problem): never {
  throw new PhysicsError(null, '', problem);
}

/** Checks a finite value greater than zero and returns it. */
export function positive(value: number, quantity: string): number {
  if (!Number.isFinite(value)) need('notNumber', quantity);
  if (!(value > 0)) need('positive', quantity);
  return value;
}

/** Checks a finite value of zero or more and returns it. */
export function nonNegative(value: number, quantity: string): number {
  if (!Number.isFinite(value)) need('notNumber', quantity);
  if (!(value >= 0)) need('nonNegative', quantity);
  return value;
}

/** Checks a whole number at least `min` and returns it. */
export function whole(value: number, quantity: string, min = 0): number {
  if (!Number.isFinite(value)) need('notNumber', quantity);
  if (!Number.isInteger(value)) need('integer', quantity);
  if (value < min) need(min > 0 ? 'positive' : 'nonNegative', quantity);
  return value;
}

/** Checks a value from 0 to 1 and returns it. */
export function fraction(value: number, quantity: string): number {
  if (!Number.isFinite(value)) need('notNumber', quantity);
  if (value < 0 || value > 1) need('fraction', quantity);
  return value;
}

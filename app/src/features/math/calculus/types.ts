// The shapes the calculus tools share: a step of working with the rule it uses, and the steps inside it.

/** Each rule has a name and a sentence in strings/en/mathTools.ts (mathTools.steps.rules). */
export type StepRule =
  // Derivatives
  | 'constant'
  | 'variable'
  | 'sum'
  | 'constantMultiple'
  | 'product'
  | 'quotient'
  | 'power'
  | 'chain'
  | 'exponential'
  | 'trig'
  | 'inverseTrig'
  | 'hyperbolic'
  | 'logarithm'
  | 'root'
  | 'function'
  | 'generalPower'
  | 'higherOrder'
  | 'partial'
  | 'evaluateAt'
  | 'simplify'
  // Integrals
  | 'reciprocal'
  | 'linear'
  | 'expand'
  | 'longDivision'
  | 'partialFractions'
  | 'completeSquare'
  | 'substitution'
  | 'backSubstitute'
  | 'parts'
  | 'partsCyclic'
  | 'powerReduction'
  | 'pythagorean'
  | 'productToSum'
  | 'trigIdentity'
  | 'evaluate'
  | 'improper'
  | 'numeric'
  | 'constantOfIntegration'
  // Limits
  | 'directSubstitution'
  | 'lhopital'
  | 'limitAtInfinity'
  | 'limitNumeric'
  | 'oneSided'
  // Sums
  | 'finiteSum'
  | 'geometric'
  | 'knownSeries'
  | 'seriesNumeric';

export interface Step {
  rule: StepRule;
  /** The step as LaTeX, such as \frac{d}{dx}\left[x^{2}\right] = 2x. */
  latex: string;
  /** What the rule is applied with, as LaTeX, such as u = x^{2},\ du = 2x\,dx. */
  note?: string;
  /** The working inside this step, shown when the step is opened. */
  children?: Step[];
}

export type CalculusKind = 'derivative' | 'integral' | 'limit' | 'sum';

/** Why there is no answer. Each has a calm sentence in mathTools.steps.reasons. */
export type NoAnswer =
  'unsupported' | 'letters' | 'notInTable' | 'diverges' | 'noLimit' | 'undefinedOnInterval' | 'tooLarge';

/** An answer: the right side of the equation, as LaTeX and as plain text. */
export interface Answer {
  latex: string;
  text: string;
}

export type Solved =
  | { ok: true; kind: CalculusKind; answer: Answer; steps: Step[] }
  | { ok: false; kind: CalculusKind; reason: NoAnswer; steps: Step[] };

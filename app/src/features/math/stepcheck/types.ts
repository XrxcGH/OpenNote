// The shapes of Check my work: a line of worked math in, one result per line out. The AI tutor and the page both use
// these, so they stay stable. Reasons are codes, never sentences: strings/en/stepCheck.ts has the words.

/** One line of worked math: typed text, or LaTeX (an equation, or handwriting read as math). */
export interface StepLine {
  text: string;
  format?: 'text' | 'latex';
}

/** What a step's check found. Precision comes first: a step that cannot be checked is 'unchecked', never 'broken'. */
export type Verdict = 'ok' | 'broken' | 'unchecked';

/** How a step was checked. */
export type Method =
  /** The first line, a definition, a substitution, or a note: nothing to check. */
  | 'given'
  /** The two forms multiply out to the same thing. */
  | 'symbolic'
  /** The two sides were compared at seeded sample points: "consistent at sample points". */
  | 'numeric'
  /** The solutions of the two lines were found and compared. */
  | 'solutions'
  /** The equations solved together, and this line checked at their solution. */
  | 'system'
  /** An antiderivative, checked by differentiating back. */
  | 'derivative'
  /** A value worked out: a definite integral, a limit, a sum, or plain numbers. */
  | 'evaluation'
  /** Quantities with units: converted first, then compared. */
  | 'units'
  /** Matrices and vectors, worked out entry by entry. */
  | 'matrix'
  /** Inequalities, compared at many points on both sides of their boundaries. */
  | 'sampling'
  /** Nothing could be checked. */
  | 'none';

/** Why a step got its verdict. Each code has a sentence in strings/en/stepCheck.ts (stepCheck.reasons). */
export type ReasonCode =
  // ok
  | 'start'
  | 'definition'
  | 'substitution'
  | 'note'
  | 'equivalent'
  | 'sampleConsistent'
  | 'sameSolutions'
  | 'addsSolutions'
  | 'followsSystem'
  /** Another equation of a system, written on its own line: the lines after are checked against all of them. */
  | 'systemEquation'
  | 'oneRoot'
  | 'knownValue'
  /** r = 2 after A = πr^2: values given for some of the formula's letters. */
  | 'givenValue'
  /** a = 1, b = -3, c = 2 after x^2 - 3x + 2 = 0: the quadratic formula's numbers. */
  | 'coefficients'
  /** v = 0 + 2 × 5 after v = u + at: the line before with numbers put in for its letters. */
  | 'valuesPutIn'
  | 'antiderivative'
  /** Right, but the + C of an indefinite integral is missing: a note, not a slip. */
  | 'missingConstant'
  | 'sameValue'
  /** A decimal that is the value before it, rounded (or cut short) to the places shown. */
  | 'rounded'
  | 'sameQuantity'
  | 'sameMatrix'
  | 'sameInequality'
  | 'followsPrevious'
  // broken
  | 'signMoved'
  | 'signFlipped'
  | 'inequalityFlip'
  | 'factorOff'
  /** (x - 3)(x - 3) = 0 after x^2 - 9 = 0: a factoring that does not multiply out to the line before. */
  | 'factoringOff'
  /** lim (2xh + h^2)/h, then lim (2x + h^2): the bodies inside the same limit are not the same. */
  | 'limitBody'
  | 'constantOff'
  | 'notEqual'
  | 'differentSolutions'
  | 'notAtSolution'
  | 'derivativeOff'
  | 'antiderivativeOff'
  | 'valueOff'
  | 'unitsAdd'
  | 'unitKind'
  | 'unitValue'
  | 'matrixEntry'
  | 'matrixShape'
  | 'inequalitySet'
  // unchecked
  | 'unreadable'
  | 'notMath'
  | 'someValues'
  /** 2(x - 3) = 2x - 3: the sides are the same amount apart for every value. */
  | 'neverEqual'
  | 'lostSolutions'
  | 'noRealSolutions'
  | 'cannotDecide'
  | 'cannotEvaluate'
  | 'unrelated'
  /** 1/2x: a slash before a product, which reads as (1/2)x or 1/(2x), and the line is right in neither. */
  | 'ambiguous'
  /** i^2 = -1: complex numbers, not checked yet. */
  | 'complexNumbers'
  /** A solution that an earlier line does not allow, as x = 1 after dividing by x - 1. */
  | 'outsideDomain'
  | 'tooLong';

/** One step's result. `index` is the line's place in the list given to checkSteps. */
export interface StepResult {
  index: number;
  verdict: Verdict;
  reason: ReasonCode;
  /** Values for the reason's sentence, such as { term: '3' } or { at: 'x = 2' }. Math only, never words. */
  params: Readonly<Record<string, string>>;
  /** A corrected line, as plain math text, when one can be worked out. */
  suggestion?: string;
  method: Method;
  /** How sure the check is, from 0 to 1. Symbolic checks are 1; sample points a little less. */
  confidence: number;
}

export interface CheckOptions {
  /** The seed for the sample points, so a check gives the same answer every time. Default 20261028. */
  seed?: number;
  /** How many lines at most. Later lines are left unchecked. Default 200. */
  maxLines?: number;
  /** How long one check may take in all, in milliseconds. Later lines are left unchecked. Default 4000. */
  budgetMs?: number;
}

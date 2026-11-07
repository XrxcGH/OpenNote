// Test cases and results (DESIGN 9, ADR 0075). Lane code:L15 writes the comparators, the harnesses, and the
// Tests panel. Cases are stored in the project's `tests` object, keyed by ID.

export const TEST_KINDS = ['io', 'call', 'sql', 'framework'] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const COMPARE_MODES = ['exact', 'trim', 'tokens', 'number', 'lines-unordered', 'regex'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/** The `number` mode's default tolerance, and a case's default time limit. */
export const TEST_DEFAULTS = { tolerance: 1e-6, timeMs: 2000 } as const;

/**
 * How actual output is compared with `expected`. `number` passes when the absolute or relative error is within
 * the tolerance; `regex` reads `expected` as the pattern.
 */
export type CompareSpec =
  | { mode: 'exact' }
  | { mode: 'trim' }
  | { mode: 'tokens' }
  | { mode: 'number'; tolerance?: number; relative?: boolean }
  | { mode: 'lines-unordered' }
  | { mode: 'regex' };

/**
 * One test case, by kind:
 * - `io` runs the program with `stdin` and `args`.
 * - `call` calls `fn` with `callArgs`, the JSON text of an argument array.
 * - `sql` runs the query and compares result sets, in order when `rowsOrdered` is true.
 * - `framework` cases are found in the code and not stored.
 */
export interface TestCase {
  id: string;
  name: string;
  kind: TestKind;
  stdin?: string;
  args?: string[];
  fn?: string;
  callArgs?: string;
  expected: string;
  compare: CompareSpec;
  rowsOrdered?: boolean;
  timeMs?: number;
  order: number;
}

/** "time" is "Time limit exceeded" at the case's limit. */
export type TestStatus = 'pass' | 'fail' | 'error' | 'time' | 'skipped';

/** One result, sent by the worker as a `test` message. Framework tests carry their own ID and name. */
export interface TestResult {
  id: string;
  name: string;
  status: TestStatus;
  timeMs: number;
  expected?: string;
  actual?: string;
  message?: string;
  /** Where an assertion failed, by project path and line. */
  location?: { file: string; line: number };
}

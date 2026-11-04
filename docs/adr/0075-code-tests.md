# ADR 0075: Test cases stored with projects, with judge-style comparisons

- Status: Proposed
- Date: 2026-11-01

## Context

The owner wants people to test code. LeetCode and Programiz-style practice compares a program's output or a function's result with expected values; IDEs run unit test frameworks. In-app runtimes differ: Pyodide has `unittest` and can load `pytest`; QuickJS has no test framework; C and C++ have `assert`; SQL compares result sets.

## Decision

We will store test cases in the project's `tests` object (ADR 0069) as `io`, `call`, `sql` or `framework` cases, compared by `exact`, `trim`, `tokens`, `number` (absolute or relative error within a tolerance, default 1e-6), `lines-unordered` or `regex`, each with a time limit (default 2 s). For JavaScript and TypeScript we will inject a Jest-compatible subset (`describe`, `it`, `test`, hooks, `expect` with the common matchers and `.not`) whose results match Jest's documented semantics. Python uses `unittest`, and `pytest` from the full runtime's package set. Tier-2 languages report through their own frameworks.

## Options considered

| Option | For | Against |
|---|---|---|
| Judge-style cases plus framework adapters (chosen) | Works for beginners and for unit tests; results are deterministic | A Jest subset is not all of Jest |
| Frameworks only | Familiar to developers | Beginners and practice problems want input and expected output |
| Expected output only | Simple | No function-level or unit tests |

## Consequences

- Easier: practice problems with tests in notes; the model can propose tests into the same model; tests sync and export with projects.
- Harder: the generated `call` harness must convert values between JSON and each language faithfully (known-answer tests for nested lists, floats, `None` and `null`).
- Follow-up: comparator tests, Jest-semantics tests (`toBeCloseTo`, `toEqual` against `toStrictEqual`), the `unittest` adapter, SQL result set comparison, Tests panel UI tests.
- Revisit if people want coverage or property-based tests.

# ADR 0075: Test cases stored with projects, with judge-style comparisons

- Status: Accepted
- Date: 2026-11-01

## Context

The owner wants people to test code. LeetCode and Programiz-style practice compares a program's output or a function's result with expected values; IDEs run unit test frameworks. In-app runtimes differ: Pyodide has `unittest` and can load `pytest`; QuickJS has no test framework; C and C++ have `assert`; SQL compares result sets.

## Decision

We will store test cases in the project's `tests` object (ADR 0069) as `io`, `call`, `sql` or `framework` cases, compared by `exact`, `trim`, `tokens`, `number` (absolute or relative error within a tolerance, default 1e-6), `lines-unordered` or `regex`, each with a time limit (default 2 s). For JavaScript and TypeScript we will inject a Jest-compatible subset (`describe`, `it`, `test`, hooks, `expect` with the common matchers and `.not`) whose results match Jest's documented semantics. Python uses `unittest`, and `pytest` from the full runtime's package set. Tier-2 languages report through their own frameworks.

### How it works

- Each stored case is one run of the program with its own time limit. A case that runs out of time shows "Time limit exceeded" with its limit. The cases run one after the other, and each result reaches the panel as soon as it is known.
- A `call` case never changes the user's file. For Python, a harness file next to the main file becomes the main file. It runs the user's file under another module name, so an `if __name__ == "__main__"` block does not run and line numbers stay the same. For JavaScript, TypeScript, and Lua, the harness is appended after the file's text. Every harness reads the arguments as JSON, calls the function, and prints one marker line with the result as JSON. Other output is shown as usual.
- `number` mode follows the rule judges document: a number is right when its absolute or its relative error is within the tolerance. Words that are not numbers must be equal.
- A `call` result is compared as a JSON value, so spacing and key order do not matter. `sql` results are compared as CSV: the column names must match, and the rows match in order or as a set.
- Python `unittest` runs through a harness that sends one marker line per test, in the order the loader finds them. Quick Python has no `unittest` and says so. JavaScript and TypeScript use the test API of the runtime. C and C++ report a failed `assert` with its file and line, read from the error output in the glibc, musl, wasi-libc, and BSD formats.
- `pytest` through `junitxml` and the gutter markers are R2.

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

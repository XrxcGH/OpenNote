// Running the language's own framework tests (DESIGN 9.2) and sending each result as it is known.
import { t } from '../../../strings/t';
import type { TestResult } from '../contracts';
import type { RunCallbacks, RunHandle, RunOrder, RunResult } from '../run/host';
import type { Runner } from '../window/runner';
import { hasFrameworkTests, parseAssertFailures, readTestResults, unittestHarness } from './frameworks';
import { capture, lastErrorLine } from './capture';

const NO_INPUT = { mode: 'prefilled', text: '' } as const;

const problem = (name: string, message: string, timeMs: number): TestResult => ({
  id: `framework::${name}`,
  name,
  status: 'error',
  timeMs,
  message,
});

/** Python's `unittest`: one result per test, in discovery order. Quick Python has no `unittest`; it says so. */
async function python(base: Runner, order: RunOrder, hold: (handle: RunHandle) => void, on: RunCallbacks) {
  if (order.runtime === 'python-quick') {
    on.onTest?.(problem('unittest', t('codeStudio.testing.needsFullPython'), 0));
    return null;
  }
  const harness = unittestHarness(order.files, order.main);
  const run: RunOrder = {
    ...order,
    files: [...order.files, harness],
    main: harness.path,
    args: [],
    stdin: NO_INPUT,
  };
  delete run.test;
  const got = await capture(base, run, hold);
  if (got.result.status === 'failed') return got.result;
  const results = readTestResults(got.out);
  for (const one of results) on.onTest?.(one);
  const time = Math.round(got.result.elapsedMs);
  if (got.result.status === 'time')
    on.onTest?.(problem('unittest', t('codeStudio.testing.timeLimit', { seconds: order.limits.timeMs / 1000 }), time));
  else if (results.length === 0 && got.result.status === 'error')
    on.onTest?.(problem('unittest', lastErrorLine(got.err) || got.result.message, time));
  return got.result;
}

/** The program's `assert` calls: a failed one is a failed test with its file and line. */
async function clike(base: Runner, order: RunOrder, hold: (handle: RunHandle) => void, on: RunCallbacks) {
  const run: RunOrder = { ...order, stdin: NO_INPUT };
  delete run.test;
  const got = await capture(base, run, hold);
  if (got.result.status === 'failed') return got.result;
  const timeMs = Math.round(got.result.elapsedMs);
  const failed = parseAssertFailures(got.err);
  if (failed.length > 0) {
    failed.forEach((one, at) =>
      on.onTest?.({
        id: `framework::assert-${at + 1}`,
        name: t('codeStudio.testing.assertName', { number: at + 1 }),
        status: 'fail',
        timeMs,
        message: t('codeStudio.testing.assertFailed', { expression: one.expression }),
        location: { file: one.file, line: one.line },
      }),
    );
  } else if (got.result.status === 'ok') {
    on.onTest?.({ id: 'framework::asserts', name: t('codeStudio.testing.assertsPass'), status: 'pass', timeMs });
  } else if (got.result.status === 'time') {
    on.onTest?.(
      problem(
        t('codeStudio.testing.assertsName'),
        t('codeStudio.testing.timeLimit', { seconds: order.limits.timeMs / 1000 }),
        timeMs,
      ),
    );
  } else {
    on.onTest?.(problem(t('codeStudio.testing.assertsName'), lastErrorLine(got.err) || got.result.message, timeMs));
  }
  return got.result;
}

/**
 * Runs the framework tests the project holds, or nothing (null) when it holds none or the language has no adapter.
 * JavaScript and TypeScript run by the run protocol's own `test` request, which the runtime of code:L06 answers.
 */
export async function frameworkRun(
  base: Runner,
  order: RunOrder,
  hold: (handle: RunHandle) => void,
  on: RunCallbacks,
): Promise<RunResult | null> {
  if (!hasFrameworkTests(order.runtime, order.files)) return null;
  switch (order.runtime) {
    case 'python-full':
    case 'python-quick':
      return python(base, order, hold, on);
    case 'javascript':
    case 'typescript': {
      const run: RunOrder = { ...order, stdin: NO_INPUT, test: { cases: [], framework: true } };
      return (await capture(base, run, hold, { onTest: on.onTest })).result;
    }
    case 'c':
    case 'cpp':
      return clike(base, order, hold, on);
    default:
      return null;
  }
}

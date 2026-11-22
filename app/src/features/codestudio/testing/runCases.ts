// Running a project's tests (DESIGN 9). Each stored case is one run of the program with its own time limit. Then
// come the language's own framework tests. `withTests` wraps the studio's runner. An order without `test` runs as it
// is. An order with `test` runs the cases and the framework, and each result goes to `onTest` as it is known.
import { t } from '../../../strings/t';
import { TEST_DEFAULTS } from '../contracts';
import type { RunFile, RunLimits, TestCase, TestResult } from '../contracts';
import type { RunHandle, RunOrder, RunResult } from '../run/host';
import type { Runner } from '../window/runner';
import { compareJson, compareText, showJson } from './compare';
import type { Comparison } from './compare';
import { capture, lastErrorLine } from './capture';
import { frameworkRun } from './frameworkRun';
import { buildCall, isCallable, lastCallResult, parseCallArgs } from './harness';
import { compareResultSets } from './resultSets';

export const limitFor = (test: TestCase, limits: RunLimits): number =>
  Math.min(test.timeMs ?? TEST_DEFAULTS.timeMs, limits.timeMs);

function verdict(test: TestCase, actual: string, got: Comparison): TestResult {
  const base = { id: test.id, name: test.name, timeMs: 0, expected: test.expected, actual };
  if (got.pass) return { ...base, status: 'pass' };
  return got.reason === 'badPattern'
    ? { ...base, status: 'fail', message: t('codeStudio.testing.badPattern') }
    : { ...base, status: 'fail' };
}

function failure(test: TestCase, message: string, extra: Partial<TestResult> = {}): TestResult {
  return { id: test.id, name: test.name, status: 'error', timeMs: 0, expected: test.expected, message, ...extra };
}

/** The files and main file a case runs (Python's `call` harness is a file of its own and becomes the main file). */
function filesFor(order: RunOrder, test: TestCase): { files: RunFile[]; main: string } | string {
  if (test.kind !== 'call') return { files: order.files, main: order.main };
  const main = order.files.find((file) => file.path === order.main);
  if (!main) return t('codeStudio.testing.noMain');
  if (!isCallable(test.fn ?? '')) return t('codeStudio.testing.badFunction', { name: test.fn ?? '' });
  if (!parseCallArgs(test.callArgs ?? '')) return t('codeStudio.testing.badArguments');
  const built = buildCall({
    runtime: order.runtime,
    path: main.path,
    text: main.text,
    fn: test.fn ?? '',
    callArgs: test.callArgs ?? '',
  });
  if (!built) return t('codeStudio.testing.callUnsupported');
  const files = order.files.map((file) => (file.path === main.path ? { ...file, text: built.text } : file));
  if (!built.extra) return { files, main: main.path };
  return { files: [...files, built.extra], main: built.extra.path };
}

/** One stored case, run to its end. */
export async function runCase(
  runner: Runner,
  order: RunOrder,
  test: TestCase,
  current: (handle: RunHandle) => void,
): Promise<TestResult | 'stopped' | RunResult> {
  const plan = filesFor(order, test);
  if (typeof plan === 'string') return failure(test, plan);
  const timeMs = limitFor(test, order.limits);
  const run: RunOrder = {
    ...order,
    ...plan,
    args: test.kind === 'io' ? (test.args ?? []) : [],
    stdin: { mode: 'prefilled', text: test.stdin ?? '' },
    limits: { ...order.limits, timeMs },
  };
  delete run.test;
  const got = await capture(runner, run, current);
  const { result } = got;
  const timed = { timeMs: Math.round(result.elapsedMs) };
  if (result.status === 'stopped') return 'stopped';
  if (result.status === 'failed') return result;
  if (result.status === 'time')
    return failure(test, t('codeStudio.testing.timeLimit', { seconds: timeMs / 1000 }), { ...timed, status: 'time' });
  if (result.status === 'memory') return failure(test, t('codeStudio.testing.memory'), timed);
  if (result.status === 'error') return failure(test, lastErrorLine(got.err) || result.message, timed);
  let one: TestResult;
  if (test.kind === 'call') {
    const printed = lastCallResult(got.out);
    if (printed === null) return failure(test, t('codeStudio.testing.noResult'), timed);
    const actual = showJson(printed);
    one = verdict(
      { ...test, expected: showJson(test.expected) },
      actual,
      compareJson(printed, test.expected, test.compare),
    );
  } else if (test.kind === 'sql') {
    const csv = got.csv ?? got.out;
    one = verdict(test, csv, compareResultSets(csv, test.expected, test.rowsOrdered ?? false, test.compare));
  } else {
    one = verdict(test, got.out, compareText(got.out, test.expected, test.compare));
  }
  return { ...one, ...timed };
}

const total = (sum: number, result: RunResult) => sum + result.elapsedMs;

/** A runner that runs the test cases and the framework tests of an order that has `test`. */
export function withTests(base: Runner): Runner {
  return {
    ...(base.warm ? { warm: base.warm.bind(base) } : {}),
    run(order, callbacks) {
      if (!order.test) return base.run(order, callbacks);
      let current: RunHandle | null = null;
      let stopped = false;
      const hold = (handle: RunHandle) => (current = handle);
      const done = (async (): Promise<RunResult> => {
        const results: RunResult[] = [];
        callbacks.onStarted?.();
        for (const test of order.test!.cases) {
          if (stopped) break;
          const one = await runCase(base, order, test, hold);
          if (one === 'stopped') break;
          if ('elapsedMs' in one) return one;
          callbacks.onTest?.(one);
        }
        if (!stopped && order.test!.framework) {
          const ran = await frameworkRun(base, order, hold, callbacks);
          if (ran?.status === 'failed') return ran;
          if (ran) results.push(ran);
        }
        const status = stopped ? 'stopped' : 'ok';
        return { status, message: '', elapsedMs: results.reduce(total, 0), written: [], notes: [] };
      })();
      return {
        stop: () => {
          stopped = true;
          current?.stop();
        },
        input: (text) => current?.input(text),
        eof: () => current?.eof(),
        done,
      };
    },
  };
}

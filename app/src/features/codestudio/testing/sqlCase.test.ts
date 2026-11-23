// A sql case compares the rows the SQL runtime shows. That runtime sends them as its table
// (application/vnd.opennote.table+json, runtimes/sql/engine.ts), not as CSV, so the runner turns the table into CSV.
import { describe, expect, it } from 'vitest';
import type { TestCase, TestResult } from '../contracts';
import type { RunHandle, RunOrder, RunResult } from '../run/host';
import { RUN_LIMITS } from '../run/protocol';
import type { Runner } from '../window/runner';
import { withTests } from './runCases';

/** A runner that shows one table and a summary line, as the SQL runtime does for a query. */
const tableRunner = (columns: string[], rows: unknown[][]): Runner => ({
  run(_order, callbacks): RunHandle {
    callbacks.onRich?.('application/vnd.opennote.table+json', JSON.stringify({ columns, rows }));
    callbacks.onOutput?.('out', `${rows.length} rows\n`);
    const done: Promise<RunResult> = Promise.resolve({
      status: 'ok',
      message: '',
      elapsedMs: 1,
      written: [],
      notes: [],
    });
    return { stop: () => undefined, input: () => undefined, eof: () => undefined, done };
  },
});

const order: RunOrder = {
  runtime: 'sql',
  files: [{ path: 'main.sql', text: 'SELECT n, n * n AS sq FROM t;' }],
  main: 'main.sql',
  args: [],
  stdin: { mode: 'prefilled', text: '' },
  limits: RUN_LIMITS,
  seed: 1,
};

const sqlCase = (expected: string, rowsOrdered: boolean): TestCase => ({
  id: 'squares',
  name: 'squares',
  kind: 'sql',
  expected,
  rowsOrdered,
  compare: { mode: 'exact' },
  order: 0,
});

async function run(runner: Runner, test: TestCase): Promise<TestResult> {
  const results: TestResult[] = [];
  const handle = withTests(runner).run(
    { ...order, test: { cases: [test], framework: false } },
    { onTest: (one) => results.push(one) },
  );
  await handle.done;
  expect(results).toHaveLength(1);
  return results[0]!;
}

describe('sql cases with the SQL runtime table', () => {
  const runner = tableRunner(
    ['n', 'sq'],
    [
      [3, 9],
      [1, 1],
      [2, 4],
    ],
  );

  it('passes when the rows match as a set', async () => {
    expect((await run(runner, sqlCase('n,sq\n1,1\n2,4\n3,9', false))).status).toBe('pass');
  });

  it('fails when the rows must be in order and are not', async () => {
    expect((await run(runner, sqlCase('n,sq\n1,1\n2,4\n3,9', true))).status).toBe('fail');
  });

  it('keeps a NULL cell empty', async () => {
    const withNull = tableRunner(['name'], [['Ada'], [null]]);
    expect((await run(withNull, sqlCase('name\nAda\n', true))).status).toBe('fail');
    expect((await run(withNull, sqlCase('name\nAda\n""', true))).status).toBe('pass');
  });
});

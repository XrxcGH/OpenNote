// Running a program to its end and collecting what it printed, for the test runners.
import type { RunCallbacks, RunHandle, RunOrder, RunResult } from '../run/host';
import type { Runner } from '../window/runner';

/** What one program run printed and how it ended. */
export interface Captured {
  out: string;
  err: string;
  csv: string | null;
  result: RunResult;
}

/** Runs `order` to its end and collects its output. `current` receives the handle so Stop can end it. */
export function capture(
  runner: Runner,
  order: RunOrder,
  current: (handle: RunHandle) => void,
  forward?: Pick<RunCallbacks, 'onStarted' | 'onTest'>,
): Promise<Captured> {
  const got = { out: '', err: '', csv: null as string | null };
  const handle = runner.run(order, {
    ...forward,
    onOutput: (stream, text) => {
      if (stream === 'out') got.out += text;
      else got.err += text;
    },
    onRich: (mime, data) => {
      if (mime === 'text/csv') got.csv = data;
    },
  });
  current(handle);
  return handle.done.then((result) => ({ ...got, result }));
}

/** The last non-blank line of error output, which names the error ("ValueError: boom"). */
export function lastErrorLine(err: string): string {
  const lines = err.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.at(-1)?.trim() ?? '';
}

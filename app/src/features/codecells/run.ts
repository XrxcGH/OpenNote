// Runs one code cell through the run core (features/codestudio/run): one shared RunHost keeps a warm worker for the
// active runtime, gives each run a fresh locked-down worker, and enforces the time, memory, and output limits.
// The page reads nothing from a worker but checked text.
import { loadRunCore } from '../codestudio';
import type { RunHost, RunStatus, Stream } from '../codestudio';
import { FILE_NAMES, LIMITS, runtimeOf } from './model';
import type { CodeLanguage, Limits, PythonEngine } from './model';

export interface RunResult {
  status: RunStatus;
  /** For "error", the error's type when the runtime gives one; for "failed", what failed. */
  message: string;
  /** Running time in milliseconds, from when the runtime was ready. */
  elapsedMs: number;
  truncated: boolean;
}

export interface RunHandle {
  stop(): void;
  done: Promise<RunResult>;
}

let hosting: Promise<RunHost> | null = null;

/** The one run host of code cells, created on the first run. */
function host(): Promise<RunHost> {
  hosting ??= loadRunCore().then((run) => new run.RunHost({ limits: LIMITS }));
  return hosting;
}

/** A table a query returns, as tab-separated lines, so the cell's text output shows the values. */
function tableText(mime: string, data: string, onOutput: (stream: Stream, text: string) => void): void {
  if (mime !== 'application/vnd.opennote.table+json') return;
  try {
    const table = JSON.parse(data) as { columns?: unknown[]; rows?: unknown[][] };
    const line = (cells: unknown[]) => `${cells.map((cell) => String(cell ?? '')).join('\t')}\n`;
    onOutput('out', [table.columns ?? [], ...(table.rows ?? [])].map(line).join(''));
  } catch {
    // A table that does not parse is left to the summary line.
  }
}

export function runCode(
  language: CodeLanguage,
  source: string,
  onOutput: (stream: Stream, text: string) => void,
  limits: Limits = LIMITS,
  onStarted: () => void = () => undefined,
  engine?: PythonEngine,
): RunHandle {
  let stop: () => void = () => undefined;
  let stopped = false;
  const done = host().then(async (one): Promise<RunResult> => {
    const main = FILE_NAMES[language];
    const handle = one.run(
      {
        runtime: runtimeOf(language, engine),
        files: [{ path: main, text: source }],
        main,
        args: [],
        stdin: { mode: 'prefilled', text: '' },
        limits,
        seed: (Date.now() % 0xffffffff) + 1,
      },
      { onStarted, onOutput, onRich: (mime, data) => tableText(mime, data, onOutput) },
    );
    stop = () => handle.stop();
    if (stopped) handle.stop();
    const result = await handle.done;
    return {
      status: result.status,
      message: result.message,
      elapsedMs: result.elapsedMs,
      truncated: result.notes.includes('output-cut'),
    };
  });
  return {
    stop: () => {
      stopped = true;
      stop();
    },
    done,
  };
}

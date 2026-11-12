// Runs the C and C++ adapters in Node for cpp.test.ts, as the run worker would (serve.ts) but without a worker. It
// uses the run core's own mount, input, and seeded random source. clang comes from the npm package the pack pins.

import type { RunFile, RunLimits, RunStatus, RuntimeDiagnostic, WorkerMessage } from '../../../contracts/run';
import { mapDiagnostics } from '../../../run/diagnostics';
import { Mount } from '../../../run/mount';
import { RUN_LIMITS } from '../../../run/protocol';
import { seeded } from '../../../run/random';
import { Stdin } from '../../../run/stdin';
import { clangAdapter, type ClangAdapter } from '../adapter';
import { Clang, type ClangModule } from '../clang';
import type { ClangLanguage } from '../flags';

export const clang = new Clang(() => import('@yowasp/clang') as unknown as Promise<ClangModule>);
export const adapters: Record<ClangLanguage, ClangAdapter> = {
  c: clangAdapter('c', clang),
  cpp: clangAdapter('cpp', clang),
};

export interface Ran {
  status: RunStatus;
  exitCode?: number;
  message: string;
  /** The program's own standard output. */
  out: string;
  /** Everything in the error stream: the compile phase's lines, clang's messages, then the program's. */
  err: string;
  written: RunFile[];
  diagnostics: RuntimeDiagnostic[];
  inputEnded: boolean;
  /** Whether the program ran (the compile step worked). */
  ran: boolean;
}

export interface More {
  stdin?: string;
  args?: string[];
  seed?: number;
  limits?: Partial<RunLimits>;
}

/** Compiles and runs `files` (the first is the main file) as the worker does. */
export async function run(language: ClangLanguage, files: RunFile[], more: More = {}): Promise<Ran> {
  const adapter = adapters[language];
  await adapter.load(() => {});
  const limits = { ...RUN_LIMITS, ...more.limits };
  const request = {
    kind: 'run' as const,
    runtime: language,
    files,
    main: files[0]!.path,
    args: more.args ?? [],
    stdin: { mode: 'prefilled' as const, text: more.stdin ?? '' },
    limits,
    seed: more.seed ?? 1,
  };
  let out = '';
  let err = '';
  const emit = (message: WorkerMessage) => {
    if (message.kind !== 'out') return;
    if (message.stream === 'out') out += message.text;
    else err += message.text;
  };
  const random = seeded(request.seed);
  const stdin = new Stdin(request.stdin.text, false);
  const mount = new Mount(files);
  const context = {
    stdin,
    files: mount,
    random: random.random,
    randomBytes: random.fill,
    deadline: performance.now() + limits.timeMs,
  };
  const prepared = await adapter.prepare!(request, emit, context);
  const end = prepared ?? (await adapter.run(request, emit, context));
  return {
    ...end,
    out,
    err,
    written: mount.written(),
    diagnostics: mapDiagnostics(adapter.diagnostics, err, files),
    inputEnded: stdin.askedPastEnd,
    ran: prepared === null,
  };
}

/** One main file. */
export const main = (language: ClangLanguage, text: string): RunFile[] => [
  { path: language === 'c' ? 'main.c' : 'main.cpp', text },
];

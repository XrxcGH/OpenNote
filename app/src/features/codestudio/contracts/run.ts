// Run protocol version 2 (DESIGN 4.1) and the runtime adapter. Types and caps only: lane code:L03 validates
// every message (as codecells/sandbox/protocol.ts does today) and hosts the workers; each runtime lane writes an
// adapter. Code cells move to this protocol in lane code:L19.

import type { PackId } from './packs';
import type { TraceEvent, TraceOptions } from './debug';
import type { TestCase, TestResult } from './testing';

/** The in-app runtimes (DESIGN 2.1). `python-quick` is MicroPython; `python-full` is Pyodide, a pack. */
export const RUNTIME_IDS = [
  'python-quick',
  'python-full',
  'javascript',
  'typescript',
  'sql',
  'lua',
  'c',
  'cpp',
  'ruby',
  'r',
] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

/** How long, how large, and how much a run may take, use, and print. Same fields as code cells' limits. */
export interface RunLimits {
  /** Running time, from when the runtime is ready. */
  timeMs: number;
  /** Time to start the runtime, before the program runs. */
  loadMs: number;
  memoryBytes: number;
  stackBytes: number;
  /** Output kept; more is dropped and the run says so. */
  outputChars: number;
  sourceChars: number;
}

/** Caps on rich output (DESIGN 4.1). Rich output shows as an image or a table, never as HTML. */
export const RICH_LIMITS = {
  imageBytes: 2 * 1024 * 1024,
  tableRows: 10_000,
} as const;

/** One project file as the worker sees it, mounted read-only (DESIGN 4.3). */
export interface RunFile {
  path: string;
  text: string;
}

/** Prefilled input is read to the end, then EOF; interactive input asks the page (DESIGN 4.4). */
export interface RunStdin {
  mode: 'prefilled' | 'interactive';
  text: string;
}

/** Test cases to run instead of `main` (DESIGN 9). */
export interface TestHarness {
  cases: TestCase[];
  /** Discover and run the language's own framework tests too. */
  framework: boolean;
}

/** The page asks a worker to run a program. */
export interface RunRequest {
  kind: 'run';
  runtime: RuntimeId;
  files: RunFile[];
  /** The path of the file that runs first. */
  main: string;
  args: string[];
  stdin: RunStdin;
  limits: RunLimits;
  /** Seeds every random source, so a test or a replay gives the same run (DESIGN 4.5). */
  seed: number;
  trace?: TraceOptions;
  test?: TestHarness;
}

/** What else the page may send a running worker: a line of interactive input, or the end of input. */
export type PageMessage = RunRequest | { kind: 'input'; text: string } | { kind: 'eof' };

export type Stream = 'out' | 'err';

/** How a run ended. "time", "memory", and "stopped" are the limits and the Stop button. */
export type RunStatus = 'ok' | 'error' | 'time' | 'memory' | 'stopped' | 'failed';

export type RichMime = 'image/png' | 'text/csv' | 'application/vnd.opennote.table+json';

/** An error the runtime reported, mapped to a project file and a line (DESIGN 4.6). Lines start at 1. */
export interface RuntimeDiagnostic {
  /** The project path. */
  file: string;
  line: number;
  column?: number;
  message: string;
  /** The runtime's own name for it, such as `NameError` or clang's `error`. */
  kind: string;
}

/** Every message a worker may send. The page checks each one before it reads it. */
export type WorkerMessage =
  | { kind: 'loading'; percent: number }
  | { kind: 'started'; version?: string; interactive?: boolean }
  | { kind: 'out'; stream: Stream; text: string }
  | { kind: 'input-wanted'; prompt: string }
  | { kind: 'rich'; mime: RichMime; data: string }
  | { kind: 'diagnostic'; items: RuntimeDiagnostic[] }
  | { kind: 'trace'; chunk: TraceEvent[] }
  | { kind: 'test'; result: TestResult }
  | { kind: 'done'; status: RunStatus; exitCode?: number; message: string; written?: RunFile[]; inputEnded?: boolean };

/** Sends one message from inside the worker to the page. */
export type Emit = (message: WorkerMessage) => void;

/** Standard input inside the worker (DESIGN 4.4). Prefilled text is read first; at its end comes EOF (null). */
export interface RunInput {
  /** True when the page answers `lineAsync`, false when only the prefilled text is there. */
  interactive: boolean;
  /** The next line without its line break, or null at the end of input. */
  line(): string | null;
  /** Up to `count` characters, or everything left; null at the end of input. */
  read(count?: number): string | null;
  /** Asks the page for a line when interactive; otherwise the same as `line`. */
  lineAsync(prompt: string): Promise<string | null>;
}

/** The project inside the worker: files read-only, writes kept in an overlay shown after the run (DESIGN 4.3). */
export interface RunMount {
  paths(): string[];
  read(path: string): string | null;
  /** Writes to the overlay. False when the path or size is outside the project limits. */
  write(path: string, text: string): boolean;
}

/** What the worker hands an adapter for one run, besides the request (DESIGN 4.3 to 4.5). */
export interface RunContext {
  stdin: RunInput;
  files: RunMount;
  /** The seeded random source, the same sequence for the same `seed`. Numbers in [0, 1). */
  random(): number;
  /** Fills `bytes` from the seeded source, for WASI's random_get. */
  randomBytes(bytes: Uint8Array): void;
  /** Kept for the adapter to stop at the time limit, as a performance.now() time. */
  deadline: number;
}

/** Turns a runtime's error text into diagnostics on project files (DESIGN 4.6). */
export interface DiagnosticMapper {
  map(errorText: string, files: readonly RunFile[]): RuntimeDiagnostic[];
}

/** How a runtime records a trace for the debugger (DESIGN 8.2). Lane code:L14a fills these in. */
export interface TraceHooks {
  /** Rewrites a source file so it records as it runs (JavaScript and TypeScript, through acorn). */
  instrument?(file: RunFile): string;
  /** Starts recording before the program runs (Python's settrace, Lua's sethook). */
  start(options: TraceOptions, emit: Emit): void;
  /** Stops recording and sends what is left. */
  stop(): void;
}

/** How one run ended, as the adapter tells the worker. */
export interface RunEnd {
  status: RunStatus;
  exitCode?: number;
  /** For "error", the error's type when the runtime gives one. */
  message: string;
}

/**
 * One in-app runtime, living inside its worker. `load` prepares a warm worker before lockdown; `run` runs one
 * request and resolves with how it ended; `check` finds errors without running (DESIGN 6.1, layer L-c).
 */
export interface RuntimeAdapter {
  id: RuntimeId;
  /** The pack this runtime needs, when it is not bundled (ADR 0070). */
  pack?: PackId;
  /** Names of globals the generalized lockdown keeps for this runtime. */
  allowances?: readonly string[];
  /** The runtime's version, reported when a run starts, such as `MicroPython 1.27.0`. */
  version?: string;
  /**
   * True when the runtime reads only the prefilled input. The worker then reports a run as not interactive, and the
   * console says that interactive input is not available (DESIGN 4.4).
   */
  prefilledOnly?: boolean;
  load(onProgress: (percent: number) => void): Promise<void>;
  /** Runs one request and sends everything but `started` and `done`; the worker sends those. */
  run(request: RunRequest, emit: Emit, context: RunContext): Promise<RunEnd>;
  /** Maps the error text of a run to project lines. */
  diagnostics?: DiagnosticMapper;
  check?(file: RunFile, files: RunFile[]): Promise<RuntimeDiagnostic[]>;
  traceHooks?: TraceHooks;
}

// Run protocol version 2 (DESIGN 4.1): the checks on every message between the page and a run worker. The page
// reads nothing from a worker before readMessage accepts it, and the worker reads no request before readRequest
// does. Malformed and oversized messages are dropped. Rich output stays inside RICH_LIMITS and is only ever drawn
// as an image or a table, never as HTML.

import { PROJECT_LIMITS } from '../contracts/project';
import { RICH_LIMITS, RUNTIME_IDS } from '../contracts/run';
import type {
  PageMessage,
  RichMime,
  RunFile,
  RunLimits,
  RunRequest,
  RunStatus,
  RuntimeDiagnostic,
  RuntimeId,
  WorkerMessage,
} from '../contracts/run';
import { TRACE_LIMITS } from '../contracts/debug';
import type { TraceEvent } from '../contracts/debug';
import type { TestResult, TestStatus } from '../contracts/testing';

/** The page's own limits: a run asks for less, never more. The same values as code cells. */
export const RUN_LIMITS: RunLimits = {
  timeMs: 10_000,
  loadMs: 20_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  outputChars: 100_000,
  sourceChars: 200_000,
};

/** Caps on one message, so no single message can flood the page. */
export const MESSAGE_LIMITS = {
  /** Characters in one `out` message; the worker sends output in 4,096-character pieces. */
  textChars: 1024 * 1024,
  /** Characters in a prompt, a message, a version, or a diagnostic's text. */
  shortChars: 4096,
  diagnostics: 1000,
  args: 100,
  argChars: 4096,
  /** Characters of prefilled standard input, and of one interactive line. */
  stdinChars: 1024 * 1024,
} as const;

/** What the page sends a warm worker before any run: load this runtime now, run later. */
export interface LoadMessage {
  kind: 'load';
  runtime: RuntimeId;
}

export type HostMessage = PageMessage | LoadMessage;

const STATUSES: readonly RunStatus[] = ['ok', 'error', 'time', 'memory', 'stopped', 'failed'];
const TEST_STATUSES: readonly TestStatus[] = ['pass', 'fail', 'error', 'time', 'skipped'];
const MIMES: readonly RichMime[] = ['image/png', 'text/csv', 'application/vnd.opennote.table+json'];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null;
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isLine = (value: unknown): value is number => isCount(value) && value >= 1;

export const isRuntime = (value: unknown): value is RuntimeId =>
  typeof value === 'string' && (RUNTIME_IDS as readonly string[]).includes(value);

/** Bytes a base64 string decodes to. */
export const base64Bytes = (data: string): number =>
  Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

/** Rows in a CSV text: its lines, less a final empty one. */
function csvRows(data: string): number {
  let rows = 1;
  for (let at = data.indexOf('\n'); at !== -1; at = data.indexOf('\n', at + 1)) rows += 1;
  return data.endsWith('\n') ? rows - 1 : rows;
}

/** Whether rich output stays inside RICH_LIMITS and has the form its type says. */
export function richFits(mime: RichMime, data: string): boolean {
  if (mime === 'image/png') {
    return data.length % 4 === 0 && BASE64.test(data) && base64Bytes(data) <= RICH_LIMITS.imageBytes;
  }
  // A table larger than its row cap is refused, and so is text too long to be one.
  if (data.length > RICH_LIMITS.imageBytes * 4) return false;
  if (mime === 'text/csv') return csvRows(data) <= RICH_LIMITS.tableRows;
  try {
    const table: unknown = JSON.parse(data);
    const rows = isObject(table) ? table.rows : undefined;
    return Array.isArray(rows) && rows.length <= RICH_LIMITS.tableRows && rows.every(Array.isArray);
  } catch {
    return false;
  }
}

function readDiagnostic(value: unknown): RuntimeDiagnostic | null {
  if (!isObject(value)) return null;
  const { file, line, column, message, kind } = value;
  if (!isText(file, PROJECT_LIMITS.pathChars) || !isLine(line) || !isText(message, MESSAGE_LIMITS.shortChars)) {
    return null;
  }
  if (!isText(kind, MESSAGE_LIMITS.shortChars) || (column !== undefined && !isLine(column))) return null;
  return column === undefined ? { file, line, message, kind } : { file, line, column, message, kind };
}

function readTrace(value: unknown): TraceEvent[] | null {
  if (!Array.isArray(value) || value.length > TRACE_LIMITS.events) return null;
  const ok = value.every(
    (event) =>
      isObject(event) &&
      isCount(event.i) &&
      isText(event.file, PROJECT_LIMITS.pathChars) &&
      isLine(event.line) &&
      isObject(event.locals),
  );
  return ok ? (value as TraceEvent[]) : null;
}

function readTest(value: unknown): TestResult | null {
  if (!isObject(value)) return null;
  const { id, name, status, timeMs } = value;
  if (!isText(id, MESSAGE_LIMITS.shortChars) || !isText(name, MESSAGE_LIMITS.shortChars)) return null;
  if (!TEST_STATUSES.includes(status as TestStatus) || typeof timeMs !== 'number' || timeMs < 0) return null;
  for (const key of ['expected', 'actual', 'message'] as const) {
    if (value[key] !== undefined && !isText(value[key], MESSAGE_LIMITS.textChars)) return null;
  }
  return value as unknown as TestResult;
}

/** Files the worker wrote, within the project limits; null when any is not. */
export function readFiles(value: unknown): RunFile[] | null {
  if (!Array.isArray(value) || value.length > PROJECT_LIMITS.files) return null;
  const files: RunFile[] = [];
  let total = 0;
  for (const file of value) {
    if (!isObject(file) || !isText(file.path, PROJECT_LIMITS.pathChars) || file.path === '') return null;
    if (!isText(file.text, PROJECT_LIMITS.fileBytes)) return null;
    total += file.text.length;
    files.push({ path: file.path, text: file.text });
  }
  return total <= PROJECT_LIMITS.projectBytes ? files : null;
}

function readDone(message: Fields): WorkerMessage | null {
  const { status, exitCode, written, inputEnded } = message;
  if (!STATUSES.includes(status as RunStatus)) return null;
  if (exitCode !== undefined && !(Number.isInteger(exitCode) && Math.abs(exitCode as number) <= 2 ** 31)) return null;
  const text = isText(message.message, MESSAGE_LIMITS.shortChars) ? message.message : '';
  const files = written === undefined ? undefined : readFiles(written);
  if (files === null) return null;
  return {
    kind: 'done',
    status: status as RunStatus,
    message: text,
    ...(exitCode === undefined ? {} : { exitCode: exitCode as number }),
    ...(files ? { written: files } : {}),
    ...(inputEnded === true ? { inputEnded: true } : {}),
  };
}

/** The message, when it is one a run worker may send and within its caps, or null. */
export function readMessage(data: unknown): WorkerMessage | null {
  if (!isObject(data)) return null;
  switch (data.kind) {
    case 'loading':
      return typeof data.percent === 'number' && data.percent >= 0 && data.percent <= 100
        ? { kind: 'loading', percent: data.percent }
        : null;
    case 'started': {
      const version = isText(data.version, MESSAGE_LIMITS.shortChars) ? { version: data.version } : {};
      return { kind: 'started', ...version, ...(data.interactive === true ? { interactive: true } : {}) };
    }
    case 'out':
      return (data.stream === 'out' || data.stream === 'err') && isText(data.text, MESSAGE_LIMITS.textChars)
        ? { kind: 'out', stream: data.stream, text: data.text }
        : null;
    case 'input-wanted':
      return isText(data.prompt, MESSAGE_LIMITS.shortChars) ? { kind: 'input-wanted', prompt: data.prompt } : null;
    case 'rich':
      return MIMES.includes(data.mime as RichMime) &&
        typeof data.data === 'string' &&
        richFits(data.mime as RichMime, data.data)
        ? { kind: 'rich', mime: data.mime as RichMime, data: data.data }
        : null;
    case 'diagnostic': {
      if (!Array.isArray(data.items) || data.items.length > MESSAGE_LIMITS.diagnostics) return null;
      const items = data.items.map(readDiagnostic);
      return items.every((item) => item !== null) ? { kind: 'diagnostic', items: items as RuntimeDiagnostic[] } : null;
    }
    case 'trace': {
      const chunk = readTrace(data.chunk);
      return chunk ? { kind: 'trace', chunk } : null;
    }
    case 'test': {
      const result = readTest(data.result);
      return result ? { kind: 'test', result } : null;
    }
    case 'done':
      return readDone(data);
    default:
      return null;
  }
}

/** The page's limits with each one the request asks for, never above the page's own. */
export function limitsWithin(asked: unknown, page: RunLimits = RUN_LIMITS): RunLimits {
  const fields = isObject(asked) ? asked : {};
  const pick = (key: keyof RunLimits) => {
    const value = fields[key];
    return typeof value === 'number' && value > 0 ? Math.min(value, page[key]) : page[key];
  };
  return {
    timeMs: pick('timeMs'),
    loadMs: pick('loadMs'),
    memoryBytes: pick('memoryBytes'),
    stackBytes: pick('stackBytes'),
    outputChars: pick('outputChars'),
    sourceChars: pick('sourceChars'),
  };
}

/** The run request inside the worker, within the limits; null when it is not one. */
export function readRequest(data: unknown): RunRequest | null {
  if (!isObject(data) || data.kind !== 'run' || !isRuntime(data.runtime)) return null;
  const limits = limitsWithin(data.limits);
  const files = readFiles(data.files);
  if (!files || files.some((file) => file.text.length > limits.sourceChars)) return null;
  if (!isText(data.main, PROJECT_LIMITS.pathChars) || !files.some((file) => file.path === data.main)) return null;
  const args = data.args ?? [];
  if (!Array.isArray(args) || args.length > MESSAGE_LIMITS.args) return null;
  if (!args.every((arg) => isText(arg, MESSAGE_LIMITS.argChars))) return null;
  const stdin = isObject(data.stdin) ? data.stdin : { mode: 'prefilled', text: '' };
  if (stdin.mode !== 'prefilled' && stdin.mode !== 'interactive') return null;
  if (!isText(stdin.text, MESSAGE_LIMITS.stdinChars)) return null;
  const seed = typeof data.seed === 'number' && Number.isFinite(data.seed) ? data.seed : 0;
  return {
    kind: 'run',
    runtime: data.runtime,
    files,
    main: data.main,
    args: args as string[],
    stdin: { mode: stdin.mode, text: stdin.text },
    limits,
    seed,
    ...(isObject(data.trace) ? { trace: data.trace as unknown as RunRequest['trace'] } : {}),
    ...(isObject(data.test) ? { test: data.test as unknown as RunRequest['test'] } : {}),
  };
}

/** A message from the page inside the worker, or null. */
export function readHostMessage(data: unknown): HostMessage | null {
  if (!isObject(data)) return null;
  if (data.kind === 'load') return isRuntime(data.runtime) ? { kind: 'load', runtime: data.runtime } : null;
  if (data.kind === 'input')
    return isText(data.text, MESSAGE_LIMITS.stdinChars) ? { kind: 'input', text: data.text } : null;
  if (data.kind === 'eof') return { kind: 'eof' };
  return readRequest(data);
}

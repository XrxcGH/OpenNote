// What the page and a code cell's sandbox worker say to each other (docs/help/code-cells.md). The worker runs one
// cell once, then the page ends it. Every message from the worker is checked here before the page reads it, and
// output only ever reaches the page as text.

export const LANGUAGES = ['python', 'javascript'] as const;
export type CodeLanguage = (typeof LANGUAGES)[number];

export const isLanguage = (value: unknown): value is CodeLanguage =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

/** How long, how large, and how much a cell may run, use, and print. */
export interface Limits {
  /** Running time, from when the runtime is ready. */
  timeMs: number;
  /** Time to start the runtime, before the cell runs. */
  loadMs: number;
  /** The JavaScript runtime's heap, and the Python runtime's heap. */
  memoryBytes: number;
  stackBytes: number;
  /** Output kept; more is dropped and the run says so. */
  outputChars: number;
  sourceChars: number;
}

export const LIMITS: Limits = {
  timeMs: 10_000,
  loadMs: 20_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  outputChars: 100_000,
  sourceChars: 200_000,
};

export interface RunRequest {
  kind: 'run';
  language: CodeLanguage;
  source: string;
  limits: Limits;
}

export type Stream = 'out' | 'err';

/** How a run ended. "time", "memory", and "stopped" are the limits and the Stop button. */
export type RunStatus = 'ok' | 'error' | 'time' | 'memory' | 'stopped' | 'failed';

export type WorkerMessage =
  | { kind: 'started' }
  | { kind: 'out'; stream: Stream; text: string }
  | { kind: 'done'; status: RunStatus; message: string };

const STATUSES: readonly RunStatus[] = ['ok', 'error', 'time', 'memory', 'stopped', 'failed'];

/** The message, when it is one the worker may send, or null. */
export function readMessage(data: unknown): WorkerMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.kind === 'started') return { kind: 'started' };
  if (message.kind === 'out' && (message.stream === 'out' || message.stream === 'err')) {
    return typeof message.text === 'string' ? { kind: 'out', stream: message.stream, text: message.text } : null;
  }
  if (message.kind === 'done' && STATUSES.includes(message.status as RunStatus)) {
    const text = typeof message.message === 'string' ? message.message : '';
    return { kind: 'done', status: message.status as RunStatus, message: text };
  }
  return null;
}

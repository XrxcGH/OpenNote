// Runs one code cell in a fresh sandbox worker (worker.ts) and ends the worker when the cell is done, when it passes
// the time limit, or when the person presses Stop. The page keeps at most the output limit of text, and nothing
// from the worker is ever read as anything but text.
import { LIMITS, readMessage } from './protocol';
import type { CodeLanguage, Limits, RunStatus, Stream } from './protocol';

export interface RunResult {
  status: RunStatus;
  /** For "error", the error's type when the runtime gives one. */
  message: string;
  /** Running time in milliseconds, from when the runtime was ready. */
  elapsedMs: number;
  truncated: boolean;
}

export interface RunHandle {
  stop(): void;
  done: Promise<RunResult>;
}

export function runCode(
  language: CodeLanguage,
  source: string,
  onOutput: (stream: Stream, text: string) => void,
  limits: Limits = LIMITS,
  onStarted: () => void = () => undefined,
): RunHandle {
  let finish: (status: RunStatus, message?: string) => void = () => undefined;
  const done = new Promise<RunResult>((resolve) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'code-cell' });
    let started = 0;
    let kept = 0;
    let truncated = false;
    let timer = setTimeout(() => finish('failed', 'load'), limits.loadMs);
    finish = (status, message = '') => {
      clearTimeout(timer);
      worker.terminate();
      finish = () => undefined;
      resolve({ status, message, elapsedMs: started ? performance.now() - started : 0, truncated });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish('failed', event.message);
    };
    worker.onmessageerror = () => finish('failed', 'message');
    worker.onmessage = (event: MessageEvent) => {
      const message = readMessage(event.data);
      if (!message) return;
      if (message.kind === 'started') {
        started = performance.now();
        clearTimeout(timer);
        timer = setTimeout(() => finish('time'), limits.timeMs);
        onStarted();
      } else if (message.kind === 'out') {
        const room = limits.outputChars - kept;
        if (room <= 0) {
          truncated = true;
          return;
        }
        const text = message.text.slice(0, room);
        truncated ||= text.length < message.text.length;
        kept += text.length;
        onOutput(message.stream, text);
      } else {
        finish(message.status, message.message);
      }
    };
    worker.postMessage({ kind: 'run', language, source, limits });
  });
  return { stop: () => finish('stopped'), done };
}

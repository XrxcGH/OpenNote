// The live compiler check (DESIGN 6.1, layer L-e). It runs clang -fsyntax-only -Wall -Wextra on the file being
// edited, 800 ms after typing pauses. clang runs in its own long-lived worker, which keeps the compiled clang warm
// between checks. The worker goes after 2 minutes without a check, as a warm run worker does. It locks itself down
// once clang has loaded (checkServe.ts). Only the newest check of a file reports, so no stale marks show.

import type { RunFile, RuntimeDiagnostic } from '../../contracts/run';
import { IDLE_RELEASE_MS } from '../../run/host';
import { MAX_DIAGNOSTICS } from '../../run/diagnostics';
import { MESSAGE_LIMITS } from '../../run/protocol';
import type { ClangLanguage } from './flags';

/** The pause after typing before a check, the compiler layer's debounce (DESIGN 6.1). */
export const CHECK_DELAY_MS = 800;
/** A check that takes longer than this ends its worker and reports nothing. */
export const CHECK_TIMEOUT_MS = 15_000;

export interface CheckRequest {
  kind: 'check';
  id: number;
  language: ClangLanguage;
  file: RunFile;
  files: RunFile[];
}

export interface CheckReply {
  kind: 'checked';
  id: number;
  items: RuntimeDiagnostic[];
}

/** A reply's items, checked as the page checks a run's diagnostics: plain fields, capped lengths. */
export function readReply(value: unknown): CheckReply | null {
  const reply = value as Partial<CheckReply> | null;
  if (reply?.kind !== 'checked' || typeof reply.id !== 'number' || !Array.isArray(reply.items)) return null;
  const items: RuntimeDiagnostic[] = [];
  for (const item of reply.items.slice(0, MAX_DIAGNOSTICS) as Partial<RuntimeDiagnostic>[]) {
    const { file, line, column, message, kind } = item ?? {};
    if (typeof file !== 'string' || typeof message !== 'string' || typeof kind !== 'string') continue;
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) continue;
    items.push({
      file,
      line,
      ...(typeof column === 'number' && Number.isInteger(column) && column >= 1 ? { column } : {}),
      message: message.slice(0, MESSAGE_LIMITS.shortChars),
      kind: kind.slice(0, MESSAGE_LIMITS.shortChars),
    });
  }
  return { kind: 'checked', id: reply.id, items };
}

export interface CheckWorker {
  postMessage(message: CheckRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export interface CheckerOptions {
  createWorker?: () => CheckWorker;
  idleMs?: number;
  timeoutMs?: number;
}

const defaultWorker = (): CheckWorker =>
  new Worker(new URL('./check.worker.ts', import.meta.url), { type: 'module', name: 'clang-check' });

/** The page's side: one check worker, made on the first check and released when idle. */
export class ClangChecker {
  private worker: CheckWorker | null = null;
  private next = 1;
  private waiting = new Map<
    number,
    { resolve: (items: RuntimeDiagnostic[]) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private readonly create: () => CheckWorker;
  private readonly idleMs: number;
  private readonly timeoutMs: number;

  constructor(options: CheckerOptions = {}) {
    this.create = options.createWorker ?? defaultWorker;
    this.idleMs = options.idleMs ?? IDLE_RELEASE_MS;
    this.timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  }

  /** Whether a check worker is alive now. */
  get warm(): boolean {
    return this.worker !== null;
  }

  check(language: ClangLanguage, file: RunFile, files: RunFile[]): Promise<RuntimeDiagnostic[]> {
    const worker = this.ensure();
    const id = this.next++;
    this.hold();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.release(), this.timeoutMs);
      this.waiting.set(id, { resolve, timer });
      worker.postMessage({ kind: 'check', id, language, file, files });
    });
  }

  /** Ends the worker; checks still waiting report nothing. */
  release(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = null;
    for (const { resolve, timer } of this.waiting.values()) {
      clearTimeout(timer);
      resolve([]);
    }
    this.waiting.clear();
  }

  private ensure(): CheckWorker {
    if (this.worker) return this.worker;
    const worker = this.create();
    worker.onmessage = (event) => {
      const reply = readReply(event.data);
      const waiter = reply ? this.waiting.get(reply.id) : undefined;
      if (!reply || !waiter) return;
      this.waiting.delete(reply.id);
      clearTimeout(waiter.timer);
      waiter.resolve(reply.items);
      this.hold();
    };
    this.worker = worker;
    return worker;
  }

  /** Restarts the idle clock: the worker goes after `idleMs` with no check waiting. */
  private hold(): void {
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (this.waiting.size === 0) this.release();
      else this.hold();
    }, this.idleMs);
  }
}

/** What the editor hands a live check on each change. */
export interface LiveChange {
  file: RunFile;
  files: RunFile[];
  language: ClangLanguage;
}

/**
 * The debounced live check. Each change of a file restarts its 800 ms pause. When the pause ends, the file is
 * checked. The marks are published only if no newer change came in the meantime.
 */
export class LiveCheck {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private versions = new Map<string, number>();

  constructor(
    private readonly check: (language: ClangLanguage, file: RunFile, files: RunFile[]) => Promise<RuntimeDiagnostic[]>,
    private readonly publish: (path: string, items: RuntimeDiagnostic[]) => void,
    private readonly delayMs = CHECK_DELAY_MS,
  ) {}

  update(change: LiveChange): void {
    const path = change.file.path;
    const version = (this.versions.get(path) ?? 0) + 1;
    this.versions.set(path, version);
    const before = this.timers.get(path);
    if (before !== undefined) clearTimeout(before);
    const timer = setTimeout(() => {
      this.timers.delete(path);
      void this.check(change.language, change.file, change.files).then((items) => {
        if (this.versions.get(path) === version) this.publish(path, items);
      });
    }, this.delayMs);
    this.timers.set(path, timer);
  }

  /** Stops checking a closed file and drops a check still to come. */
  close(path: string): void {
    const timer = this.timers.get(path);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(path);
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
  }
}

/**
 * The engine check code:L10's scheduler takes (registerEngineCheck): source `clang`, the compiler layer (800 ms),
 * for C and C++. A header is checked as the language of the project's sources.
 */
export function clangEngineCheck(checker: ClangChecker) {
  return {
    id: 'clang',
    layer: 'compiler' as const,
    languages: ['c', 'cpp'] as const,
    check(file: RunFile, files: RunFile[]): Promise<RuntimeDiagnostic[]> {
      const cpp = /\.(cpp|cc|cxx|c\+\+|hpp|hh|hxx|h\+\+)$/i;
      const language: ClangLanguage =
        cpp.test(file.path) || (!/\.c$/i.test(file.path) && files.some((other) => cpp.test(other.path))) ? 'cpp' : 'c';
      return checker.check(language, file, files);
    },
  };
}

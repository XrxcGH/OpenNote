// Tests only: the notes harness, app/src-tauri/examples/notes_harness.rs, as a NotesCoreClient. It runs the app's
// notes bridge over a real core in a temporary folder, so the contract suite runs against the Rust side too.
// `cargo build -p opennote --example notes_harness` builds it; OPENNOTE_NOTES_HARNESS names another build.

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { NotesEvent } from '../types';
import type { NotesCoreClient } from './service';

const exe = process.platform === 'win32' ? 'notes_harness.exe' : 'notes_harness';
const root = join(import.meta.dirname, '..', '..', '..', '..', '..');

/** Where the harness is built, if it is. */
export function harnessPath(): string | null {
  const candidates = [
    process.env.OPENNOTE_NOTES_HARNESS,
    process.env.CARGO_TARGET_DIR && join(process.env.CARGO_TARGET_DIR, 'debug', 'examples', exe),
    join(root, 'target', 'debug', 'examples', exe),
  ];
  return candidates.find((path): path is string => Boolean(path) && existsSync(path as string)) ?? null;
}

interface Waiting {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

/** One harness process. Each reset() starts an empty library, and its client sees only events after that. */
export class NotesHarness {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, Waiting>();
  private readonly listeners = new Set<(event: NotesEvent) => void>();
  private next = 0;

  constructor(path: string) {
    this.child = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
  }

  private receive(line: string): void {
    const message = JSON.parse(line) as { id?: number; ok?: unknown; err?: unknown; event?: NotesEvent };
    if (message.event) {
      for (const listener of [...this.listeners]) listener(message.event);
      return;
    }
    const waiting = this.waiting.get(message.id ?? -1);
    if (!waiting) return;
    this.waiting.delete(message.id ?? -1);
    if ('err' in message) waiting.reject(message.err);
    else waiting.resolve(message.ok ?? null);
  }

  call(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const id = (this.next += 1);
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, cmd: command, args })}\n`);
    });
  }

  /** A client of a new, empty library. */
  async reset(): Promise<NotesCoreClient> {
    await this.call('reset');
    this.listeners.clear();
    return {
      invoke: (command, args) => this.call(command, args ?? {}),
      listen: (handler) => {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
      },
    };
  }

  close(): void {
    this.child.stdin.end();
  }
}

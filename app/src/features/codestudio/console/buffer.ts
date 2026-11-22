// The console's lines: standard output and standard error as they arrive, with their ANSI colors, the lines typed
// into the input line, and the run's notes. The two streams keep their own color state, as two terminals' would,
// but share the lines, so output and errors stay in the order the program wrote them.

import { AnsiParser } from './ansi';
import type { AnsiSpan } from './ansi';

/** The most lines kept; the oldest go first. */
export const MAX_LINES = 5000;

export type LineKind = 'output' | 'input' | 'note';

export interface ConsoleSpan extends AnsiSpan {
  /** Written to standard error. */
  err: boolean;
}

export interface ConsoleLine {
  id: number;
  kind: LineKind;
  spans: ConsoleSpan[];
}

export const lineText = (line: ConsoleLine): string => line.spans.map((span) => span.text).join('');

export class ConsoleBuffer {
  lines: ConsoleLine[] = [];
  private readonly parsers = { out: new AnsiParser(), err: new AnsiParser() };
  /** The output line still open for more text. */
  private open: ConsoleLine | null = null;
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    if (this.lines.length > MAX_LINES) this.lines = this.lines.slice(-MAX_LINES);
    // A new array each time, so a React snapshot sees the change.
    this.lines = [...this.lines];
    for (const listener of this.listeners) listener();
  }

  private newLine(kind: LineKind): ConsoleLine {
    const line: ConsoleLine = { id: this.nextId++, kind, spans: [] };
    this.lines.push(line);
    return line;
  }

  /** Program output. A line stays open until its line feed. */
  write(stream: 'out' | 'err', text: string, final = false): void {
    const err = stream === 'err';
    for (const span of this.parsers[stream].push(text, final)) {
      const parts = span.text.split('\n');
      parts.forEach((part, index) => {
        const ended = index < parts.length - 1;
        if (part) {
          this.open ??= this.newLine('output');
          const last = this.open.spans[this.open.spans.length - 1];
          if (last && last.err === err && last.fg === span.fg && last.bold === span.bold) last.text += part;
          else this.open.spans.push({ ...span, text: part, err });
          // A changed span means a changed spans array for React.
          this.open.spans = [...this.open.spans];
        }
        // Every line feed ends a line, an empty one too (a bare print()). The text after the last one stays open.
        if (ended) {
          this.open ??= this.newLine('output');
          this.open = null;
        }
      });
    }
    this.changed();
  }

  /** The run ended: text still held for the rest of a sequence is shown, without the sequence. */
  end(): void {
    this.write('out', '', true);
    this.write('err', '', true);
  }

  private whole(kind: LineKind, text: string): void {
    this.open = null;
    for (const part of text.split('\n')) {
      this.newLine(kind).spans.push({ text: part, fg: null, bold: false, err: false });
    }
    this.changed();
  }

  /** A line typed into the input line, shown where the program read it. */
  echo(text: string): void {
    this.whole('input', text);
  }

  /** A note of the console's own, such as how a run ended. */
  note(text: string): void {
    this.whole('note', text);
  }

  clear(): void {
    this.lines = [];
    this.open = null;
    this.parsers.out.reset();
    this.parsers.err.reset();
    this.changed();
  }

  /** Every line as plain text, for Copy output and Insert into page. */
  text(): string {
    return this.lines.map(lineText).join('\n');
  }
}

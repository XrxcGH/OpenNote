// Standard input of a run without SharedArrayBuffer (DESIGN 4.4). The app is not cross-origin isolated, so a
// worker cannot block on Atomics.wait. Prefilled input works for every runtime: the console's input box is read
// to its end, then the program gets EOF and the console says it asked for more. Interactive input works where
// the engine has JavaScript Promise Integration (JSPI): a WebAssembly runtime suspends on a Promise-returning
// import (WebAssembly.Suspending) while the page asks for a line, and resumes with the reply.
//
// Gate G-R5 (JSPI spike), recorded 2026-11-07: passed. run.test.tsx paused and resumed a WebAssembly program in
// Microsoft Edge 157.0.4341.42; the WebView2 runtime on the same machine is 157.0.4341.42, the same engine. JSPI is
// on by default from Chromium 137. WebKit (macOS, Linux) has no JSPI, so there the run reads the input box and the
// console says so. jspiAvailable() asks the engine the worker runs in, so no version is assumed.

import type { RunInput } from '../contracts/run';

/** Whether this engine has JSPI: WebAssembly.Suspending and WebAssembly.promising. */
export function jspiAvailable(wasm: object = WebAssembly): boolean {
  const api = wasm as { Suspending?: unknown; promising?: unknown };
  return typeof api.Suspending === 'function' && typeof api.promising === 'function';
}

/** Asks the page for one line of input: null means the person ended the input. */
export type AskLine = (prompt: string) => Promise<string | null>;

/**
 * The input of one run. Prefilled text is read first. In interactive mode, `lineAsync` then asks the page for each
 * further line; every other read, and every read in prefilled mode, gets EOF at the end of the text.
 */
export class Stdin implements RunInput {
  private at = 0;
  private ended = false;
  /** True once the program read past the end of the input, so the console can say it wanted more. */
  askedPastEnd = false;

  constructor(
    private text: string,
    readonly interactive: boolean,
    private ask: AskLine | null = null,
  ) {}

  line(): string | null {
    if (this.at >= this.text.length) return this.end();
    const next = this.text.indexOf('\n', this.at);
    const stop = next === -1 ? this.text.length : next;
    const line = this.text.slice(this.at, stop).replace(/\r$/, '');
    this.at = next === -1 ? this.text.length : next + 1;
    return line;
  }

  read(count?: number): string | null {
    if (this.at >= this.text.length) return this.end();
    const stop = count === undefined ? this.text.length : Math.min(this.text.length, this.at + Math.max(0, count));
    const piece = this.text.slice(this.at, stop);
    this.at = stop;
    return piece;
  }

  async lineAsync(prompt: string): Promise<string | null> {
    if (this.at < this.text.length || !this.interactive || !this.ask) return this.line();
    // The person ended the input on purpose, so the console has nothing to add.
    if (this.ended) return null;
    const reply = await this.ask(prompt);
    if (reply === null) this.ended = true;
    return reply === null ? null : reply.replace(/\r?\n$/, '');
  }

  private end(): null {
    this.askedPastEnd = true;
    return null;
  }
}

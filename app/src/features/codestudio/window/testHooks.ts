// Test hooks for the studio's behavior spec. Only `vite build --mode test` builds have them. The runtimes are their
// own lanes (code:L05 to L08), so the spec puts a stand-in runner in place: for each line of input it prints
// "Hello, <line>!", and a main file with `raise` on a line ends with a Python-style traceback that names that line.
import type { RunResult } from '../run/host';
import type { Runner } from './runner';
import { activeStudio } from './controller';
import { setStudioRunner } from './runner';

export const FAKE_VERSION = 'Test runtime 1.0';

export const fakeRunner: Runner = {
  run(order, callbacks) {
    const done = (async (): Promise<RunResult> => {
      await Promise.resolve();
      callbacks.onStarted?.();
      const main = order.files.find((file) => file.path === order.main);
      for (const name of order.stdin.text.split('\n').filter(Boolean)) callbacks.onOutput?.('out', `Hello, ${name}!\n`);
      const line = (main?.text.split('\n').findIndex((text) => text.includes('raise')) ?? -1) + 1;
      const end = { elapsedMs: 5, version: FAKE_VERSION, written: [], notes: [] };
      if (main && line > 0) {
        const trace = `Traceback (most recent call last):\n  File "${main.path}", line ${line}, in <module>\n`;
        callbacks.onOutput?.('err', `${trace}\u001b[31mValueError\u001b[0m: boom\n`);
        callbacks.onDiagnostics?.([{ file: main.path, line, message: 'boom', kind: 'ValueError' }]);
        return { status: 'error', message: 'ValueError', ...end };
      }
      return { status: 'ok', message: '', ...end };
    })();
    return { stop: () => undefined, input: () => undefined, eof: () => undefined, done };
  },
};

export function installStudioTestHooks(): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') return;
  const hooks = (window.__OPENNOTE_TEST__ ??= {});
  hooks.codeStudioFakeRunner = () => setStudioRunner(fakeRunner);
  // The typing benchmark's full console: lines of output in the shown studio.
  hooks.codeStudioFillConsole = (count: number) =>
    activeStudio()?.console.write('out', Array.from({ length: count }, (_, at) => `output line ${at}\n`).join(''));
}

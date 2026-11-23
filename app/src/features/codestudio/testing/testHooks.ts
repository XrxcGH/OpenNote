// Test hook for the Tests panel's behavior spec. Only `vite build --mode test` builds have it.
// It puts a stand-in runner in place. The runner prints the text of each print("...") line of the main file.
// So the spec changes what a program prints by editing the code, and the expected output decides pass or fail.
import { setStudioRunner } from '../window/runner';
import type { Runner } from '../window/runner';

const PRINT = /print\((["'])(.*?)\1\)/;

export const printRunner: Runner = {
  run(order, callbacks) {
    const done = (async () => {
      await Promise.resolve();
      callbacks.onStarted?.();
      const main = order.files.find((file) => file.path === order.main);
      for (const line of main?.text.split('\n') ?? []) {
        const found = PRINT.exec(line);
        if (found) callbacks.onOutput?.('out', `${found[2]}\n`);
      }
      return { status: 'ok' as const, message: '', elapsedMs: 3, written: [], notes: [] };
    })();
    return { stop: () => undefined, input: () => undefined, eof: () => undefined, done };
  },
};

export function installTestingHooks(): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') return;
  const hooks = (window.__OPENNOTE_TEST__ ??= {});
  hooks.codeTestsFakeRunner = () => setStudioRunner(printRunner);
}

// Test hooks for Playwright (ARCHITECTURE.md section 6.1). Only `vite build --mode test` builds expose them, as
// window.__OPENNOTE_TEST__[name](...): set the fake Windows appearance, seed notebooks, drive the fake updater,
// and read the announcer log.

// The hooks take whatever arguments the test passes through the page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTestHook(name: string, fn: (...args: any[]) => unknown): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') return;
  const hooks = (window.__OPENNOTE_TEST__ ??= {});
  hooks[name] = fn;
}

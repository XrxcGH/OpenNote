// Start-up loads that nothing awaits: a kit's registration imports the tools feature so its windows can reopen from a
// block. A test file that ends while one is still loading tears its environment down under the import, which
// Vitest reports as an unhandled error. Tracking the loads lets the unit tests' setup wait for them.
const pending = new Set<Promise<unknown>>();

/** Returns `load` unchanged and remembers it until it settles. */
export function startUp<T>(load: Promise<T>): Promise<T> {
  pending.add(load);
  const done = () => void pending.delete(load);
  load.then(done, done);
  return load;
}

/** Resolves once every tracked load, and any that those start, has settled. */
export async function startUpSettled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

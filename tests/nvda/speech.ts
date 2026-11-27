// What the NVDA specs share for reading the spoken log. No Playwright and no NVDA code, so a plain Node test can check
// it. NVDA speaks a little after a key and the CI runner is slow, so a spec waits for the phrases instead of reading
// the log once after a fixed pause.

/** True when every phrase is in the log, each after the one before it. */
export function heardInOrder(log: string, phrases: readonly RegExp[]): boolean {
  let from = 0;
  for (const phrase of phrases) {
    const at = log.slice(from).search(phrase);
    if (at < 0) return false;
    from += at + 1;
  }
  return true;
}

export interface Listener {
  spokenPhraseLog(): Promise<string[]>;
}

/**
 * Reads the spoken log until it holds the phrases in order, or until `timeoutMs` passes. It returns the whole log
 * either way, so a failing spec can show what NVDA did say.
 */
export async function listenFor(
  nvda: Listener,
  phrases: readonly RegExp[],
  options: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const {
    timeoutMs = 10_000,
    pollMs = 250,
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;
  let waited = 0;
  for (;;) {
    const log = (await nvda.spokenPhraseLog()).join('\n');
    if (heardInOrder(log, phrases) || waited >= timeoutMs) return log;
    await sleep(pollMs);
    waited += pollMs;
  }
}

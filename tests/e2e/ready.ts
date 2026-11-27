// When a launched app is ready for a spec's first step. The window opens before the notes do. The page loads and
// asks the core for its first tree. The core starts and makes the sample library in that call.
//
// Most starts take 2 to 4 s. On a busy hosted runner, one start had not finished after 26 s, and a step gives its
// element 20 s. A spec whose first step was a click counted the start inside that step's wait. It failed because
// the machine was slow, not because the step was wrong. So launchApp waits for the app's own signal first, and a
// step's wait times only the step.

/**
 * How long a start may take, from the session to the first tree. It is the 60 s msedgedriver already gives WebView2
 * to open, the allowance a launch has. Start-up speed belongs to the start-up check (tests/perf/startup.ts), not to
 * the E2E specs.
 */
export const START_TIMEOUT = 60_000;

/**
 * Whether the Notebooks tree has its first load. Runs in the page. The tree is busy (`aria-busy`) until the first
 * tree arrives. Before React renders, there is no tree at all. A tree that is there and not busy has rows, because
 * an empty library shows a message in its place.
 */
export function notesLoaded(): boolean {
  const tree = document.querySelector('[role="tree"][aria-label="Notebooks"]');
  return tree !== null && !tree.hasAttribute('aria-busy');
}

/** The part of a WebdriverIO browser that waiting needs. */
export interface Waiter {
  execute(script: () => boolean): Promise<boolean>;
  waitUntil(condition: () => Promise<boolean>, options: { timeout: number; timeoutMsg: string }): Promise<unknown>;
}

/** Waits until the app has loaded its notebooks, so the spec's first step finds the workspace ready. */
export async function waitForNotes(browser: Waiter, timeout = START_TIMEOUT): Promise<void> {
  await browser.waitUntil(() => browser.execute(notesLoaded), {
    timeout,
    timeoutMsg: `The app never loaded its notebooks within ${timeout / 1000} s of its window opening.`,
  });
}

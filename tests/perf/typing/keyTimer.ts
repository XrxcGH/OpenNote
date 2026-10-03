// The in-page measures of the typing benchmark (Phase 4 ARCHITECTURE.md sections 24.2 and 24.5), installed before
// any of the app's scripts so its listeners run first.
//
// - Painted: ADR 0005's KeyTimer. From each keydown's time stamp to a message posted from the next
//   requestAnimationFrame callback; the message runs after that frame's style, layout, and paint.
// - Script: from the start of the keydown's first listener to the end of the key's synchronous work. That is the
//   last of the microtasks queued from our own MutationObserver, `input`, and `keyup` callbacks. Our observer is
//   created before the editor's, so its microtask runs after ProseMirror has read the change and dispatched.
// - Long animation frames: Chromium's long-animation-frame entries (frames over 50 ms) while keys are measured.

import type { Page } from '@playwright/test';

export interface KeySamples {
  painted: number[];
  script: number[];
  longFrames: number;
}

interface TimerState extends KeySamples {
  recording: boolean;
}

declare global {
  interface Window {
    __keyTimer?: TimerState;
  }
}

function install(): void {
  const state: TimerState = { painted: [], script: [], longFrames: 0, recording: false };
  window.__keyTimer = state;
  let started = 0;
  let last = 0;
  const touch = () => queueMicrotask(() => (last = performance.now()));
  new MutationObserver(touch).observe(document, { subtree: true, childList: true, characterData: true });
  window.addEventListener('input', touch);
  window.addEventListener('keyup', touch);
  window.addEventListener(
    'keydown',
    (event) => {
      if (!state.recording) return;
      started = performance.now();
      last = started;
      requestAnimationFrame(() => {
        // The key's synchronous work is over by the next frame, which also waits for it.
        const script = last - started;
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          state.painted.push(performance.now() - event.timeStamp);
          state.script.push(script);
        };
        channel.port2.postMessage(null);
      });
    },
    { capture: true },
  );
  try {
    new PerformanceObserver((list) => {
      if (state.recording) state.longFrames += list.getEntries().length;
    }).observe({ type: 'long-animation-frame' });
  } catch {
    // Browsers without long-animation-frame entries report none.
  }
}

/** Installs the measures; call before the first navigation. */
export async function installKeyTimer(page: Page): Promise<void> {
  await page.addInitScript(install);
}

/** Starts or stops recording; starting clears what was recorded. */
export async function recordKeys(page: Page, on: boolean): Promise<void> {
  await page.evaluate((on) => {
    const state = window.__keyTimer!;
    if (on) Object.assign(state, { painted: [], script: [], longFrames: 0 });
    state.recording = on;
  }, on);
}

export async function readKeys(page: Page): Promise<KeySamples> {
  return page.evaluate(() => {
    const { painted, script, longFrames } = window.__keyTimer!;
    return { painted: [...painted], script: [...script], longFrames };
  });
}

export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

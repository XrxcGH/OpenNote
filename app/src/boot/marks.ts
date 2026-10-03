// The start-up marks the interface reports (ARCHITECTURE.md sections 8.2 and 8.8): `firstPaint` with the theme
// it painted, `shellReady`, and `pageReady`, which also tells Rust the last page is on screen (`app_ready`).
// Rust writes them to the perf log when OPENNOTE_PERF_LOG is set, and starts the updater's healthy timer on
// `app_ready`.

import type { Platform } from '../platform/types';

/** How long the page view has to report, before the shell reports for it so the healthy timer still starts. */
export const PAGE_READY_FALLBACK_MS = 3000;

/** How long to wait for two animation frames, which a hidden window may never run. */
export const FRAME_FALLBACK_MS = 700;

interface Reported {
  firstPaintEpochMs: number | null;
  pageReady: boolean;
}

const reported: Reported = { firstPaintEpochMs: null, pageReady: false };

/** Forgets what was reported, for tests. */
export function resetMarks(): void {
  reported.firstPaintEpochMs = null;
  reported.pageReady = false;
}

const now = (): number => performance.timeOrigin + performance.now();

/**
 * Reports the first paint two frames after the shell renders, with the theme it painted, shows the window under
 * the hidden show strategy, and marks `shellReady`. A fallback timer reports anyway when no frames run.
 */
export function reportFirstPaint(platform: Platform, view: Window = window): void {
  if (reported.firstPaintEpochMs !== null) return;
  let done = false;
  const report = () => {
    if (done) return;
    done = true;
    reported.firstPaintEpochMs = now();
    platform.perf.mark('firstPaint', view.document.documentElement.getAttribute('data-theme') ?? 'none');
    platform.lifecycle.firstPaint();
    platform.perf.mark('shellReady');
  };
  view.requestAnimationFrame(() => view.requestAnimationFrame(report));
  view.setTimeout(report, FRAME_FALLBACK_MS);
  view.setTimeout(() => reportPageReady(platform, null), PAGE_READY_FALLBACK_MS);
}

/**
 * Reports that the last page is on screen. Only the first call counts. The page view calls it with the page's id
 * when its text is ready; with no page view yet, the shell calls it after a short wait.
 */
export function reportPageReady(platform: Platform, pageId: string | null): void {
  if (reported.pageReady) return;
  reported.pageReady = true;
  const pageReadyEpochMs = now();
  platform.perf.mark('pageReady');
  platform.lifecycle.ready({
    firstPaintEpochMs: reported.firstPaintEpochMs ?? pageReadyEpochMs,
    pageReadyEpochMs,
    pageId,
  });
}

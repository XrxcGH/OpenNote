// Scan cleanup for a photo from the phone. The paste puts the picture on the page after a moment, and Clean up
// scan needs it selected, so the command waits for the selection.

import { executeCommand } from '../../../commands/registry';
import { isEnabled } from '../../../app/flags';

/** How long to wait for the pasted picture to be selected before giving up without a word. */
export const SELECT_WAIT_MS = 3000;

export interface Selecting {
  /** Calls the listener when the selection changes; returns how to stop. */
  subscribe(listener: () => void): () => void;
  /** True when exactly one picture is selected. */
  pictureSelected(): boolean;
}

/** Runs `run` once a single picture is selected, or never if that takes longer than the wait. Returns how to cancel. */
export function whenPictureSelected(selecting: Selecting, run: () => void, wait = SELECT_WAIT_MS): () => void {
  let done = false;
  let stop: () => void = () => undefined;
  const timer = setTimeout(() => finish(), wait);
  function finish() {
    done = true;
    stop();
    clearTimeout(timer);
  }
  const check = () => {
    if (done || !selecting.pictureSelected()) return;
    finish();
    run();
  };
  stop = selecting.subscribe(check);
  check();
  return () => {
    if (!done) finish();
  };
}

/** After one photo is pasted: cleans up the scan once it is selected. Nothing for several photos or when it is off. */
export function cleanUpScanAfterPaste(photoCount: number): void {
  if (photoCount !== 1 || !isEnabled('pdf.scan')) return;
  void (async () => {
    const { pageSelection, shownMounted } = await import('../../page');
    const selecting: Selecting = {
      subscribe: (listener) => pageSelection.subscribe(listener),
      pictureSelected: () => {
        const { blocks } = pageSelection.get();
        const block = blocks.length === 1 ? shownMounted.get()?.layer.block(blocks[0]!) : null;
        return block?.type === 'image';
      },
    };
    whenPictureSelected(selecting, () => void executeCommand('pdf.scanCleanup', undefined, 'menu').catch(() => false));
  })().catch(() => undefined);
}

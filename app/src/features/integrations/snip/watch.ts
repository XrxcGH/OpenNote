// Offers to add a screenshot to the open page. Win+Shift+S puts the picture on the clipboard while another window
// has the focus. When OpenNote gets the focus back and the clipboard changed meanwhile, this reads it, and when it
// holds a picture it offers to add the picture to the page. Nothing is added without the person pressing the button,
// and nothing leaves the PC.

import type { ClipboardClient } from '../../../platform/types';

export interface SnipDeps {
  clipboard: ClipboardClient;
  /** Whether a page is open and can take a picture. */
  canAdd(): boolean;
  /** Shows the offer. `add` puts the picture on the page. */
  offer(add: () => void): void;
}

export interface SnipWatcher {
  /** The window lost the focus. */
  blurred(): Promise<void>;
  /** The window got the focus back. */
  focused(): Promise<void>;
}

export function createSnipWatcher(deps: SnipDeps, add: () => void): SnipWatcher {
  let before: number | null = null;
  let offered = -1;
  return {
    async blurred() {
      try {
        before = (await deps.clipboard.facts()).sequence;
      } catch {
        before = null;
      }
    },
    async focused() {
      const then = before;
      before = null;
      if (then === null || !deps.canAdd()) return;
      try {
        const facts = await deps.clipboard.facts();
        if (facts.sequence === then || facts.sequence === offered) return;
        const content = await deps.clipboard.read();
        if (!content.imageBmp || content.imageBmp.byteLength === 0) return;
        offered = facts.sequence;
        deps.offer(add);
      } catch {
        // A clipboard that cannot be read just means no offer.
      }
    },
  };
}

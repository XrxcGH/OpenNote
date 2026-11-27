// The panel block that last held the caret or focus (a code cell's editor or its Run button, a card's button).
// A panel block has no text editor in the pool, so the pool's active block cannot name it.
// A command run from the palette reads this. Focus moving into the palette is ignored. Focus moving into a text block clears it.

import { setData } from '../../../ui/domWrites';

export interface FocusedPanel {
  block: string;
  readOnly: boolean;
}

let focused: FocusedPanel | null = null;
let installed = false;

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const panel = target?.closest<HTMLElement>('[data-panel-block]');
      if (panel) {
        focused = { block: panel.dataset.panelBlock ?? '', readOnly: panel.dataset.panelReadonly === 'true' };
      } else if (target?.closest('[data-scope="editor"][data-block]')) {
        focused = null;
      }
    },
    true,
  );
}

/** Marks a panel block's element so focus inside it is tracked. */
export function trackPanel(element: HTMLElement, block: string, readOnly: boolean): void {
  install();
  setData(element, 'panelBlock', block);
  setData(element, 'panelReadonly', String(readOnly));
}

/** The panel block that last had focus, or null. A block that is gone is checked by the caller. */
export function focusedPanel(): FocusedPanel | null {
  return focused;
}

/** Forgets the tracked block (when it is deleted), and for tests. */
export function forgetPanel(block?: string): void {
  if (block === undefined || focused?.block === block) focused = null;
}

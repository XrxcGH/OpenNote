// A solid caret while the person types, as a native caret is.
//
// CodeMirror draws its caret and blinks it with a CSS animation that never ends. A running animation keeps the
// browser's frame clock ticking. Each key then waits for the clock's next tick before it is drawn, up to 16.7 ms
// more at 60 Hz. That put typing in the Code studio over its 16 ms budget. So the blink stops while keys come and
// starts again after a pause. The class goes on and off once per run of typing, not once per key.

import { EditorView, ViewPlugin } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';

/** The class on the caret layer while the person types. */
export const STEADY_CLASS = 'cm-caretSteady';
/** How long after the last key or caret move the caret blinks again. */
export const BLINK_AGAIN_MS = 1000;

const steadyPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private layer: HTMLElement | null = null;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      if (!update.docChanged && !update.selectionSet) return;
      const layer = this.cursorLayer();
      if (!layer) return;
      if (!layer.classList.contains(STEADY_CLASS)) layer.classList.add(STEADY_CLASS);
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        layer.classList.remove(STEADY_CLASS);
      }, BLINK_AGAIN_MS);
    }

    destroy(): void {
      if (this.timer !== null) clearTimeout(this.timer);
    }

    private cursorLayer(): HTMLElement | null {
      if (!this.layer?.isConnected) this.layer = this.view.dom.querySelector<HTMLElement>('.cm-cursorLayer');
      return this.layer;
    }
  },
);

/** Stops the drawn caret's blink while the person types. Goes with `drawSelection()`. */
export const steadyCaretWhileTyping = [
  steadyPlugin,
  // CodeMirror restarts the blink by setting the layer's animation name inline, so this rule needs `!important`.
  EditorView.theme({ [`.cm-cursorLayer.${STEADY_CLASS}`]: { animation: 'none !important' } }),
];

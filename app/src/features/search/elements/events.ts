// Commands reach the editor that has focus through an event on its element, so the commands (loaded at start-up)
// never import the editor code (loaded with the first page).
export const ELEMENT_EVENT = 'opennote:element-action';

export type ElementAction =
  /** Adds the tag to the lines the selection touches, or removes it when they all have it. */
  | { type: 'tag'; tag: string }
  /** Copies a link to the paragraph or heading with the caret. */
  | { type: 'copyLink' }
  /** Shows the line tags in a menu at the caret. */
  | { type: 'chooseTag' };

/** Runs an action on the editor that has focus. Returns false when no editor does. */
export function runElementAction(action: ElementAction): boolean {
  const focused = document.activeElement;
  const editable = focused instanceof Element ? focused.closest('.ProseMirror') : null;
  if (!editable) return false;
  editable.dispatchEvent(new CustomEvent<ElementAction>(ELEMENT_EVENT, { detail: action }));
  return true;
}

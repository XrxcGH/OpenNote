// The page link commands reach the editor that has focus by an event on its element, so the commands (loaded at
// start-up) never import the editor code (loaded with the first page).
export const PAGE_LINK_EVENT = 'opennote:page-link';
export type PageLinkAction = 'follow' | 'preview' | 'start';

/** Runs a page link command on the editor that has focus. Returns false when no editor does. */
export function runPageLinkCommand(action: PageLinkAction): boolean {
  const focused = document.activeElement;
  const editable = focused instanceof Element ? focused.closest('.ProseMirror') : null;
  if (!editable) return false;
  editable.dispatchEvent(new CustomEvent<PageLinkAction>(PAGE_LINK_EVENT, { detail: action }));
  return true;
}

/** Whether an editor has focus, for the commands' `when`. */
export function editorHasFocus(): boolean {
  const focused = document.activeElement;
  return focused instanceof Element && focused.closest('.ProseMirror') !== null;
}

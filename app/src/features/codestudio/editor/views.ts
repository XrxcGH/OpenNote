// The mounted code editors, so the registry's code.* commands can reach the one with focus. This file loads at
// start-up with the commands, so it imports nothing from CodeMirror: each editor registers a small handle.

/** What a code.* command asks the focused editor to do. */
export type EditorAction =
  | 'completion.accept'
  | 'completion.request'
  | 'completion.list'
  | 'completion.acceptWord'
  | 'completion.acceptLine'
  | 'completion.dismiss'
  | 'completion.next'
  | 'completion.previous'
  | 'addNextOccurrence'
  | 'toggleLineComment'
  | 'toggleBlockComment'
  | 'moveLineUp'
  | 'moveLineDown'
  | 'copyLineUp'
  | 'copyLineDown'
  | 'deleteLine'
  | 'cursorAbove'
  | 'cursorBelow'
  | 'find'
  | 'replace'
  | 'goToLine'
  | 'expandSelection'
  | 'shrinkSelection'
  | 'wordWrap'
  | 'zoomIn'
  | 'zoomOut'
  | 'problemNext'
  | 'problemPrevious';

/** One mounted editor, as the commands see it. */
export interface CodeEditorHandle {
  /** The element with data-scope="codeEditor". */
  readonly root: HTMLElement;
  /** The editable text (CodeMirror's content element). The search panel and dialogs sit outside it. */
  readonly content: HTMLElement;
  readonly readOnly: boolean;
  /** Ghost text shows. */
  hasGhost(): boolean;
  /** Something to accept shows: ghost text, or the completion list with an item selected. */
  suggestionShowing(): boolean;
  run(action: EditorAction): boolean;
}

const mounted = new Set<CodeEditorHandle>();

/** Adds an editor. Returns a function that removes it. */
export function registerCodeEditor(handle: CodeEditorHandle): () => void {
  mounted.add(handle);
  return () => mounted.delete(handle);
}

/** The editor that holds focus now, or null. */
export function focusedCodeEditor(active: Element | null = document.activeElement): CodeEditorHandle | null {
  if (!active) return null;
  for (const handle of mounted) if (handle.root.contains(active)) return handle;
  return null;
}

/**
 * The editor whose text holds focus now, or null. Focus in the editor's own search panel or go-to-line field does
 * not count, so an editing key typed there leaves the document alone (VS Code's editorTextFocus).
 */
export function textFocusedCodeEditor(active: Element | null = document.activeElement): CodeEditorHandle | null {
  if (!active) return null;
  for (const handle of mounted) if (handle.content.contains(active)) return handle;
  return null;
}

let tabMovesFocus = false;
const tabListeners = new Set<(on: boolean) => void>();

/** Ctrl+M: Tab and Shift+Tab move focus instead of indenting, in every code editor (VS Code's rule). */
export function getTabMovesFocus(): boolean {
  return tabMovesFocus;
}

export function setTabMovesFocus(on: boolean): void {
  tabMovesFocus = on;
  tabListeners.forEach((listener) => listener(on));
}

export function onTabMovesFocus(listener: (on: boolean) => void): () => void {
  tabListeners.add(listener);
  return () => tabListeners.delete(listener);
}

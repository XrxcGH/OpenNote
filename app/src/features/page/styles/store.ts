// Where text styles are kept (owner: WP4). The design stores them per notebook in notebook.json through
// tree_set_props (P3-3), or per person in settings.json by notebook ID. Neither path reaches the interface yet:
// Phase 3's app bridge serves pages only, and the settings schema has no styles field. Until one does, styles
// stay in this device's local storage by notebook ID, behind the page.styles flag.
import { getLocation } from '../../../app/location';
import { createStore } from '../../../state/store';
import { applyNotebookStyles } from './styleVars';
import type { NotebookStyles } from './styleVars';

const KEY = 'opennote.notebookStyles';

function load(): Record<string, NotebookStyles> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, NotebookStyles>) : {};
  } catch {
    return {};
  }
}

export const notebookStyles = createStore<Record<string, NotebookStyles>>(load(), 'notebook styles');

/** The notebook of the shown page, whose styles the page uses. */
export function shownNotebook(): string | null {
  const location = getLocation();
  return location.view === 'workspace' ? location.notebookId : null;
}

export function stylesFor(notebook: string | null): NotebookStyles {
  return notebook ? (notebookStyles.get()[notebook] ?? {}) : {};
}

/** Saves a notebook's styles. Returns false when the device couldn't store them. */
export function saveStyles(notebook: string, styles: NotebookStyles): boolean {
  const next = { ...notebookStyles.get(), [notebook]: styles };
  notebookStyles.set(next);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Applies the shown notebook's styles to the document, so every page of the notebook follows. */
export function applyShownStyles(root: HTMLElement = document.documentElement): void {
  applyNotebookStyles(root, stylesFor(shownNotebook()));
}

let installed: (() => void) | null = null;

/** Keeps the document's style variables in step with the shown notebook and its saved styles. */
export function installNotebookStyles(): () => void {
  if (installed) return installed;
  applyShownStyles();
  const stop = notebookStyles.subscribe(() => applyShownStyles());
  installed = () => {
    stop();
    installed = null;
  };
  return installed;
}

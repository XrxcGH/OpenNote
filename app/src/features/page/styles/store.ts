// Where named styles are kept (text DESIGN.md 2.4 "Storage", ADR 0082). On the desktop they live in each notebook's
// notebook.json, so they sync and export. The bridge commands are notebook_styles_get and notebook_styles_set.
//
// An older build kept styles in this device's local storage. The first time a notebook loads, they are copied into
// notebook.json, unless the file already has styles. The local copy is cleared either way. The browser build has no
// notebook files, so there the local storage stays the store. Every change is one notebook change, outside the
// page's undo, with a toast that offers Undo (DESIGN.md 4.3 and 8).
import { getLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { NotebookStylesClient, NotebookStylesJson } from '../../../platform/types';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui/toast';
import { applyNamedStyles } from './cssVars';
import type { StyleSheetJson } from './model';
import { resolveAll } from './resolve';
import type { StyleContext } from './resolve';
import { APP_STYLES } from './sets';

/** The local storage key of the styles before ADR 0082: notebook ID to styles. */
export const LEGACY_KEY = 'opennote.notebookStyles';

/** The loaded styles by notebook. A notebook missing here hasn't loaded yet. */
export const notebookStyles = createStore<Record<string, StyleSheetJson>>({}, 'notebook styles');
/** The shown page's own style sheet (SPEC R-STY-7), or null. */
export const pageSheet = createStore<StyleSheetJson | null>(null, 'page style sheet');

interface Backend {
  client: NotebookStylesClient;
  /** Whether the client keeps styles in notebook.json, so local styles move there. */
  persistent: boolean;
  storage: Storage | null;
}

let backend: Backend | null = null;

function readLegacy(storage: Storage | null): Record<string, StyleSheetJson> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LEGACY_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, StyleSheetJson>)
      : {};
  } catch {
    return {};
  }
}

function writeLegacy(storage: Storage | null, all: Record<string, StyleSheetJson>): void {
  if (Object.keys(all).length === 0) storage?.removeItem(LEGACY_KEY);
  else storage?.setItem(LEGACY_KEY, JSON.stringify(all));
}

/** The browser build's store: the local storage, in the shape it always had. */
export function localStylesClient(storage: Storage | null): NotebookStylesClient {
  return {
    get: (notebook) => Promise.resolve(readLegacy(storage)[notebook] ?? {}),
    set: (notebook, styles) => {
      const all = { ...readLegacy(storage) };
      if (Object.keys(styles).length === 0) delete all[notebook];
      else all[notebook] = styles as StyleSheetJson;
      writeLegacy(storage, all);
      return Promise.resolve();
    },
  };
}

/** Chooses where styles are kept. Tests pass their own; the app uses the platform's. */
export function configureStyleStorage(next: Backend | null): void {
  backend = next;
  notebookStyles.set({});
  loading.clear();
}

function currentBackend(): Backend {
  if (backend) return backend;
  const storage = globalThis.localStorage ?? null;
  const platform = commandContext('commandBar').platform;
  backend =
    platform.kind === 'tauri'
      ? { client: platform.notebookStyles, persistent: true, storage }
      : { client: localStylesClient(storage), persistent: false, storage };
  return backend;
}

/**
 * The one-time copy (ADR 0082): local styles of this notebook go into notebook.json when it has none, and the local
 * copy is cleared. A notebook that already has styles keeps them. If the write fails, the local copy stays.
 */
async function adoptLocalStyles(of: Backend, notebook: string, current: NotebookStylesJson): Promise<StyleSheetJson> {
  const legacy = readLegacy(of.storage);
  const local = legacy[notebook];
  if (!of.persistent || local === undefined) return current;
  let result: StyleSheetJson = current;
  if (Object.keys(current).length === 0 && Object.keys(local).length > 0) {
    try {
      await of.client.set(notebook, local);
      result = local;
    } catch {
      return local;
    }
  }
  const rest = { ...legacy };
  delete rest[notebook];
  writeLegacy(of.storage, rest);
  return result;
}

const loading = new Map<string, Promise<StyleSheetJson>>();

/** Loads a notebook's styles once, moving local styles into notebook.json on the way. */
export function loadStyles(notebook: string): Promise<StyleSheetJson> {
  const known = notebookStyles.get()[notebook];
  if (known) return Promise.resolve(known);
  const pending = loading.get(notebook);
  if (pending) return pending;
  const of = currentBackend();
  const load = of.client
    .get(notebook)
    .then((current) => adoptLocalStyles(of, notebook, current))
    .catch(() => ({}) as StyleSheetJson)
    .then((styles) => {
      notebookStyles.set((all) => ({ ...all, [notebook]: styles }));
      loading.delete(notebook);
      return styles;
    });
  loading.set(notebook, load);
  return load;
}

/** The notebook of the shown page, whose styles the page uses. */
export function shownNotebook(): string | null {
  const location = getLocation();
  return location.view === 'workspace' ? location.notebookId : null;
}

/** A notebook's loaded styles, or none while they load. */
export function stylesFor(notebook: string | null): StyleSheetJson {
  return notebook ? (notebookStyles.get()[notebook] ?? {}) : {};
}

/** What resolution needs for the shown page: the app's set, the notebook's styles, and the page's sheet. */
export function shownContext(notebook: string | null = shownNotebook()): StyleContext {
  return { app: APP_STYLES, notebook: stylesFor(notebook), page: pageSheet.get() ?? undefined };
}

/**
 * Saves a notebook's styles as one notebook change. The look changes at once; a failed write puts the old styles
 * back. With `undo`, a toast says "Style changed" and offers Undo, which saves the styles from before.
 */
export async function saveStyles(
  notebook: string,
  next: StyleSheetJson,
  options: { undo?: boolean; message?: string } = {},
): Promise<boolean> {
  const before = stylesFor(notebook);
  notebookStyles.set((all) => ({ ...all, [notebook]: next }));
  try {
    await currentBackend().client.set(notebook, next);
  } catch {
    notebookStyles.set((all) => ({ ...all, [notebook]: before }));
    showToast({ message: t('textStyles.saveFailed'), tone: 'danger' });
    return false;
  }
  if (options.undo !== false) {
    showToast({
      id: 'text-style-changed',
      message: options.message ?? t('textStyles.changed'),
      announce: t('textStyles.changedSpoken'),
      action: { label: t('textStyles.undo'), run: () => void saveStyles(notebook, before, { undo: false }) },
    });
  }
  return true;
}

/** Puts the shown notebook's and page's styles on the document, so every page of the notebook follows. */
export function applyShownStyles(root: HTMLElement = document.documentElement): void {
  const notebook = shownNotebook();
  // A notebook shown for the first time loads; its styles apply when they arrive.
  if (notebook && !(notebook in notebookStyles.get())) void loadStyles(notebook);
  applyNamedStyles(root, resolveAll(shownContext()).values());
}

let installed: (() => void) | null = null;

/** Keeps the document's style variables in step with the shown notebook, its styles, and the page's sheet. */
export function installNotebookStyles(): () => void {
  if (installed) return installed;
  applyShownStyles();
  const stops = [notebookStyles.subscribe(() => applyShownStyles()), pageSheet.subscribe(() => applyShownStyles())];
  installed = () => {
    stops.forEach((stop) => stop());
    installed = null;
  };
  return installed;
}

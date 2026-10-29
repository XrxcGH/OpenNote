// What this device keeps about layouts: the saved layout templates, and the layout each notebook gives its new pages.
// Both live in this browser's storage, like the reading aids and the notebook styles, because the notes bridge has no
// call for a notebook's settings yet. The notebook default is stored as a `defaults.view` object (format spec 4.5), so
// moving it into notebook.json later changes where it is read from and nothing else.
import { createStore } from '../../../state/store';
import { MAX_LAYOUTS, readLayoutFile, writeLayoutFile } from '../layout';
import type { LayoutTemplate } from '../layout';
import type { JsonObject } from '../layout';

const LAYOUTS_KEY = 'opennote.layoutTemplates';
const NOTEBOOK_KEY = 'opennote.notebookLayouts';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** The saved layouts, each read back through the file reader so a damaged entry is dropped. */
function loadLayouts(): readonly LayoutTemplate[] {
  const list = read<unknown>(LAYOUTS_KEY, []);
  if (!Array.isArray(list)) return [];
  const out: LayoutTemplate[] = [];
  for (const item of list.slice(0, MAX_LAYOUTS)) {
    const id = typeof item?.id === 'string' ? item.id : null;
    const found = id ? readLayoutFile(writeLayoutFile(item as LayoutTemplate)) : null;
    if (id && found?.ok) out.push({ ...found.layout, id });
  }
  return out;
}

export const savedLayouts = createStore<readonly LayoutTemplate[]>(loadLayouts(), 'saved layouts');

export function setSavedLayouts(next: readonly LayoutTemplate[]): boolean {
  savedLayouts.set(next);
  return write(LAYOUTS_KEY, next);
}

export type NotebookDefaults = Readonly<Record<string, JsonObject>>;

export const notebookDefaults = createStore<NotebookDefaults>(
  read<NotebookDefaults>(NOTEBOOK_KEY, {}),
  'notebook layouts',
);

/** The `defaults.view` of a notebook, or null when it has none. */
export function defaultsOf(notebook: string | null): JsonObject | null {
  return notebook ? (notebookDefaults.get()[notebook] ?? null) : null;
}

/** Sets or clears (with null) the layout a notebook gives its new pages. Returns false when the device can't keep it. */
export function setNotebookDefault(notebook: string, view: JsonObject | null): boolean {
  const { [notebook]: _old, ...rest } = notebookDefaults.get();
  const next = view ? { ...rest, [notebook]: view } : rest;
  notebookDefaults.set(next);
  return write(NOTEBOOK_KEY, next);
}

// The sources of each notebook, and the style chosen, kept on this device. A notebook has its own list, so a paper's
// sources do not mix with another course's. Outside a notebook there is one shared list.
import { createStore } from '../../state/store';
import { mergeSources } from './model';
import type { Source } from './model';
import { readStyleFile } from './csl';
import type { StyleFile } from './csl';
import { addedStyles, addStyleFile, removeStyleFile } from './styleList';
import { STYLES } from './styles';
import type { StyleId } from './styles';

const PREFIX = 'opennote.citations.';

function read<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // The list lasts until the window closes.
  }
}

export const SHARED = 'shared';

/** Every list that has been opened, by notebook. */
export const sourcesStore = createStore<Readonly<Record<string, readonly Source[]>>>({}, 'citation sources');

export function sourcesOf(notebook: string): readonly Source[] {
  const cached = sourcesStore.get()[notebook];
  if (cached) return cached;
  const list = read<unknown>(`sources.${notebook}`, []);
  const sources = Array.isArray(list)
    ? (list as Source[]).filter((one) => typeof one?.id === 'string' && typeof one.title === 'string')
    : [];
  // Reading must not notify, so a component can call this while it renders.
  (sourcesStore.get() as Record<string, readonly Source[]>)[notebook] = sources;
  return sources;
}

export function setSources(notebook: string, sources: readonly Source[]): void {
  sourcesStore.set((current) => ({ ...current, [notebook]: sources }));
  write(`sources.${notebook}`, sources);
}

export function addSources(notebook: string, incoming: readonly Source[]): { added: number; skipped: number } {
  const before = sourcesOf(notebook);
  const { sources, skipped } = mergeSources(before, incoming);
  setSources(notebook, sources);
  return { added: sources.length - before.length, skipped };
}

export function saveSource(notebook: string, source: Source): void {
  const list = sourcesOf(notebook);
  setSources(
    notebook,
    list.some((one) => one.id === source.id)
      ? list.map((one) => (one.id === source.id ? source : one))
      : [...list, source],
  );
}

export function removeSource(notebook: string, id: string): void {
  setSources(
    notebook,
    sourcesOf(notebook).filter((one) => one.id !== id),
  );
}

// Style files the person added come back on the next start, before the chosen style is looked up.
for (const saved of read<unknown[]>('style.files', [])) {
  const file = readStyleFile(JSON.stringify(saved));
  if ('style' in file) addStyleFile(file.style);
}

export const styleStore = createStore<StyleId>(
  (() => {
    const saved = read<string>('style', 'apa');
    return Object.hasOwn(STYLES, saved) ? saved : 'apa';
  })(),
  'citation style',
);

export function setStyle(style: StyleId): void {
  styleStore.set(style);
  write('style', style);
}

/** Adds a style file the person chose and picks it. Returns false when its id belongs to a style the app has. */
export function addStyle(file: StyleFile): boolean {
  if (!addStyleFile(file)) return false;
  write('style.files', addedStyles.get());
  setStyle(file.id);
  return true;
}

/** Removes a style file the person added. A source list keeps working: the chosen style falls back to APA. */
export function removeStyle(id: StyleId): void {
  removeStyleFile(id);
  write('style.files', addedStyles.get());
  if (styleStore.get() === id) setStyle('apa');
}

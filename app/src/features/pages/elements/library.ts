// The elements library: elements in folders, found by name. Everything here returns a new library and never changes
// the one it was given. A change that cannot be made returns the library unchanged and says why in `error`, so the
// interface can show the reason.

import type { ElementData } from './element';

export interface ElementEntry {
  readonly id: string;
  readonly name: string;
  /** The folder path, with "/" between names. An empty string is the top level. */
  readonly folder: string;
  readonly created: string;
  readonly element: ElementData;
}

export interface ElementLibrary {
  readonly entries: readonly ElementEntry[];
  /** Every folder, including empty ones. A folder that holds an element but is not listed still exists. */
  readonly folders: readonly string[];
}

export const EMPTY_LIBRARY: ElementLibrary = { entries: [], folders: [] };

export const MAX_NAME = 80;
export const MAX_FOLDER_NAME = 40;
export const MAX_DEPTH = 6;

export type LibraryError = 'badName' | 'tooDeep' | 'exists' | 'missing' | 'intoSelf';

export interface LibraryResult {
  readonly library: ElementLibrary;
  readonly error?: LibraryError;
}

const fail = (library: ElementLibrary, error: LibraryError): LibraryResult => ({ library, error });
const ok = (library: ElementLibrary): LibraryResult => ({ library });

/** A name as it is kept: control characters out, runs of space as one, trimmed. Null when nothing is left. */
export function cleanName(text: string, max = MAX_NAME): string | null {
  const name = text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name === '' ? null : Array.from(name).slice(0, max).join('');
}

const cleanFolderName = (text: string): string | null => {
  const name = cleanName(text.replace(/[/\\]/g, ' '), MAX_FOLDER_NAME);
  return name === '.' || name === '..' ? null : name;
};

const parts = (path: string): string[] => (path === '' ? [] : path.split('/'));
const join = (...names: string[]): string => names.filter((n) => n !== '').join('/');
const within = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);
const key = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const byName = (a: string, b: string): number =>
  key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : a > b ? 1 : 0;

/** Every folder: the listed ones, those that hold elements, and the folders above them. */
export function allFolders(library: ElementLibrary): string[] {
  const set = new Set<string>();
  for (const path of [...library.folders, ...library.entries.map((e) => e.folder)]) {
    const names = parts(path);
    for (let i = 1; i <= names.length; i += 1) set.add(names.slice(0, i).join('/'));
  }
  return [...set].sort(byName);
}

const hasFolder = (library: ElementLibrary, path: string): boolean => path === '' || allFolders(library).includes(path);

/** A name for a new element or folder that no sibling has, by adding a number: "Axis", "Axis 2", "Axis 3". */
export function uniqueName(library: ElementLibrary, folder: string, name: string): string {
  const taken = new Set([
    ...library.entries.filter((e) => e.folder === folder).map((e) => key(e.name)),
    ...allFolders(library)
      .filter((f) => parts(f).length === parts(folder).length + 1 && f.startsWith(folder === '' ? '' : `${folder}/`))
      .map((f) => key(parts(f).at(-1)!)),
  ]);
  if (!taken.has(key(name))) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} ${n}`;
    if (!taken.has(key(candidate))) return candidate;
  }
}

export function createFolder(library: ElementLibrary, parent: string, name: string): LibraryResult {
  const clean = cleanFolderName(name);
  if (clean === null) return fail(library, 'badName');
  if (!hasFolder(library, parent)) return fail(library, 'missing');
  if (parts(parent).length >= MAX_DEPTH) return fail(library, 'tooDeep');
  const path = join(parent, clean);
  if (allFolders(library).some((f) => key(f) === key(path))) return fail(library, 'exists');
  return ok({ ...library, folders: [...library.folders, path] });
}

/** Adds an element. The folder is created if it does not exist. The name is made unique among its siblings. */
export function addElement(library: ElementLibrary, entry: ElementEntry): LibraryResult {
  const name = cleanName(entry.name);
  if (name === null) return fail(library, 'badName');
  if (parts(entry.folder).length > MAX_DEPTH) return fail(library, 'tooDeep');
  if (library.entries.some((e) => e.id === entry.id)) return fail(library, 'exists');
  const folders = hasFolder(library, entry.folder) ? library.folders : [...library.folders, entry.folder];
  return ok({
    folders,
    entries: [...library.entries, { ...entry, name: uniqueName(library, entry.folder, name) }],
  });
}

const replace = (library: ElementLibrary, id: string, change: (e: ElementEntry) => ElementEntry): LibraryResult =>
  library.entries.some((e) => e.id === id)
    ? ok({ ...library, entries: library.entries.map((e) => (e.id === id ? change(e) : e)) })
    : fail(library, 'missing');

export function renameElement(library: ElementLibrary, id: string, name: string): LibraryResult {
  const clean = cleanName(name);
  if (clean === null) return fail(library, 'badName');
  const others = { ...library, entries: library.entries.filter((e) => e.id !== id) };
  const folder = library.entries.find((e) => e.id === id)?.folder ?? '';
  return replace(library, id, (e) => ({ ...e, name: uniqueName(others, folder, clean) }));
}

export function moveElement(library: ElementLibrary, id: string, folder: string): LibraryResult {
  if (!hasFolder(library, folder)) return fail(library, 'missing');
  const others = { ...library, entries: library.entries.filter((e) => e.id !== id) };
  return replace(library, id, (e) => ({ ...e, folder, name: uniqueName(others, folder, e.name) }));
}

export function removeElement(library: ElementLibrary, id: string): LibraryResult {
  return library.entries.some((e) => e.id === id)
    ? ok({ ...library, entries: library.entries.filter((e) => e.id !== id) })
    : fail(library, 'missing');
}

/** Moves a folder, with everything in it, under another folder (or to the top level with ""). */
export function moveFolder(library: ElementLibrary, path: string, into: string): LibraryResult {
  if (!hasFolder(library, path) || path === '') return fail(library, 'missing');
  if (!hasFolder(library, into)) return fail(library, 'missing');
  if (within(into, path)) return fail(library, 'intoSelf');
  const name = parts(path).at(-1)!;
  const target = join(into, name);
  const depth =
    Math.max(
      ...allFolders(library)
        .filter((f) => within(f, path))
        .map((f) => parts(f).length - parts(path).length),
    ) + 1;
  if (parts(into).length + depth > MAX_DEPTH) return fail(library, 'tooDeep');
  if (target !== path && allFolders(library).some((f) => key(f) === key(target))) return fail(library, 'exists');
  const move = (f: string): string => (within(f, path) ? join(target, f.slice(path.length + 1)) : f);
  return ok({
    folders: allFolders(library).map(move),
    entries: library.entries.map((e) => ({ ...e, folder: move(e.folder) })),
  });
}

export function renameFolder(library: ElementLibrary, path: string, name: string): LibraryResult {
  const clean = cleanFolderName(name);
  if (clean === null) return fail(library, 'badName');
  if (!hasFolder(library, path) || path === '') return fail(library, 'missing');
  const parent = parts(path).slice(0, -1).join('/');
  const target = join(parent, clean);
  if (target !== path && allFolders(library).some((f) => key(f) === key(target))) return fail(library, 'exists');
  const move = (f: string): string => (within(f, path) ? join(target, f.slice(path.length + 1)) : f);
  return ok({
    folders: allFolders(library).map(move),
    entries: library.entries.map((e) => ({ ...e, folder: move(e.folder) })),
  });
}

/**
 * Removes a folder. `keep` moves its elements and folders up to its parent, and `delete` removes everything inside it.
 */
export function removeFolder(library: ElementLibrary, path: string, what: 'keep' | 'delete'): LibraryResult {
  if (!hasFolder(library, path) || path === '') return fail(library, 'missing');
  const parent = parts(path).slice(0, -1).join('/');
  if (what === 'delete') {
    return ok({
      folders: allFolders(library).filter((f) => !within(f, path)),
      entries: library.entries.filter((e) => !within(e.folder, path)),
    });
  }
  // Folders inside keep their own names; the removed folder's level disappears.
  const inside = (f: string): string => (f === path ? parent : join(parent, f.slice(path.length + 1)));
  return ok({
    folders: allFolders(library)
      .filter((f) => f !== path)
      .map((f) => (within(f, path) ? inside(f) : f)),
    entries: library.entries.map((e) => (within(e.folder, path) ? { ...e, folder: inside(e.folder) } : e)),
  });
}

export interface FolderListing {
  /** The paths of the folders directly inside, sorted by name. */
  readonly folders: readonly string[];
  readonly entries: readonly ElementEntry[];
}

/** What a folder shows: its subfolders and its elements, each sorted by name without regard to case or accents. */
export function listFolder(library: ElementLibrary, folder: string): FolderListing {
  const depth = parts(folder).length + 1;
  const prefix = folder === '' ? '' : `${folder}/`;
  return {
    folders: allFolders(library)
      .filter((f) => parts(f).length === depth && f.startsWith(prefix))
      .sort((a, b) => byName(parts(a).at(-1)!, parts(b).at(-1)!)),
    entries: library.entries.filter((e) => e.folder === folder).sort((a, b) => byName(a.name, b.name)),
  };
}

/**
 * Elements whose name matches every word of the query, best first. A name that starts with the query beats one with
 * a word that starts with it, which beats one that only contains it. The folder path counts for less. Case and accents
 * do not matter.
 */
export function searchElements(library: ElementLibrary, query: string): ElementEntry[] {
  const words = key(query)
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return [];
  const scored: { entry: ElementEntry; score: number }[] = [];
  for (const entry of library.entries) {
    const name = key(entry.name);
    const path = key(entry.folder);
    let score = 0;
    let all = true;
    for (const word of words) {
      if (name === word) score += 100;
      else if (name.startsWith(word)) score += 80;
      else if (name.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(word))) score += 60;
      else if (name.includes(word)) score += 40;
      else if (path.includes(word)) score += 20;
      else all = false;
    }
    if (all) scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score || byName(a.entry.name, b.entry.name)).map((s) => s.entry);
}

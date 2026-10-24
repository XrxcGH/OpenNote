// The component gallery's registry. Each package lists the components and states it wants shown in a file named
// entries/<area>.gallery.tsx, whose default export is a list from defineGallery. collectEntries finds them all, so
// no package edits a shared list. The gallery is for development and for screenshot tests: it is not part of the
// shipped app (see README.md).

import type { ReactNode } from 'react';

/** One component in one state. */
export interface GalleryEntry {
  /** Unique across every file, lowercase words joined by dots, such as 'ui.button.primary'. */
  readonly id: string;
  readonly title: string;
  /** The heading it is listed under, such as 'Buttons'. */
  readonly group: string;
  /** One sentence for the reader: what the state shows and why it matters. */
  readonly description?: string;
  /** The entry's content. It may call hooks, because the gallery renders it as a component. */
  render(): ReactNode;
}

export const ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;

/** Type-checks a list of entries. */
export function defineGallery(entries: readonly GalleryEntry[]): readonly GalleryEntry[] {
  return entries;
}

type Module = { default: readonly GalleryEntry[] };

/**
 * Joins the lists of every module, sorted by group and then title. It throws when two entries share an id, or an
 * id is not lowercase words joined by dots, because the id names a screenshot baseline and a link.
 */
export function collectEntries(modules: Readonly<Record<string, Module>>): GalleryEntry[] {
  const entries = Object.values(modules).flatMap((module) => [...module.default]);
  const bad = entries.filter((entry) => !ID_PATTERN.test(entry.id));
  if (bad.length > 0)
    throw new Error(`Gallery ids must be lowercase words joined by dots: ${bad.map((e) => e.id).join(', ')}`);
  const ids = entries.map((entry) => entry.id);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length > 0) throw new Error(`Gallery ids must be unique: ${[...new Set(repeated)].join(', ')}`);
  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
}

/** The entries by group, in order. */
export function groupEntries(entries: readonly GalleryEntry[]): { group: string; entries: GalleryEntry[] }[] {
  const groups: { group: string; entries: GalleryEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.group === entry.group) last.entries.push(entry);
    else groups.push({ group: entry.group, entries: [entry] });
  }
  return groups;
}

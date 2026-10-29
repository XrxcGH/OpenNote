// The names of the shape library's groups and items. The engineering groups keep theirs with the engineering
// tools' strings; the rest are the ink lane's.
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { LIBRARY } from '../geometry/shapes';
import type { LibraryGroup } from '../geometry/shapes';

const ENGINEERING_GROUPS: ReadonlySet<LibraryGroup> = new Set(['mechanics', 'circuit']);

export function groupLabel(group: LibraryGroup): string {
  return t(
    (ENGINEERING_GROUPS.has(group)
      ? `engineering.shapes.groups.${group}`
      : `ink.library.groups.${group}`) as MessageKey,
  );
}

export function itemLabel(id: string): string {
  const group = LIBRARY.find((item) => item.id === id)?.group ?? 'basic';
  return t((ENGINEERING_GROUPS.has(group) ? `engineering.shapes.${id}` : `ink.library.${id}`) as MessageKey);
}

// The tree's navigation keys (ARCHITECTURE.md section 13.3). They belong to the WAI-ARIA tree pattern and can't be
// rebound: arrows, Home, End, `*`, Enter, and Space. Keys with modifiers reach the registry's commands instead.
// This is the pure part, so the key table can be tested without a browser.

import type { Row } from './rows';

export type TreeKeyAction =
  | { readonly type: 'focus'; readonly index: number }
  | { readonly type: 'expand'; readonly index: number }
  | { readonly type: 'collapse'; readonly index: number }
  | { readonly type: 'expandSiblings'; readonly indexes: readonly number[] }
  | { readonly type: 'open'; readonly index: number }
  | { readonly type: 'select'; readonly index: number };

function horizontal(key: 'ArrowRight' | 'ArrowLeft', rows: readonly Row[], index: number): TreeKeyAction | null {
  const row = rows[index];
  if (key === 'ArrowRight') {
    if (row.expanded === false) return { type: 'expand', index };
    return row.expanded === true && rows[index + 1] ? { type: 'focus', index: index + 1 } : null;
  }
  if (row.expanded === true) return { type: 'collapse', index };
  const parent = row.parentId === null ? -1 : rows.findIndex((other) => other.id === row.parentId);
  return parent === -1 ? null : { type: 'focus', index: parent };
}

/** What a navigation key does on the row at `index`, or null when the key isn't one of them or does nothing. */
export function treeKeyAction(key: string, rows: readonly Row[], index: number): TreeKeyAction | null {
  if (rows.length === 0 || index < 0 || index >= rows.length) return null;
  switch (key) {
    case 'ArrowDown':
      return index < rows.length - 1 ? { type: 'focus', index: index + 1 } : null;
    case 'ArrowUp':
      return index > 0 ? { type: 'focus', index: index - 1 } : null;
    case 'ArrowRight':
    case 'ArrowLeft':
      return horizontal(key, rows, index);
    case 'Home':
      return { type: 'focus', index: 0 };
    case 'End':
      return { type: 'focus', index: rows.length - 1 };
    case '*': {
      const parentId = rows[index].parentId;
      const indexes = rows.flatMap((row, i) => (row.parentId === parentId && row.expanded === false ? [i] : []));
      return indexes.length ? { type: 'expandSiblings', indexes } : null;
    }
    case 'Enter':
      return { type: 'open', index };
    case ' ':
      return { type: 'select', index };
    default:
      return null;
  }
}

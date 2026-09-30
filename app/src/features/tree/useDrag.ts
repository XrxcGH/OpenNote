// Connects a tree to the drag controller: registers where the tree is on screen and what it shows, so a pointer
// over it finds its rows, and returns the pointer handlers for its container. The handlers are made once; the
// registration is what changes as the tree re-renders, and the controller reads it when an event comes.

import { useEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import { useNotes } from '../../services/notes';
import type { MenuAnchor } from '../../ui';
import { createDragHandlers } from './drag';
import { registerDragHost } from './dragState';
import type { Row } from './rows';
import type { TreeId } from './store';

type OpenMenu = (row: Row, anchor: MenuAnchor, returnFocus: HTMLElement) => void;

export function useDrag(
  tree: TreeId,
  container: RefObject<HTMLElement | null>,
  rows: readonly Row[],
  openMenu: OpenMenu,
) {
  const notes = useNotes();
  useEffect(
    () => registerDragHost({ tree, notes, container: () => container.current, rows: () => rows, openMenu }),
    [tree, notes, container, rows, openMenu],
  );
  return useMemo(() => createDragHandlers(tree), [tree]);
}

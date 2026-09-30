// TreeView, the WAI-ARIA tree pattern for both panes (ARCHITECTURE.md sections 13.2 to 13.4). Rows render flat
// with roving focus: Tab enters at the focused row and leaves at once. The navigation keys and type-ahead live
// here; keys with modifiers reach the registry's commands through the dispatcher, which runs first. Past 300
// rows it windows its rows, keeping the focused, selected, and renaming rows mounted.

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { NodeId } from '../../services/notes';
import { useStore } from '../../state/store';
import { ProgressBar, typeaheadMatch, useDelayedFlag, useTypeahead } from '../../ui';
import type { MenuAnchor } from '../../ui';
import { titleOf } from './actions';
import { treeKeyAction } from './keys';
import type { TreeKeyAction } from './keys';
import { openRow, setOpen } from './navigation';
import type { Row } from './rows';
import { select } from './selection';
import { rowKey, setFocus, treeStore } from './store';
import type { TreeId, TreeState } from './store';
import styles from './Tree.module.css';
import { TreeRow } from './TreeRow';
import type { TreeRowProps } from './TreeRow';
import { renderedIndexes, useViewport, WINDOW_THRESHOLD } from './windowing';
import { startRename } from './rename';

export interface TreeViewProps {
  readonly tree: TreeId;
  readonly label: string;
  readonly rows: readonly Row[];
  readonly selectedId: NodeId | null;
  readonly loading: boolean;
  readonly loadingLabel: string;
  /** Shown instead of the tree when it has no rows. */
  readonly empty: ReactNode;
  /** Fixed row height in CSS pixels, for windowing. */
  readonly rowHeight: number;
  /** Opens the row's context menu. */
  openMenu(row: Row, anchor: MenuAnchor, returnFocus: HTMLElement): void;
  /** Pointer handlers and the drop target for each row, from the drag controller. */
  readonly dragFor?: (row: Row) => Pick<TreeRowProps, 'pointer' | 'drop'>;
}

const SCOPES: Record<TreeId, string> = { notebooks: 'tree notebooksTree', pages: 'tree pagesTree' };
const pickRenaming = (state: TreeState) => state.renaming;
const pickRequest = (state: TreeState) => state.focusRequest;

/** Selection follows focus for sections and pages; notebooks and section groups aren't selectable. */
function follow(row: Row): void {
  if (row.node.kind === 'section' || row.node.kind === 'page') select(row.id, 'follow');
}

function applyKey(tree: TreeId, action: TreeKeyAction, rows: readonly Row[]): void {
  switch (action.type) {
    case 'focus':
      setFocus(tree, rows[action.index].id);
      follow(rows[action.index]);
      focusRowElement(tree, rows[action.index].id);
      return;
    case 'expand':
    case 'collapse':
      setOpen(tree, [rows[action.index].id], action.type === 'expand');
      return;
    case 'expandSiblings':
      setOpen(
        tree,
        action.indexes.map((i) => rows[i].id),
        true,
      );
      return;
    case 'open':
      void openRow(tree, rows[action.index]);
      return;
    case 'select':
      if (rows[action.index].node.kind !== 'notebook') select(rows[action.index].id, 'now');
  }
}

export function rowElement(tree: TreeId, id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tree="${tree}"] [data-node-id="${CSS.escape(id)}"]`);
}

function focusRowElement(tree: TreeId, id: string): void {
  rowElement(tree, id)?.focus();
}

/** Moves DOM focus to a requested row once it renders, then forgets the request. */
function useFocusRequests(tree: TreeId, rows: readonly Row[]): void {
  const request = useStore(treeStore, pickRequest);
  const applied = useRef(0);
  useLayoutEffect(() => {
    if (!request || request.tree !== tree || request.seq === applied.current) return;
    const element = rowElement(tree, request.id);
    if (!element) return;
    applied.current = request.seq;
    element.focus();
  }, [request, tree, rows]);
}

function useTreeKeys(props: TreeViewProps, focusIndex: number) {
  const { tree, rows } = props;
  const typeahead = useTypeahead((buffer) => {
    const index = typeaheadMatch(
      rows.map((row) => titleOf(row.node)),
      focusIndex,
      buffer,
    );
    if (index !== -1) applyKey(tree, { type: 'focus', index }, rows);
  });
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !(event.target as Element).matches('[role="treeitem"]')) return;
    const row = rows[focusIndex];
    if (!row) return;
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      const element = event.target as HTMLElement;
      props.openMenu(row, element, element);
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const action = treeKeyAction(event.key, rows, focusIndex);
    if (action) {
      event.preventDefault();
      applyKey(tree, action, rows);
    } else if (!event.shiftKey || event.key.length === 1) {
      if (typeahead(event)) event.preventDefault();
    }
  };
}

function useRowHandlers(props: TreeViewProps) {
  const { tree, openMenu } = props;
  const onPress = useCallback(
    (row: Row, event: MouseEvent) => {
      if ((event.target as Element).closest('button, input')) return;
      setFocus(tree, row.id);
      if (row.node.kind === 'section' || row.node.kind === 'page') select(row.id, 'now');
      else if (row.expanded !== undefined) setOpen(tree, [row.id], !row.expanded);
    },
    [tree],
  );
  const onToggle = useCallback((row: Row) => setOpen(tree, [row.id], !row.expanded), [tree]);
  const onRename = useCallback((row: Row) => startRename(row.id), []);
  const onMore = useCallback((row: Row, anchor: HTMLElement) => openMenu(row, anchor, anchor), [openMenu]);
  return { onPress, onToggle, onRename, onMore };
}

export function TreeView(props: TreeViewProps) {
  const { tree, label, rows, selectedId, loading, rowHeight } = props;
  const container = useRef<HTMLDivElement>(null);
  const focusId = useStore(treeStore, (state) => state.focus[tree]);
  const renaming = useStore(treeStore, pickRenaming);
  const indexOf = useMemo(() => new Map(rows.map((row, i) => [row.id as string, i])), [rows]);
  const focusIndex = indexOf.get(focusId ?? '') ?? indexOf.get(selectedId ?? '') ?? 0;
  const windowed = rows.length > WINDOW_THRESHOLD;
  const viewport = useViewport(container, windowed);
  const pinned = [focusIndex, indexOf.get(selectedId ?? '') ?? -1, indexOf.get(renaming?.id ?? '') ?? -1];
  const indexes = renderedIndexes(rows.length, rowHeight, viewport, pinned);
  const showProgress = useDelayedFlag(loading);
  const handlers = useRowHandlers(props);
  const onKeyDown = useTreeKeys(props, focusIndex);
  useFocusRequests(tree, rows);
  const onContextMenu = (event: MouseEvent) => {
    const element = (event.target as Element).closest<HTMLElement>('[role="treeitem"]');
    const row = element && rows[indexOf.get(element.dataset.nodeId ?? '') ?? -1];
    if (!element || !row || (event.target as Element).closest('input')) return;
    event.preventDefault();
    const keyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
    props.openMenu(row, keyboard ? element : { x: event.clientX, y: event.clientY }, element);
  };
  return (
    <div className={styles.treeArea}>
      {showProgress && <ProgressBar label={props.loadingLabel} />}
      {rows.length === 0 && !loading ? (
        <div className={styles.empty}>{props.empty}</div>
      ) : (
        <div
          ref={container}
          role="tree"
          aria-label={label}
          aria-busy={loading || undefined}
          data-tree={tree}
          data-scope={SCOPES[tree]}
          className={styles.tree}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          onFocus={(event) => {
            const id = (event.target as HTMLElement).dataset.nodeId;
            if (id) setFocus(tree, id as NodeId);
          }}
        >
          <div className={styles.rows} style={windowed ? { blockSize: rows.length * rowHeight } : undefined}>
            {indexes.map((index) => {
              const row = rows[index];
              return (
                <TreeRow
                  key={rowKey(row.id)}
                  tree={tree}
                  row={row}
                  selected={row.id === selectedId}
                  focused={index === focusIndex}
                  renaming={renaming?.id === row.id ? renaming : null}
                  top={windowed ? index * rowHeight : undefined}
                  {...props.dragFor?.(row)}
                  {...handlers}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

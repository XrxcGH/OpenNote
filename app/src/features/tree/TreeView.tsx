// TreeView, the WAI-ARIA tree pattern for both panes (ARCHITECTURE.md sections 13.2 to 13.4). Rows render flat
// with roving focus: Tab enters at the focused row and leaves at once. The navigation keys and type-ahead live
// here; keys with modifiers reach the registry's commands through the dispatcher, which runs first. Past 300
// rows it windows its rows, keeping the focused, selected, and renaming rows mounted.

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { isEnabled } from '../../app/flags';
import { executeCommand } from '../../commands/registry';
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import type { NodeId } from '../../services/notes';
import { useStore } from '../../state/store';
import { ProgressBar, typeaheadMatch, useDelayedFlag, useTypeahead } from '../../ui';
import type { MenuAnchor } from '../../ui';
import { titleOf } from './actions';
import { dragStore } from './dragState';
import { clearMulti, extendFrom, multiStore, rangeTo, toggleRow } from './multi';
import { treeKeyAction } from './keys';
import type { TreeKeyAction } from './keys';
import { openRow, setOpen } from './navigation';
import type { Row } from './rows';
import { select } from './selection';
import { requestFocus, rowKey, setFocus, treeStore } from './store';
import type { TreeId, TreeState } from './store';
import styles from './Tree.module.css';
import { TreeRow } from './TreeRow';
import { useDrag } from './useDrag';
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
}

const SCOPES: Record<TreeId, string> = { notebooks: 'tree notebooksTree', pages: 'tree pagesTree' };
const pickRenaming = (state: TreeState) => state.renaming;
const pickRequest = (state: TreeState) => state.focusRequest;

/** Selection follows focus for sections and pages; notebooks and section groups aren't selectable. */
function follow(row: Row): void {
  if (row.node.kind === 'section' || row.node.kind === 'page') select(row.id, 'follow');
}

function applyKey(tree: TreeId, action: TreeKeyAction, rows: readonly Row[]): void {
  clearMulti();
  switch (action.type) {
    case 'focus': {
      const { id } = rows[action.index];
      follow(rows[action.index]);
      // A windowed tree hasn't drawn a row far from the view, such as the last one for End. Ask for focus once it does.
      if (rowElement(tree, id)) {
        setFocus(tree, id);
        focusRowElement(tree, id);
      } else requestFocus(tree, id);
      return;
    }
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
    if (isEnabled('qol.multiSelect')) {
      if (event.shiftKey && !event.ctrlKey && !event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const target = extendFrom(tree, rows, focusIndex, event.key === 'ArrowDown' ? 1 : -1, props.selectedId);
        if (target) {
          setFocus(tree, target.id);
          if (rowElement(tree, target.id)) focusRowElement(tree, target.id);
          else requestFocus(tree, target.id);
        }
        return;
      }
      if (event.key === 'Escape' && multiStore.get().ids.length > 0) {
        event.preventDefault();
        clearMulti();
        return;
      }
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
  // The press handler reads the rows and the open row from here, so it stays the same function and rows don't redraw.
  const latest = useRef({ rows: props.rows, selectedId: props.selectedId });
  useLayoutEffect(() => {
    latest.current = { rows: props.rows, selectedId: props.selectedId };
  });
  const onPress = useCallback(
    (row: Row, event: MouseEvent) => {
      if ((event.target as Element).closest('button, input')) return;
      setFocus(tree, row.id);
      if (isEnabled('qol.multiSelect') && (event.ctrlKey || event.metaKey)) {
        toggleRow(tree, row, latest.current.selectedId);
        return;
      }
      if (isEnabled('qol.multiSelect') && event.shiftKey) {
        rangeTo(tree, latest.current.rows, row, latest.current.selectedId);
        return;
      }
      clearMulti();
      if (row.node.kind === 'section' || row.node.kind === 'page') select(row.id, 'now');
      else if (row.expanded !== undefined) setOpen(tree, [row.id], !row.expanded);
    },
    [tree],
  );
  const onAux = useCallback((row: Row, event: MouseEvent) => {
    if (event.button !== 1 || (row.node.kind !== 'page' && row.node.kind !== 'section')) return;
    event.preventDefault();
    void executeCommand('tabs.openInNewTab', undefined, 'menu', { kind: 'node', id: row.id });
  }, []);
  const onToggle = useCallback((row: Row) => setOpen(tree, [row.id], !row.expanded), [tree]);
  const onRename = useCallback((row: Row) => startRename(row.id), []);
  const onMore = useCallback((row: Row, anchor: HTMLElement) => openMenu(row, anchor, anchor), [openMenu]);
  return { onPress, onAux, onToggle, onRename, onMore };
}

/** Right-click, the Menu key, Shift+F10, and a long press without a drag all open the row's menu. */
function useRowContextMenu(props: TreeViewProps, indexOf: ReadonlyMap<string, number>) {
  const { rows, openMenu } = props;
  return (event: MouseEvent) => {
    const element = (event.target as Element).closest<HTMLElement>('[role="treeitem"]');
    const row = element && rows[indexOf.get(element.dataset.nodeId ?? '') ?? -1];
    if (!element || !row || (event.target as Element).closest('input')) return;
    event.preventDefault();
    const keyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
    openMenu(row, keyboard ? element : { x: event.clientX, y: event.clientY }, element);
  };
}

/** When the last row goes, focus moves to the empty message instead of being lost to the page. */
function useEmptyFocus(count: number) {
  const element = useRef<HTMLDivElement>(null);
  const before = useRef(count);
  useLayoutEffect(() => {
    if (count === 0 && before.current > 0 && document.activeElement === document.body) element.current?.focus();
    before.current = count;
  }, [count]);
  return element;
}

function useRowIndexes(props: TreeViewProps, container: RefObject<HTMLDivElement | null>) {
  const { tree, rows, selectedId, rowHeight } = props;
  const focusId = useStore(treeStore, (state) => state.focus[tree]);
  const renaming = useStore(treeStore, pickRenaming);
  const dragging = useStore(dragStore, (state) => state.id);
  const multiIds = useStore(multiStore, (state) => state.ids);
  const indexOf = useMemo(() => new Map(rows.map((row, i) => [row.id as string, i])), [rows]);
  const focusIndex = indexOf.get(focusId ?? '') ?? indexOf.get(selectedId ?? '') ?? 0;
  const windowed = rows.length > WINDOW_THRESHOLD;
  const viewport = useViewport(container, windowed);
  const pinned = [focusIndex, ...[selectedId, renaming?.id, dragging].map((id) => indexOf.get(id ?? '') ?? -1)];
  return {
    indexOf,
    focusIndex,
    windowed,
    renaming,
    multiIds,
    indexes: renderedIndexes(rows.length, rowHeight, viewport, pinned),
  };
}

export function TreeView(props: TreeViewProps) {
  const { tree, label, rows, selectedId, loading, rowHeight } = props;
  const container = useRef<HTMLDivElement>(null);
  const { indexOf, focusIndex, windowed, renaming, indexes, multiIds } = useRowIndexes(props, container);
  const showProgress = useDelayedFlag(loading);
  const emptyRef = useEmptyFocus(rows.length);
  const handlers = useRowHandlers(props);
  const drag = useDrag(tree, container, rows, props.openMenu);
  const onKeyDown = useTreeKeys(props, focusIndex);
  const onContextMenu = useRowContextMenu(props, indexOf);
  useFocusRequests(tree, rows);
  return (
    <div className={styles.treeArea}>
      {showProgress && <ProgressBar label={props.loadingLabel} />}
      {rows.length === 0 && !loading ? (
        <div ref={emptyRef} tabIndex={-1} className={styles.empty}>
          {props.empty}
        </div>
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
          {...drag}
        >
          <div className={styles.rows} style={windowed ? { blockSize: rows.length * rowHeight } : undefined}>
            {indexes.map((index) => (
              <TreeRow
                key={rowKey(rows[index].id)}
                tree={tree}
                row={rows[index]}
                selected={rows[index].id === selectedId || multiIds.includes(rows[index].id)}
                multi={multiIds.includes(rows[index].id)}
                focused={index === focusIndex}
                renaming={renaming?.id === rows[index].id ? renaming : null}
                top={windowed ? index * rowHeight : undefined}
                {...handlers}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

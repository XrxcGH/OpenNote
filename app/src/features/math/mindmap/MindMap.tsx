// A mind map (Further features, Phase 7). It is a real nested list for screen readers: a tree whose branches are
// items with levels, and folded branches say so. The picture is that same list, laid out with the main idea on the
// left. While a branch is being written, Tab adds a branch under it and Enter adds one beside it. Moving about uses
// the arrow keys, and every action is also a button, for a pen or a finger.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { INSERT_EVENT } from '../../tools/flags';
import styles from './mindmap.module.css';
import {
  addChild,
  addSibling,
  outlineList,
  parentOf,
  readMap,
  removeNode,
  setText,
  toggleFold,
  visibleRows,
} from './tree';
import type { MapNode } from './tree';

interface Props {
  data: Record<string, unknown>;
  readOnly: boolean;
  onChange(root: MapNode): void;
}

function insertOutline(root: MapNode): void {
  const detail = { text: outlineList(root), handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail }));
  announce(t(detail.handled ? 'study.mindmap.outlineInserted' : 'study.mindmap.noPage'));
}

export function MindMap({ data, readOnly, onChange }: Props) {
  const incoming = useMemo(() => readMap(data, t('study.mindmap.mainIdea')), [data]);
  const [root, setRoot] = useState(incoming);
  const sent = useRef(JSON.stringify(incoming));
  const [focus, setFocus] = useState(incoming.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const host = useRef<HTMLDivElement>(null);

  // Undo, redo, or another window changed the block: take its map.
  useEffect(() => {
    const text = JSON.stringify(incoming);
    if (text === sent.current) return;
    sent.current = text;
    setRoot(incoming);
  }, [incoming]);

  useEffect(() => {
    if (editing === null)
      host.current?.querySelector<HTMLElement>(`[data-node="${focus}"]`)?.focus({ preventScroll: true });
  }, [focus, editing, root]);

  const rows = visibleRows(root);
  const commit = (next: MapNode) => {
    setRoot(next);
    sent.current = JSON.stringify(next);
    onChange(next);
  };
  const edit = (id: string, from: MapNode = root) => {
    const found = rows.find((row) => row.node.id === id)?.node ?? from;
    setDraft(found.text);
    setFocus(id);
    setEditing(id);
  };
  const finish = (): MapNode => {
    if (editing === null) return root;
    const next = setText(root, editing, draft);
    if (next !== root) commit(next);
    return next;
  };
  const build = (kind: 'child' | 'sibling', from: string) => {
    const base = finish();
    const made = kind === 'child' ? addChild(base, from) : addSibling(base, from);
    commit(made.root);
    setDraft('');
    setFocus(made.added);
    setEditing(made.added);
    announce(t(kind === 'child' ? 'study.mindmap.childAdded' : 'study.mindmap.siblingAdded'));
  };
  const remove = (id: string) => {
    const removed = removeNode(root, id);
    if (removed.root === root) return;
    commit(removed.root);
    setFocus(removed.focus);
    announce(t('study.mindmap.removed'));
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      build('sibling', id);
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      build('child', id);
    } else if (event.key === 'Tab' || event.key === 'Escape') {
      if (event.key === 'Escape') event.preventDefault();
      if (event.key === 'Tab') finish();
      setEditing(null);
    }
  };

  const onItemKey = (event: KeyboardEvent<HTMLElement>, node: MapNode) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const at = rows.findIndex((row) => row.node.id === node.id);
    const go = (id: string | undefined) => {
      if (id) setFocus(id);
      event.preventDefault();
    };
    switch (event.key) {
      case 'ArrowDown':
        return go(rows[at + 1]?.node.id);
      case 'ArrowUp':
        return go(rows[at - 1]?.node.id);
      case 'Home':
        return go(rows[0].node.id);
      case 'End':
        return go(rows[rows.length - 1].node.id);
      case 'ArrowRight':
        if (node.folded && !readOnly) commit(toggleFold(root, node.id));
        return go(node.folded ? undefined : node.children[0]?.id);
      case 'ArrowLeft':
        if (node.children.length > 0 && !node.folded && !readOnly) {
          commit(toggleFold(root, node.id));
          return go(undefined);
        }
        return go(parentOf(root, node.id)?.id);
      case ' ':
        if (!readOnly) commit(toggleFold(root, node.id));
        return go(undefined);
      case 'Enter':
      case 'F2':
        if (!readOnly) edit(node.id);
        return go(undefined);
      case 'Delete':
      case 'Backspace':
        if (!readOnly) remove(node.id);
        return go(undefined);
      default:
    }
  };

  const level = (node: MapNode, depth: number) => {
    const open = !node.folded && node.children.length > 0;
    return (
      <li
        key={node.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={node.children.length > 0 ? !node.folded : undefined}
        aria-selected={focus === node.id}
        data-node={node.id}
        tabIndex={focus === node.id ? 0 : -1}
        className={styles.item}
        onKeyDown={(event) => onItemKey(event, node)}
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocus(node.id);
        }}
      >
        <div
          className={styles.chip}
          data-root={depth === 0 ? '' : undefined}
          data-folded={node.folded ? '' : undefined}
        >
          {editing === node.id ? (
            <input
              type="text"
              className={styles.input}
              aria-label={t('study.mindmap.branchText')}
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                finish();
                setEditing(null);
              }}
              onKeyDown={(event) => onInputKey(event, node.id)}
            />
          ) : (
            <span onDoubleClick={() => !readOnly && edit(node.id)}>{node.text || t('study.mindmap.empty')}</span>
          )}
          {node.folded ? (
            <span className={styles.count}>{t('study.mindmap.hidden', { count: node.children.length })}</span>
          ) : null}
        </div>
        {open ? (
          <ul role="group" className={styles.children}>
            {node.children.map((child) => level(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  const selected = rows.find((row) => row.node.id === focus)?.node ?? root;
  return (
    <div className={styles.root} ref={host}>
      {readOnly ? null : (
        <div className={styles.bar} role="toolbar" aria-label={t('study.mindmap.tools')}>
          <Button onClick={() => build('child', selected.id)}>{t('study.mindmap.addChild')}</Button>
          <Button onClick={() => build('sibling', selected.id)}>{t('study.mindmap.addSibling')}</Button>
          <Button onClick={() => commit(toggleFold(root, selected.id))} disabled={selected.children.length === 0}>
            {t(selected.folded ? 'study.mindmap.unfold' : 'study.mindmap.fold')}
          </Button>
          <Button variant="danger" onClick={() => remove(selected.id)} disabled={selected.id === root.id}>
            {t('study.mindmap.remove')}
          </Button>
          <Button variant="quiet" onClick={() => insertOutline(root)}>
            {t('study.mindmap.toOutline')}
          </Button>
        </div>
      )}
      <ul role="tree" aria-label={t('study.mindmap.label')} className={styles.tree}>
        {level(root, 0)}
      </ul>
      <p className={styles.help}>{t('study.mindmap.keys')}</p>
    </div>
  );
}

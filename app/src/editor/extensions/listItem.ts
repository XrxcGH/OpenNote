// List items (ARCHITECTURE.md section 8.2; owner: WP4): Enter and Backspace in lists, and task items with a real
// checkbox. A normalizer joins adjacent lists of one kind, which canonical Markdown can't keep apart.
//
// A task item's node view puts a native checkbox in the item's marker box, named by the item's text, and leaves
// the item's content in a block of its own. It looks like the static `toDOM` rendering, whose marker draws the same
// box, so mounting an editor moves nothing.
import type { Editor, Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { liftListItem, splitListItem } from '@tiptap/pm/schema-list';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import type { EditorHost } from '../host';
import { META_COMMAND, META_REMOTE } from '../meta';
import { ListItem } from '../schema/nodes';
import styles from './content.module.css';

const LISTS = new Set(['bulletList', 'orderedList']);

/** Attributes a new item never copies from the one it was split from: element IDs and tags stay unique. */
const FRESH = { id: null, tags: [], style: null, tagChecked: false };

/** Enter: a new item after this one. A new task starts unchecked; an empty item leaves the list. */
function splitItem(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const item = $from.node(-1);
  if (item?.type.name !== 'listItem' || $from.index(-1) !== 0) return false;
  const checked = item.attrs.checked === null ? null : false;
  return splitListItem(state.schema.nodes.listItem, { ...FRESH, checked })(state, editor.view.dispatch);
}

/** Backspace at the start of an item's first paragraph lifts the item out one level. */
function liftAtStart(editor: Editor): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  const item = $from.node(-1);
  if (item?.type.name !== 'listItem' || $from.index(-1) !== 0) return false;
  if (item.attrs.checked !== null) {
    editor.view.dispatch(state.tr.setNodeMarkup($from.before(-1), undefined, { ...item.attrs, checked: null }));
    return true;
  }
  return liftListItem(state.schema.nodes.listItem)(state, editor.view.dispatch);
}

/** The positions after lists whose next sibling is a list of the same kind, inside the changed ranges. */
function adjacentLists(tr: Transaction): number[] {
  const joins: number[] = [];
  const doc = tr.doc;
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  for (const [from, to] of ranges) {
    const start = Math.max(0, from - 1);
    const end = Math.min(doc.content.size, to + 1);
    doc.nodesBetween(start, end, (node, pos) => {
      if (!LISTS.has(node.type.name)) return true;
      const after = pos + node.nodeSize;
      const next = after < doc.content.size ? doc.resolve(after).nodeAfter : null;
      if (next?.type === node.type && !joins.includes(after)) joins.push(after);
      return true;
    });
  }
  return joins.sort((a, b) => b - a);
}

/** Joins adjacent lists of one kind after each local change (ARCHITECTURE.md section 8.1). */
function joinListsPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('opennoteJoinLists'),
    appendTransaction(transactions: readonly Transaction[], _old: EditorState, state: EditorState) {
      const changed = transactions.filter((tr) => tr.docChanged && !tr.getMeta(META_REMOTE));
      if (changed.length === 0) return null;
      const joins = changed.flatMap(adjacentLists);
      if (joins.length === 0) return null;
      const tr = state.tr;
      for (const pos of [...new Set(joins)].sort((a, b) => b - a)) {
        const $pos = tr.doc.resolve(pos);
        if ($pos.nodeBefore && $pos.nodeAfter && $pos.nodeBefore.type === $pos.nodeAfter.type) tr.join(pos);
      }
      return tr.docChanged ? tr.setMeta(META_COMMAND, true) : null;
    },
  });
}

/** The words of an item, for its checkbox's name. */
function itemText(node: PMNode): string {
  return node.firstChild?.textContent.trim() || t('editor.list.emptyTask');
}

class TaskItemView implements NodeView {
  dom: HTMLLIElement;
  contentDOM: HTMLElement;
  private box: HTMLInputElement;

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('li');
    this.dom.className = styles.task;
    const marker = document.createElement('span');
    marker.className = styles.taskBox;
    marker.contentEditable = 'false';
    this.box = document.createElement('input');
    this.box.type = 'checkbox';
    this.box.tabIndex = -1;
    this.box.addEventListener('change', () => this.toggle());
    marker.append(this.box);
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = styles.taskBody;
    this.dom.append(marker, this.contentDOM);
    this.render();
  }

  private render(): void {
    const checked = this.node.attrs.checked === true;
    this.dom.dataset.checked = String(checked);
    this.box.checked = checked;
    this.box.setAttribute('aria-label', itemText(this.node));
    this.box.disabled = !this.editor.isEditable;
  }

  private toggle(): void {
    const pos = this.getPos();
    if (pos === undefined || !this.editor.isEditable) return this.render();
    const checked = this.node.attrs.checked !== true;
    const tr = this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked });
    this.editor.view.dispatch(tr.setMeta(META_COMMAND, true));
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs.checked === null) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.box;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}

/** A plain item: an `li` that turns into a task view when it gains a checkbox. */
function plainItemView(node: PMNode): NodeView {
  const dom = document.createElement('li');
  return { dom, contentDOM: dom, update: (next: PMNode) => next.type === node.type && next.attrs.checked === null };
}

export function listItemExtensions(_host: EditorHost): Extensions {
  return [
    ListItem.extend({
      addKeyboardShortcuts() {
        return {
          Enter: () => splitItem(this.editor),
          Backspace: () => liftAtStart(this.editor),
        };
      },
      addNodeView() {
        return ({ node, editor, getPos }) =>
          node.attrs.checked === null ? plainItemView(node) : new TaskItemView(node, editor, getPos);
      },
      addProseMirrorPlugins() {
        return [joinListsPlugin()];
      },
    }),
  ];
}

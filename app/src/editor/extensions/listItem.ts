// List items (ARCHITECTURE.md section 8.2; owner: WP4): Enter and Backspace in lists, and task items with a real
// checkbox. A normalizer joins adjacent lists of one kind, which canonical Markdown can't keep apart. Another keeps
// each ordered list's Markdown start number at the number its first item shows (R-LIST-3).
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
import { carriedParaAttrs } from '../paragraph/carry';
import { readLists, shownStarts } from '../paragraph/numbering';
import type { ListDefinitions } from '../paragraph/numbering';
import { ListItem } from '../schema/nodes';
import styles from './content.module.css';

const LISTS = new Set(['bulletList', 'orderedList']);

/** Attributes a new item never copies from the one it was split from: element IDs and tags stay unique. */
const FRESH = { id: null, tags: [], style: null, tagChecked: false };

/**
 * Enter: a new item after this one, with the item's paragraph formatting but not its ID (text DESIGN.md 2.3). A new
 * task starts unchecked; an empty item leaves the list.
 */
function splitItem(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const item = $from.node(-1);
  if (item?.type.name !== 'listItem' || $from.index(-1) !== 0) return false;
  const checked = item.attrs.checked === null ? null : false;
  const attrs = { ...carriedParaAttrs(item.attrs), ...FRESH, checked };
  return splitListItem(state.schema.nodes.listItem, attrs)(state, editor.view.dispatch);
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

/** The meta a transaction carries to give the editor its block's `data.lists`. */
export const LISTS_META = 'opennote.lists';

interface StartsState {
  lists: ListDefinitions;
  /** Whether any list item names a list. Only then can a start number change, so other documents pay nothing. */
  active: boolean;
}

const startsKey = new PluginKey<StartsState>('opennoteListStarts');

const namesList = (node: PMNode) => node.type.name === 'listItem' && node.attrs.list != null;

/** Whether a list item in the document names a list. */
function hasListRefs(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found || node.isTextblock) return false;
    found = namesList(node);
    return !found;
  });
  return found;
}

/** Whether a list item that names a list is inside a range the transaction changed. */
function touchesListRefs(tr: Transaction): boolean {
  let found = false;
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (found) return;
      const from = Math.max(0, rest.map(newStart, -1));
      const to = Math.min(tr.doc.content.size, rest.map(newEnd, 1));
      tr.doc.nodesBetween(from, to, (node) => {
        if (found || node.isTextblock) return false;
        found = namesList(node);
        return !found;
      });
    });
  });
  return found;
}

/**
 * Sets each ordered list's start number to the number its first item shows, when the item names a list (R-LIST-3).
 * So the Markdown that version 1 readers see numbers on from the list before it. A list of plain items keeps its own.
 */
function listStartsPlugin(): Plugin<StartsState> {
  return new Plugin<StartsState>({
    key: startsKey,
    state: {
      init: (_config, state) => ({ lists: new Map(), active: hasListRefs(state.doc) }),
      apply(tr, old) {
        const meta: unknown = tr.getMeta(LISTS_META);
        const lists = meta === undefined ? old.lists : readLists(meta);
        if (meta !== undefined) return { lists, active: hasListRefs(tr.doc) };
        if (!tr.docChanged) return old;
        return { lists, active: old.active ? hasListRefs(tr.doc) : touchesListRefs(tr) };
      },
    },
    appendTransaction(transactions: readonly Transaction[], _old: EditorState, state: EditorState) {
      const own = startsKey.getState(state);
      if (!own?.active) return null;
      if (!transactions.some((tr) => tr.docChanged || tr.getMeta(LISTS_META) !== undefined)) return null;
      if (transactions.every((tr) => tr.getMeta(META_REMOTE))) return null;
      const starts = shownStarts(state.doc, own.lists);
      if (starts.length === 0) return null;
      const tr = state.tr;
      for (const { pos, start } of starts) tr.setNodeAttribute(pos, 'start', start);
      if (transactions.every((each) => each.getMeta('addToHistory') === false)) tr.setMeta('addToHistory', false);
      return tr.setMeta(META_COMMAND, true);
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
  private marker: HTMLElement;

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
    this.marker = marker;
    this.box = document.createElement('input');
    this.box.type = 'checkbox';
    this.box.tabIndex = -1;
    this.box.addEventListener('change', () => this.toggle());
    // In touch density the marker's hit area is 44 px around the 1 em box (content.module.css): a tap on it toggles.
    marker.addEventListener('click', (event) => {
      if (event.target === marker) this.box.click();
    });
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
    return event.target === this.box || event.target === this.marker;
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
        return [joinListsPlugin(), listStartsPlugin()];
      },
    }),
  ];
}

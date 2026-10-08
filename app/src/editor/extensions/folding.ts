// Fold buttons and folded content (ARCHITECTURE.md section 18.2; owner: WP4). Headings and list items with
// something to fold get a real button with aria-expanded and a name ("Collapse Light reactions"), outside the Tab
// order. Folded content gets the `hidden` attribute, so it leaves the accessibility tree too.
//
// Folds are positions that edits map. Typing inside a textblock only maps the decorations; a structural change
// rebuilds them. The page saves folds through FOLDS_EVENT and restores them through FOLDS_REQUEST_EVENT.
import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import { FOLDS_EVENT, FOLDS_REQUEST_EVENT } from '../commands/state';
import type { FoldsDetail, FoldsRequestDetail } from '../commands/state';
import {
  META_FOLDS,
  foldKey,
  foldKeysFor,
  foldableAt,
  foldables,
  foldsHiding,
  foldsOf,
  hiddenRanges,
  positionsFor,
  rememberFolds,
  setFolds,
} from '../commands/fold';
import type { FoldKind } from '../commands/fold';
import type { EditorHost } from '../host';
import { META_REMOTE } from '../meta';
import styles from './content.module.css';

interface PluginValue {
  folded: readonly number[];
  decorations: DecorationSet;
  /** Fold nodes the last change touched, whose buttons may need their names updated. */
  touched: readonly number[];
}

/** The name a fold button and its announcements use: the heading's or item's own words. */
function foldName(node: PMNode, kind: FoldKind): string {
  const text = (kind === 'heading' ? node.textContent : (node.firstChild?.textContent ?? '')).trim();
  return text || t('editor.list.emptyTask');
}

function paragraphsIn(doc: PMNode, ranges: readonly [number, number][]): number {
  let count = 0;
  for (const [from, to] of ranges) {
    doc.nodesBetween(from, to, (node) => {
      if (node.isTextblock) count += 1;
      return !node.isTextblock;
    });
  }
  return count;
}

function toggle(view: EditorView, host: EditorHost, pos: number): void {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  const kind = foldableAt(state.doc, pos);
  if (!node || !kind) return;
  const folded = foldKey.getState(state)?.folded ?? [];
  const isFolded = folded.includes(pos);
  const next = isFolded ? folded.filter((at) => at !== pos) : [...folded, pos];
  view.dispatch(setFolds(state.tr, next));
  const name = foldName(node, kind);
  const count = paragraphsIn(state.doc, hiddenRanges(state.doc, pos));
  host.announce(isFolded ? t('editor.fold.expanded', { name }) : t('editor.fold.folded', { name, count }));
}

const buttonLabel = (node: PMNode, kind: FoldKind, folded: boolean) =>
  t(folded ? 'editor.fold.expand' : 'editor.fold.collapse', { name: foldName(node, kind) });

function button(host: EditorHost, node: PMNode, kind: FoldKind, folded: boolean) {
  return (view: EditorView, getPos: () => number | undefined): HTMLElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = styles.foldButton;
    element.contentEditable = 'false';
    element.tabIndex = -1;
    element.setAttribute('aria-expanded', String(!folded));
    element.setAttribute('aria-label', buttonLabel(node, kind, folded));
    element.dataset.folded = String(folded);
    element.addEventListener('pointerdown', (event) => event.preventDefault());
    element.addEventListener('click', () => {
      const at = getPos();
      if (at === undefined) return;
      // A heading's button sits just before it; a list item's sits inside it, before its first paragraph.
      toggle(view, host, kind === 'heading' ? at : at - 1);
    });
    return element;
  };
}

function widgetFor(host: EditorHost, doc: PMNode, pos: number, folded: ReadonlySet<number>): Decoration | null {
  const kind = foldableAt(doc, pos);
  const node = doc.nodeAt(pos);
  if (!kind || !node) return null;
  const on = folded.has(pos);
  return Decoration.widget(kind === 'heading' ? pos : pos + 1, button(host, node, kind, on), {
    side: -1,
    // No name in the key: typing in a heading or item keeps its button, and relabel() renames it. A new button on
    // every key restyled and relaid the whole note, several ms a key in a long outline.
    key: `fold:${kind}:${on}`,
    ignoreSelection: true,
    stopEvent: () => true,
    fold: true,
  });
}

/** The `hidden` attribute on what each fold hides, and the folded mark on the folded node. */
function hiddenFor(doc: PMNode, folded: readonly number[]): Decoration[] {
  const decorations: Decoration[] = [];
  for (const pos of folded) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-folded': 'true' }, { hidden: true }));
    for (const [from, to] of hiddenRanges(doc, pos)) {
      decorations.push(Decoration.node(from, to, { hidden: 'hidden' }, { hidden: true }));
    }
  }
  return decorations;
}

/** Every fold button and every hidden range, from scratch: when an editor starts. */
function build(host: EditorHost, doc: PMNode, folded: readonly number[]): DecorationSet {
  const isFolded = new Set(folded);
  const widgets = foldables(doc)
    .map(({ pos }) => widgetFor(host, doc, pos, isFolded))
    .filter((decoration): decoration is Decoration => decoration !== null);
  return DecorationSet.create(doc, [...widgets, ...hiddenFor(doc, folded)]);
}

const isFoldNode = (node: PMNode) => node.type.name === 'listItem' || node.type.name === 'heading';

/** The headings whose sections can change with an edit at `$pos`: the nearest earlier ones, one per level. */
function headingsBefore(doc: PMNode, pos: number, add: (pos: number) => void): void {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const container = $pos.node(depth);
    if (container.type.name.endsWith('List') || container.type.name === 'listItem' || container.isTextblock) continue;
    let offset = depth === 0 ? 0 : $pos.start(depth);
    const index = $pos.index(depth);
    const starts: number[] = [];
    for (let at = 0; at < Math.min(index + 1, container.childCount); at += 1) {
      starts.push(offset);
      offset += container.child(at).nodeSize;
    }
    let lowest = 7;
    for (let at = starts.length - 1; at >= 0 && lowest > 1; at -= 1) {
      const child = container.child(at);
      if (child.type.name !== 'heading') continue;
      const level = child.attrs.level as number;
      if (level < lowest) {
        lowest = level;
        add(starts[at]);
      }
    }
  }
}

/**
 * The fold buttons an edit can change: headings and items it touched, their ancestors (whose children or text
 * changed), and the headings whose sections it can reach. Everything else only maps.
 */
function touched(tr: Transaction): Set<number> {
  const doc = tr.doc;
  const found = new Set<number>();
  const add = (pos: number) => void found.add(pos);
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, Math.min(doc.content.size, rest.map(newStart, -1)));
      const to = Math.max(from, Math.min(doc.content.size, rest.map(newEnd, 1)));
      for (const at of [from, to]) {
        const $at = doc.resolve(at);
        for (let depth = $at.depth; depth > 0; depth -= 1) if (isFoldNode($at.node(depth))) add($at.before(depth));
        headingsBefore(doc, at, add);
      }
      doc.nodesBetween(from, to, (node, pos) => {
        if (isFoldNode(node)) add(pos);
        return !node.isTextblock;
      });
    });
  });
  return found;
}

/** Maps the decorations, then rebuilds the buttons the change touched and every hidden range. */
function update(
  host: EditorHost,
  tr: Transaction,
  previous: DecorationSet,
  folded: readonly number[],
  extra: Iterable<number> = [],
): Omit<PluginValue, 'folded'> {
  const doc = tr.doc;
  let set = previous.map(tr.mapping, doc);
  const targets = tr.docChanged ? touched(tr) : new Set<number>();
  for (const pos of extra) targets.add(pos);
  const isFolded = new Set(folded);
  const stale: Decoration[] = set.find(undefined, undefined, (spec) => spec.hidden === true);
  const fresh: Decoration[] = hiddenFor(doc, folded);
  for (const pos of targets) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    const at = node.type.name === 'heading' ? pos : pos + 1;
    stale.push(...set.find(at, at, (spec) => spec.fold === true));
    const widget = widgetFor(host, doc, pos, isFolded);
    if (widget) fresh.push(widget);
  }
  set = set.remove(stale);
  return { decorations: set.add(doc, fresh), touched: [...targets] };
}

/** Renames the buttons of the fold nodes a change touched, in place, when their words changed. */
function relabel(view: EditorView, positions: readonly number[]): void {
  const folded = foldKey.getState(view.state)?.folded ?? [];
  for (const pos of positions) {
    const node = view.state.doc.nodeAt(pos);
    const kind = foldableAt(view.state.doc, pos);
    const dom = view.nodeDOM(pos);
    if (!node || !kind || !(dom instanceof HTMLElement)) continue;
    // A heading's button sits just before it; a list item's sits inside it, first.
    const element = kind === 'heading' ? dom.previousElementSibling : dom.firstElementChild;
    if (!element?.classList.contains(styles.foldButton)) continue;
    const label = buttonLabel(node, kind, folded.includes(pos));
    if (element.getAttribute('aria-label') !== label) element.setAttribute('aria-label', label);
  }
}

function apply(host: EditorHost, tr: Transaction, value: PluginValue, state: EditorState): PluginValue {
  const set = tr.getMeta(META_FOLDS) as readonly number[] | undefined;
  if (set) {
    rememberFolds(state.doc, set);
    // The buttons whose state flipped get new names and aria-expanded.
    const flipped = [
      ...set.filter((pos) => !value.folded.includes(pos)),
      ...value.folded.filter((pos) => !set.includes(pos)),
    ];
    return { folded: set, ...update(host, tr, value.decorations, set, flipped) };
  }
  if (!tr.docChanged) {
    rememberFolds(state.doc, value.folded);
    return value.touched.length ? { ...value, touched: [] } : value;
  }
  const folded = value.folded
    .map((pos) => tr.mapping.mapResult(pos, 1))
    .filter((result) => !result.deleted)
    .map((result) => result.pos)
    .filter((pos) => foldableAt(state.doc, pos) !== null);
  rememberFolds(state.doc, folded);
  return { folded, ...update(host, tr, value.decorations, folded) };
}

/**
 * An undo or redo (a change from the core) that changes something inside a fold opens that fold, so the change is
 * where the person can see it. Folds the change doesn't touch stay shut.
 */
function openFoldsAfterUndo(transactions: readonly Transaction[], state: EditorState): Transaction | null {
  const hiding = new Set<number>();
  const note = (pos: number) =>
    foldsHiding(state, Math.min(Math.max(pos, 0), state.doc.content.size)).forEach((f) => hiding.add(f));
  for (const tr of transactions) {
    if (!tr.docChanged || !tr.getMeta(META_REMOTE)) continue;
    tr.mapping.maps.forEach((map, index) => {
      map.forEach((_from, _to, start, end) => {
        const rest = tr.mapping.slice(index + 1);
        note(rest.map(start, 1));
        if (end > start) note(rest.map(end, -1) - 1);
      });
    });
    note(state.selection.head);
  }
  if (hiding.size === 0) return null;
  return setFolds(
    state.tr,
    foldsOf(state).filter((fold) => !hiding.has(fold)),
  );
}

function foldingPlugin(host: EditorHost): Plugin<PluginValue> {
  return new Plugin<PluginValue>({
    key: foldKey as never,
    appendTransaction: (transactions, _old, state) => openFoldsAfterUndo(transactions, state),
    state: {
      init: (_config, state) => {
        rememberFolds(state.doc, []);
        return { folded: [], decorations: build(host, state.doc, []), touched: [] };
      },
      apply: (tr, value, _old, state) => apply(host, tr, value, state),
    },
    props: {
      decorations: (state) => (foldKey.getState(state) as unknown as PluginValue | undefined)?.decorations,
    },
    view(view) {
      const block = view.dom.getAttribute('data-block') ?? '';
      // The page answers with the folds it saved for this block, if any.
      const request: FoldsRequestDetail = {
        block,
        provide: (keys) =>
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            const positions = positionsFor(view.state.doc, keys);
            if (positions.length > 0) view.dispatch(setFolds(view.state.tr, positions));
          }),
      };
      view.dom.dispatchEvent(new CustomEvent(FOLDS_REQUEST_EVENT, { bubbles: true, detail: request }));
      return {
        update(_view, previous) {
          const value = foldKey.getState(view.state) as unknown as PluginValue | undefined;
          if (value && value !== (foldKey.getState(previous) as unknown)) relabel(view, value.touched);
          const before = foldKey.getState(previous)?.folded;
          const now = foldKey.getState(view.state)?.folded;
          if (before === now || !now) return;
          if (before && before.length === now.length && before.every((pos, index) => pos === now[index])) return;
          const detail: FoldsDetail = { block, keys: foldKeysFor(view.state.doc, block) };
          view.dom.dispatchEvent(new CustomEvent(FOLDS_EVENT, { bubbles: true, detail }));
        },
      };
    },
  });
}

export function foldingExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'opennoteFolding',
      addProseMirrorPlugins: () => (host.flag('page.outline') ? [foldingPlugin(host)] : []),
    }),
  ];
}

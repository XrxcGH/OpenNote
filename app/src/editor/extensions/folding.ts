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
import { ReplaceStep } from '@tiptap/pm/transform';
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
  hiddenRanges,
  positionsFor,
  rememberFolds,
  setFolds,
} from '../commands/fold';
import type { FoldKind } from '../commands/fold';
import type { EditorHost } from '../host';
import styles from './content.module.css';

interface PluginValue {
  folded: readonly number[];
  decorations: DecorationSet;
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

function button(host: EditorHost, node: PMNode, kind: FoldKind, folded: boolean) {
  return (view: EditorView, getPos: () => number | undefined): HTMLElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = styles.foldButton;
    element.contentEditable = 'false';
    element.tabIndex = -1;
    const name = foldName(node, kind);
    element.setAttribute('aria-expanded', String(!folded));
    element.setAttribute('aria-label', t(folded ? 'editor.fold.expand' : 'editor.fold.collapse', { name }));
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

/** Every fold button, and the `hidden` attribute on what each fold hides. */
function build(host: EditorHost, doc: PMNode, folded: readonly number[]): DecorationSet {
  const decorations: Decoration[] = [];
  const isFolded = new Set(folded);
  for (const { pos, kind, node } of foldables(doc)) {
    const on = isFolded.has(pos);
    const at = kind === 'heading' ? pos : pos + 1;
    decorations.push(
      Decoration.widget(at, button(host, node, kind, on), {
        side: -1,
        key: `fold:${kind}:${on}:${foldName(node, kind)}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
    if (!on) continue;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-folded': 'true' }));
    for (const [from, to] of hiddenRanges(doc, pos)) decorations.push(Decoration.node(from, to, { hidden: 'hidden' }));
  }
  return DecorationSet.create(doc, decorations);
}

/** Whether the transaction only edits text inside textblocks, which changes no fold. */
function onlyText(tr: Transaction): boolean {
  return tr.steps.every((step, index) => {
    if (!(step instanceof ReplaceStep)) return false;
    const doc = tr.docs[index];
    const { from, to, slice } = step as ReplaceStep & { from: number; to: number };
    if (slice.openStart !== 0 || slice.openEnd !== 0) return false;
    let inline = true;
    slice.content.forEach((node) => void (inline = inline && node.isInline));
    const $from = doc.resolve(from);
    return inline && $from.parent.isTextblock && $from.sameParent(doc.resolve(to));
  });
}

function apply(host: EditorHost, tr: Transaction, value: PluginValue, state: EditorState): PluginValue {
  const set = tr.getMeta(META_FOLDS) as readonly number[] | undefined;
  if (set) {
    rememberFolds(state.doc, set);
    return { folded: set, decorations: build(host, state.doc, set) };
  }
  if (!tr.docChanged) {
    rememberFolds(state.doc, value.folded);
    return value;
  }
  const folded = value.folded
    .map((pos) => tr.mapping.mapResult(pos, 1))
    .filter((result) => !result.deleted)
    .map((result) => result.pos)
    .filter((pos) => foldableAt(state.doc, pos) !== null);
  rememberFolds(state.doc, folded);
  if (onlyText(tr)) return { folded, decorations: value.decorations.map(tr.mapping, tr.doc) };
  return { folded, decorations: build(host, state.doc, folded) };
}

function foldingPlugin(host: EditorHost): Plugin<PluginValue> {
  return new Plugin<PluginValue>({
    key: foldKey as never,
    state: {
      init: (_config, state) => {
        rememberFolds(state.doc, []);
        return { folded: [], decorations: build(host, state.doc, []) };
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

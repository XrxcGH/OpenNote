// How the paginated view pushes content past a sheet edge. A text block's lines are in an editor or in static DOM, and
// both get the same planned spacers: an editor through a ProseMirror plugin, so its own rendering keeps them, and
// static text by inserting the spacer in the DOM. A spacer is empty, so it never changes the text.
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { LineStart } from '../print';
import styles from './live.module.css';

/** What an editor shows: room above some top-level elements, and spacers at places inside the text. */
export interface EditorSpacers {
  /** Top-level element index to the margin above it, in page units. */
  readonly margins: ReadonlyMap<number, number>;
  readonly widgets: readonly { readonly pos: number; readonly push: number }[];
}

const NONE: EditorSpacers = { margins: new Map(), widgets: [] };

interface SpacerState {
  readonly set: DecorationSet;
  /** What the set was built from, so a plan that changes nothing sends nothing. */
  readonly signature: string;
}

export const spacerKey = new PluginKey<SpacerState>('opennote-page-spacers');

const signatureOf = (spec: EditorSpacers): string => JSON.stringify([[...spec.margins], spec.widgets]);

function spacerElement(push: number): HTMLElement {
  const element = document.createElement('div');
  element.className = styles.spacer;
  element.dataset.pgSpacer = '';
  element.contentEditable = 'false';
  element.setAttribute('aria-hidden', 'true');
  element.style.blockSize = `${push}px`;
  return element;
}

function decorations(doc: PMNode, spec: EditorSpacers): DecorationSet {
  const found: Decoration[] = [];
  doc.forEach((node, offset, index) => {
    const margin = spec.margins.get(index);
    if (margin)
      found.push(
        Decoration.node(offset, offset + node.nodeSize, { 'data-pg-push': '', style: `--pg-push:${margin}px` }),
      );
  });
  for (const { pos, push } of spec.widgets) {
    if (pos >= 0 && pos <= doc.content.size) {
      found.push(
        Decoration.widget(pos, () => spacerElement(push), { side: -1, ignoreSelection: true, key: `s${pos}-${push}` }),
      );
    }
  }
  return DecorationSet.create(doc, found);
}

function spacerPlugin(): Plugin<SpacerState> {
  return new Plugin<SpacerState>({
    key: spacerKey,
    state: {
      init: () => ({ set: DecorationSet.empty, signature: '' }),
      apply(tr, state) {
        const meta = tr.getMeta(spacerKey) as EditorSpacers | undefined;
        if (meta) return { set: decorations(tr.doc, meta), signature: signatureOf(meta) };
        return tr.docChanged ? { ...state, set: state.set.map(tr.mapping, tr.doc) } : state;
      },
    },
    props: { decorations: (state: EditorState) => spacerKey.getState(state)?.set },
  });
}

/** Sets an editor's spacers. */
export function setEditorSpacers(editor: Editor, spec: EditorSpacers): void {
  if (editor.isDestroyed) return;
  if (!spacerKey.getState(editor.state)) editor.registerPlugin(spacerPlugin());
  if (spacerKey.getState(editor.state)?.signature === signatureOf(spec)) return;
  editor.view.dispatch(editor.state.tr.setMeta(spacerKey, spec).setMeta('addToHistory', false));
}

/** Takes every spacer away from an editor. */
export function clearEditorSpacers(editor: Editor): void {
  if (editor.isDestroyed || !spacerKey.getState(editor.state)) return;
  setEditorSpacers(editor, NONE);
}

/** The ProseMirror position of a DOM place in an editor. */
export function positionOf(editor: Editor, at: LineStart): number | null {
  try {
    return editor.view.posAtDOM(at.node, at.offset);
  } catch {
    return null;
  }
}

/** Inserts static spacers at DOM places in `root`, last place first, so earlier places stay where they are. */
export function insertStaticSpacers(
  root: HTMLElement,
  spacers: readonly { readonly at: LineStart; readonly push: number }[],
  order: (a: LineStart, b: LineStart) => number,
): void {
  const doc = root.ownerDocument;
  for (const { at, push } of [...spacers].sort((a, b) => order(b.at, a.at))) {
    const element = doc.createElement('div');
    element.className = styles.spacer;
    element.dataset.staticSpacer = '';
    element.dataset.pgSpacer = '';
    element.contentEditable = 'false';
    element.setAttribute('aria-hidden', 'true');
    element.style.blockSize = `${push}px`;
    const range = doc.createRange();
    range.setStart(at.node, at.offset);
    range.collapse(true);
    range.insertNode(element);
  }
}

/** Removes the spacers inserted into static text, and joins the text they split. */
export function removeStaticSpacers(root: HTMLElement): void {
  const found = root.querySelectorAll('[data-static-spacer]');
  if (found.length === 0) return;
  const parents = new Set<Node>();
  found.forEach((element) => {
    if (element.parentNode) parents.add(element.parentNode);
    element.remove();
  });
  parents.forEach((parent) => parent.normalize());
}

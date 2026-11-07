// Show formatting marks: decorations that draw a pilcrow at the end of each paragraph, a middle dot for a space, an
// arrow for a tab, a degree sign for a nonbreaking space, and a not sign for an optional hyphen. They are decorations
// only, so the document, its Markdown, and the undo history never change. The marks are drawn by CSS from the
// data-fmark attribute (invisibles.module.css), and the pilcrow is a widget the caret and selection skip.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { editorExtensions } from './kit';
import { formattingMarks } from './invisiblesStore';
import './invisibles.module.css';

export { formattingMarks };

/** The characters that get a mark, and the kind CSS draws for each. */
export const MARK_KINDS: Readonly<Record<string, string>> = {
  ' ': 'space',
  '\t': 'tab',
  '\u00a0': 'nbsp',
  '\u00ad': 'shy',
};

const marksKey = new PluginKey<DecorationSet>('opennoteFormattingMarks');

/** The marks an editor state shows now (tests compare them with a full redraw). */
export const shownMarks = (state: EditorState): DecorationSet => marksKey.getState(state) ?? DecorationSet.empty;

function pilcrow(): HTMLElement {
  const span = document.createElement('span');
  span.setAttribute('data-fmark', 'para');
  span.setAttribute('aria-hidden', 'true');
  span.contentEditable = 'false';
  return span;
}

/** The decorations of one text block at pos: a mark for each marked character, and a pilcrow after the last one. */
function blockDecorations(block: PMNode, pos: number, out: Decoration[]): void {
  out.push(Decoration.widget(pos + block.nodeSize - 1, pilcrow, { side: 1, key: 'fmark-para' }));
  block.forEach((child, offset) => {
    if (!child.isText || !child.text) return;
    const start = pos + 1 + offset;
    for (let i = 0; i < child.text.length; i += 1) {
      const kind = MARK_KINDS[child.text.charAt(i)];
      if (kind) out.push(Decoration.inline(start + i, start + i + 1, { 'data-fmark': kind }));
    }
  });
}

/** The decorations for a document: the marks of every text block, and a pilcrow after each one. */
export function marksFor(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) blockDecorations(node, pos, decorations);
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decorations);
}

/** The text blocks of the new document that a transaction touched, as [pos, end] pairs. */
function touchedBlocks(tr: Transaction): Map<number, number> {
  const blocks = new Map<number, number>();
  const size = tr.doc.content.size;
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_from, _to, newFrom, newTo) => {
      const from = Math.min(size, Math.max(0, rest.map(newFrom, -1)));
      const to = Math.min(size, Math.max(from, rest.map(newTo, 1)));
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        blocks.set(pos, pos + node.nodeSize);
        return false;
      });
    });
  });
  return blocks;
}

/** The set after a transaction: the old marks move with the text, and only the touched blocks are drawn again. */
export function updateMarks(set: DecorationSet, tr: Transaction): DecorationSet {
  let next = set.map(tr.mapping, tr.doc);
  const added: Decoration[] = [];
  for (const [pos, end] of touchedBlocks(tr)) {
    next = next.remove(next.find(pos, end));
    const block = tr.doc.nodeAt(pos);
    if (block) blockDecorations(block, pos, added);
  }
  return added.length > 0 ? next.add(tr.doc, added) : next;
}

const ShowMarks = Extension.create({
  name: 'opennoteFormattingMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: marksKey,
        state: {
          init: (_config, state) => (formattingMarks.get() ? marksFor(state.doc) : DecorationSet.empty),
          apply(tr, set, _old, state) {
            if (!formattingMarks.get()) return DecorationSet.empty;
            // A switch change (or the first draw) rebuilds everything; typing redraws only the touched blocks.
            if (tr.getMeta(marksKey) !== undefined || set === DecorationSet.empty) return marksFor(state.doc);
            return tr.docChanged ? updateMarks(set, tr) : set;
          },
        },
        props: {
          decorations: (state) => marksKey.getState(state),
        },
        view(view) {
          // A change of the switch redraws this editor with an empty transaction that carries a note.
          const stop = formattingMarks.subscribe(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(marksKey, formattingMarks.get()));
          });
          return { destroy: stop };
        },
      }),
    ];
  },
});

if (!editorExtensions.get('text.formattingMarks')) {
  editorExtensions.register({
    id: 'text.formattingMarks',
    order: 910,
    flag: 'text.symbols',
    kinds: ['text'],
    create: () => ShowMarks,
  });
}

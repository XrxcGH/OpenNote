// Show formatting marks: decorations that draw a pilcrow at the end of each paragraph, a middle dot for a space, an
// arrow for a tab, a degree sign for a nonbreaking space, and a not sign for an optional hyphen. They are decorations
// only, so the document, its Markdown, and the undo history never change. The marks are drawn by CSS from the
// data-fmark attribute (content.module.css), and the pilcrow is a widget the caret and selection skip.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { editorExtensions } from './kit';
import './invisibles.module.css';

let marksOn = false;
const listeners = new Set<() => void>();

/**
 * Whether formatting marks show. One switch for every editor, like Word's button. The editor layer keeps its own tiny
 * store, because it may not import the app's state; the command in features/page reads and flips it.
 */
export const formattingMarks = {
  get: (): boolean => marksOn,
  set(next: boolean | ((before: boolean) => boolean)): void {
    const value = typeof next === 'function' ? next(marksOn) : next;
    if (value === marksOn) return;
    marksOn = value;
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** The characters that get a mark, and the kind CSS draws for each. */
export const MARK_KINDS: Readonly<Record<string, string>> = {
  ' ': 'space',
  '\t': 'tab',
  '\u00a0': 'nbsp',
  '\u00ad': 'shy',
};

const marksKey = new PluginKey<DecorationSet>('opennoteFormattingMarks');

function pilcrow(): HTMLElement {
  const span = document.createElement('span');
  span.setAttribute('data-fmark', 'para');
  span.setAttribute('aria-hidden', 'true');
  span.contentEditable = 'false';
  return span;
}

/** The decorations for a document: the marks of every text block, and a pilcrow after each one. */
export function marksFor(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      decorations.push(Decoration.widget(pos + node.nodeSize - 1, pilcrow, { side: 1, key: 'fmark-para' }));
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i += 1) {
        const kind = MARK_KINDS[node.text.charAt(i)];
        if (kind) decorations.push(Decoration.inline(pos + i, pos + i + 1, { 'data-fmark': kind }));
      }
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
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
            if (tr.getMeta(marksKey) !== undefined || tr.docChanged) {
              return formattingMarks.get() ? marksFor(state.doc) : DecorationSet.empty;
            }
            return set;
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

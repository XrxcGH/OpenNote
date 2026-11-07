// The editor's side of the block marks (blocks.ts): decorations for border places, contextual spacing, list labels,
// and scaled words, equal to what the static render writes. It registers itself, so every text editor draws them.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { editorExtensions } from '../extensions/kit';
import { LISTS_META } from '../extensions/listItem';
import { readLists } from '../paragraph/numbering';
import type { ListDefinitions } from '../paragraph/numbering';
import { blockMarks, measureScaledWords } from './blocks';

interface State {
  lists: ListDefinitions;
  decorations: DecorationSet;
  scaled: boolean;
}

const key = new PluginKey<State>('opennoteBlockMarks');

function build(state: EditorState, lists: ListDefinitions): State {
  const { nodes, words } = blockMarks(state.doc, lists);
  if (nodes.size === 0 && words.length === 0) return { lists, decorations: DecorationSet.empty, scaled: false };
  const all: Decoration[] = [];
  for (const [pos, attrs] of nodes) {
    const node = state.doc.nodeAt(pos);
    if (node) all.push(Decoration.node(pos, pos + node.nodeSize, attrs));
  }
  for (const { from, to } of words) all.push(Decoration.inline(from, to, { 'data-scaled': '' }));
  return { lists, decorations: DecorationSet.create(state.doc, all), scaled: words.length > 0 };
}

/** Measures scaled words after each update that has any, so their layout width follows their paint width. */
class ScaleView {
  constructor(private readonly view: EditorView) {
    this.update();
  }
  update(): void {
    if (key.getState(this.view.state)?.scaled) measureScaledWords(this.view.dom);
  }
}

export function blockMarksExtension(): Extension {
  return Extension.create({
    name: 'opennoteBlockMarks',
    addProseMirrorPlugins: () => [
      new Plugin<State>({
        key,
        state: {
          init: (_config, state) => build(state, new Map()),
          apply(tr, old, _prev, next) {
            const meta: unknown = tr.getMeta(LISTS_META);
            if (meta !== undefined) return build(next, readLists(meta));
            return tr.docChanged ? build(next, old.lists) : old;
          },
        },
        props: { decorations: (state) => key.getState(state)?.decorations },
        view: (view) => new ScaleView(view),
      }),
    ],
  });
}

if (!editorExtensions.get('text.blockMarks')) {
  editorExtensions.register({
    id: 'text.blockMarks',
    order: 410,
    kinds: ['text'],
    create: () => blockMarksExtension(),
  });
}

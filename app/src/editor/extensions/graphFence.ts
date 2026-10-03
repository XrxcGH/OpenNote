// Graphs in text (Phase 10). A code block whose language is "graph" holds the graph's functions as text. This keeps
// a live graph after each one, drawn by the page's renderer (EditorHost.graph), which loads on first use. The graph
// edits the block's text and nothing else, so undo, copy, search, and export treat it as the code it is.
import { Extension } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost, GraphHandle, GraphRenderer } from '../host';
import { META_COMMAND } from '../meta';

export const GRAPH_LANGUAGE = 'graph';
const key = new PluginKey('opennote.graphFence');

const isGraph = (node: PMNode) => node.type.name === 'codeBlock' && node.attrs.language === GRAPH_LANGUAGE;

/** The position and node of each graph code block, in order. */
function graphs(doc: PMNode): { pos: number; node: PMNode }[] {
  const found: { pos: number; node: PMNode }[] = [];
  doc.forEach((node, offset) => {
    if (isGraph(node)) found.push({ pos: offset, node });
  });
  return found;
}

/** Replaces the text of the code block at `pos` as one command. */
function setSource(view: EditorView, index: number, next: string): void {
  const target = graphs(view.state.doc)[index];
  if (!target) return;
  const from = target.pos + 1;
  const to = target.pos + target.node.nodeSize - 1;
  const text = next === '' ? [] : [view.state.schema.text(next)];
  view.dispatch(view.state.tr.replaceWith(from, to, text).setMeta(META_COMMAND, true));
}

class Widgets {
  private renderer: GraphRenderer | null = null;
  private handles = new Map<number, GraphHandle>();
  private containers = new Map<number, HTMLElement>();

  constructor(
    private view: EditorView,
    host: EditorHost,
  ) {
    host.graph?.()?.then(
      (renderer) => {
        this.renderer = renderer;
        this.sync(this.view.state);
      },
      () => undefined,
    );
  }

  container(index: number): HTMLElement {
    let element = this.containers.get(index);
    if (!element) {
      element = document.createElement('div');
      element.setAttribute('data-graph', '');
      element.contentEditable = 'false';
      this.containers.set(index, element);
    }
    return element;
  }

  sync(state: EditorState): void {
    if (!this.renderer) return;
    const present = graphs(state.doc);
    present.forEach(({ node }, index) => {
      const props = {
        source: node.textContent,
        editable: this.view.editable,
        onSource: (next: string) => setSource(this.view, index, next),
      };
      const existing = this.handles.get(index);
      if (existing) existing.update(props);
      else this.handles.set(index, this.renderer!.mount(this.container(index), props));
    });
    for (const [index, handle] of [...this.handles]) {
      if (index >= present.length) {
        handle.destroy();
        this.handles.delete(index);
        this.containers.delete(index);
      }
    }
  }

  destroy(): void {
    for (const handle of this.handles.values()) handle.destroy();
    this.handles.clear();
  }
}

function plugin(host: EditorHost): Plugin {
  const widgets = new WeakMap<EditorView, Widgets>();
  return new Plugin({
    key,
    view(view) {
      const mine = new Widgets(view, host);
      widgets.set(view, mine);
      return {
        update: (updated) => mine.sync(updated.state),
        destroy: () => mine.destroy(),
      };
    },
    props: {
      decorations(state) {
        const found = graphs(state.doc);
        if (found.length === 0) return DecorationSet.empty;
        return DecorationSet.create(
          state.doc,
          found.map(({ pos, node }, index) =>
            Decoration.widget(pos + node.nodeSize, (view) => widgets.get(view)!.container(index), {
              side: -1,
              key: `graph-${index}`,
              stopEvent: () => true,
              ignoreSelection: true,
            }),
          ),
        );
      },
    },
  });
}

/** The graph extension, for editors that hold text. */
export function graphFenceExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'graphFence',
      addProseMirrorPlugins() {
        return host.graph ? [plugin(host)] : [];
      },
    }),
  ];
}

/** Puts a graph code block at the caret and returns its position, or null when this editor has no code blocks. */
export function insertGraph(editor: Editor, source = 'y = sin(x)'): number | null {
  const type = editor.schema.nodes.codeBlock;
  if (!type || !editor.isEditable) return null;
  const node = type.create({ language: GRAPH_LANGUAGE }, editor.schema.text(source));
  const tr = editor.state.tr.replaceSelectionWith(node, false).setMeta(META_COMMAND, true);
  let end: number | null = null;
  tr.mapping.maps[tr.steps.length - 1]?.forEach((_from, _to, _newFrom, newTo) => {
    end ??= newTo;
  });
  const pos = (end ?? tr.selection.to) - node.nodeSize;
  if (tr.doc.nodeAt(pos)?.type !== type) return null;
  editor.view.dispatch(tr);
  editor.view.focus();
  return pos;
}

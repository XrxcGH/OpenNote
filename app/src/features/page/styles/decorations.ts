// Shows each element's named style to the page's CSS (ADR 0082): a paragraph or heading whose `style` is set gets
// `data-pstyle` through a node decoration, so cssVars.ts can draw it. Decorations change only the DOM's attributes:
// the document, its Markdown, and the undo history never see them. Only the textblocks a step touched are looked at
// again, so typing in a long page costs nothing extra.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { editorExtensions } from '../../../editor/extensions/kit';

export const STYLE_DECORATIONS = new PluginKey<DecorationSet>('opennoteNamedStyles');

function decorate(node: PMNode, pos: number, out: Decoration[]): void {
  const style = node.attrs.style;
  if (node.isTextblock && typeof style === 'string' && style !== '') {
    out.push(Decoration.node(pos, pos + node.nodeSize, { 'data-pstyle': style }));
  }
}

function build(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    decorate(node, pos, out);
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, out);
}

/** The plugin that keeps `data-pstyle` on styled elements. */
export function namedStylesPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: STYLE_DECORATIONS,
    state: {
      init: (_, state) => build(state.doc),
      apply(tr, set) {
        if (!tr.docChanged) return set;
        let next = set.map(tr.mapping, tr.doc);
        tr.mapping.maps.forEach((map, index) => {
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            // Map the changed range through the later steps, then redo the textblocks around it.
            const later = tr.mapping.slice(index + 1);
            const from = Math.max(0, Math.min(later.map(newStart, -1), tr.doc.content.size));
            const to = Math.max(from, Math.min(later.map(newEnd, 1), tr.doc.content.size));
            next = next.remove(next.find(from, to));
            const fresh: Decoration[] = [];
            tr.doc.nodesBetween(from, to, (node, pos) => {
              decorate(node, pos, fresh);
              return !node.isTextblock;
            });
            next = next.add(tr.doc, fresh);
          });
        });
        return next;
      },
    },
    props: { decorations: (state) => STYLE_DECORATIONS.getState(state) },
  });
}

/** The plugin as an editor extension. */
export function namedStylesExtension(): Extension {
  return Extension.create({ name: 'opennoteNamedStyles', addProseMirrorPlugins: () => [namedStylesPlugin()] });
}

if (!editorExtensions.get('text.namedStyles')) {
  editorExtensions.register({
    id: 'text.namedStyles',
    order: 410,
    flag: 'text.styles2',
    kinds: ['text'],
    create: () => namedStylesExtension(),
  });
}

// Equation numbers on the page (flag doc.equationNumbers). Each display equation with a `\label{key}` shows its number
// at the right, and each inline `\eqref{key}` equation shows the number of the equation it names. The numbers are
// worked out from the order of the equations on every change, so moving an equation renumbers the rest and every
// reference follows. Clicking a reference moves to its equation. Nothing in the document changes: the numbers are
// decorations.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorHost } from '../host';
import { formatNumber, formatRef, labelOf, numberEquations, refKey } from '../equations';

const key = new PluginKey<DecorationSet>('equationNumbers');

interface Found {
  pos: number;
  node: PMNode;
}

/** The numbering of the document's display equations, with where each labeled one is. */
export function numberingOf(doc: PMNode) {
  const blocks: Found[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'mathBlock') blocks.push({ pos, node });
    return !node.isAtom;
  });
  const numbering = numberEquations(blocks.map((b) => b.node.attrs.source as string));
  const where = new Map<string, number>();
  blocks.forEach((b, i) => {
    const label = labelOf(b.node.attrs.source as string);
    if (label !== null && numbering.numbers[i] !== null) where.set(label, b.pos);
  });
  return { blocks, numbering, where };
}

function decorate(doc: PMNode): DecorationSet {
  const { blocks, numbering } = numberingOf(doc);
  const decorations: Decoration[] = [];
  blocks.forEach((b, i) => {
    const n = numbering.numbers[i];
    if (n !== null) decorations.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, { 'data-eq-number': String(n) }));
    else if (numbering.duplicates.includes(i)) {
      decorations.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, { 'data-eq-duplicate': '' }));
    }
  });
  doc.descendants((node, pos) => {
    if (node.type.name !== 'mathInline') return;
    const target = refKey(node.attrs.source as string);
    if (target === null) return;
    const text = formatRef(target, numbering.byKey);
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        'data-eq-ref': text,
        'data-eq-key': target,
        ...(numbering.byKey.has(target) ? {} : { 'data-eq-missing': '' }),
        title: numbering.byKey.has(target) ? formatNumber(numbering.byKey.get(target)!) : target,
      }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

export function equationNumbersExtensions(host: EditorHost): ReturnType<typeof Extension.create>[] {
  if (!host.flag('doc.equationNumbers')) return [];
  return [
    Extension.create({
      name: 'equationNumbers',
      addProseMirrorPlugins: () => [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_config, state) => decorate(state.doc),
            apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
          },
          props: {
            decorations: (state) => key.getState(state),
            handleClick(view, _pos, event) {
              const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-eq-key]');
              const name = target?.getAttribute('data-eq-key');
              if (!name) return false;
              const at = numberingOf(view.state.doc).where.get(name);
              if (at === undefined) return false;
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)).scrollIntoView());
              return true;
            },
          },
        }),
      ],
    }),
  ];
}

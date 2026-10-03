// The editor extension that draws embeds: a card under each paragraph that is only `![[Page]]`. The cards are widget
// decorations with a key, so ProseMirror keeps a card (and its open page) while the text around it changes, and
// calls destroy when the line goes away or the editor closes.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { editorExtensions } from '../../../editor/extensions/kit';
import { EmbedCard } from './card';
import { findEmbeds } from './model';

const key = new PluginKey<DecorationSet>('opennoteEmbeds');
const cards = new WeakMap<Node, EmbedCard>();

function scan(doc: PMNode): DecorationSet {
  const widgets = findEmbeds(doc).map((embed) =>
    Decoration.widget(
      embed.end,
      () => {
        const card = new EmbedCard({ title: embed.title, heading: embed.heading });
        cards.set(card.element, card);
        return card.element;
      },
      {
        key: `embed:${embed.title}#${embed.heading ?? ''}`,
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
        destroy: (node) => cards.get(node)?.destroy(),
      },
    ),
  );
  return DecorationSet.create(doc, widgets);
}

const Embeds = Extension.create({
  name: 'opennoteEmbeds',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_config, state) => scan(state.doc),
          apply: (tr, old) => (tr.docChanged ? scan(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

if (!editorExtensions.get('qol.embeds')) {
  editorExtensions.register({
    id: 'qol.embeds',
    order: 902,
    flag: 'page.embeds',
    kinds: ['text'],
    create: () => Embeds,
  });
}

// Panel blocks (Study tools and diagrams): blocks of a type of their own, such as flashcards, a diagram, or a mind
// map. Each draws a small interface of its feature into the block's wrapper. The data is the block's own, kept by
// the page like a table's: a change goes to the core as a patch and one undo takes it back. A reader without the
// feature still sees the block's fallback text, which is also what search and read aloud use.
import type { BlockJson } from '../../../services/pages/types';
import blockStyles from '../blocks/blocks.module.css';
import { placeBlock } from '../blocks/textBlock';
import type { BlockRenderContext } from '../blocks/types';
import type { InnerView } from '../tables/lazyView';
import type { PanelHandle, PanelKind, PanelProps } from './kinds';

export function createPanelInner(
  element: HTMLElement,
  block: BlockJson,
  ctx: BlockRenderContext,
  kind: PanelKind,
): InnerView {
  element.classList.add(blockStyles.block);
  const body = element.appendChild(document.createElement('div'));
  let latest = block;
  let handle: PanelHandle | null = null;
  let gone = false;
  const props = (): PanelProps => ({
    block: latest.id,
    data: latest.data,
    readOnly: ctx.page.readOnly !== null,
    patch: (data, fallback) => {
      const edit = { edit: 'patchBlock' as const, block: latest.id, data };
      void ctx.sync.send({ edits: [fallback === undefined ? edit : { ...edit, fallback: { markdown: fallback } }] });
    },
    announce: (text) => ctx.host.announce(text),
  });
  placeBlock(element, block);
  void kind.load().then(({ mount }) => {
    if (!gone) handle = mount(body, props());
  });
  return {
    element,
    editRoot: null,
    update(next) {
      latest = next;
      placeBlock(element, next);
      handle?.update(props());
    },
    measure: () => ({ x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight }),
    destroy() {
      gone = true;
      handle?.destroy();
      element.remove();
    },
  };
}

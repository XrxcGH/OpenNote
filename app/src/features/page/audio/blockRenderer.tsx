// The recording block's renderer (Phase 9): a React card inside the block's wrapper, loaded on first use. The
// wrapper comes from lazyBlockView, which gives it its role and name.
import { createRoot } from 'react-dom/client';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { placeBlock } from '../blocks/textBlock';
import blockStyles from '../blocks/blocks.module.css';
import type { BlockRenderContext } from '../blocks/types';
import type { InnerView } from '../tables/lazyView';
import { activeNs, dataOf } from './blocks';
import { adoptPage, recordingEntries } from './entries';
import styles from './block.module.css';
import { clock } from './format';
import { RecordingBlockView } from './RecordingBlock';

function labelOf(block: BlockJson): string {
  const data = dataOf(block);
  return data && data.entry.state !== 'recording'
    ? t('audio.block.label', { time: clock(activeNs(data.entry) / 1e6) })
    : t('audio.block.labelWhile');
}

export function createInner(wrapper: HTMLElement, block: BlockJson, ctx: BlockRenderContext): InnerView {
  wrapper.className = blockStyles.block;
  wrapper.dataset.appMenu = '';
  const host = wrapper.appendChild(document.createElement('div'));
  host.className = styles.card;
  const root = createRoot(host);
  let current = block;
  adoptPage(ctx.page);
  const draw = () => {
    wrapper.setAttribute('aria-label', labelOf(current));
    placeBlock(wrapper, current);
    root.render(<RecordingBlockView block={current} pageId={ctx.page.id} />);
  };
  draw();
  // The entry changes as the recording runs, and with undo, so the card and its name follow the store.
  const stop = recordingEntries.subscribe(draw);
  return {
    element: wrapper,
    editRoot: null,
    update(next) {
      current = next;
      draw();
    },
    measure: () => ({ x: wrapper.offsetLeft, y: wrapper.offsetTop, w: wrapper.offsetWidth, h: wrapper.offsetHeight }),
    destroy() {
      stop();
      root.unmount();
    },
  };
}

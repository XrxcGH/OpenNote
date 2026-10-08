// The transcript block's renderer: a React card inside the block's wrapper, loaded on first use. The wrapper comes from
// lazyBlockView, which gives it its role and name.
import { createRoot } from 'react-dom/client';
import type { BlockJson } from '../../../../services/pages/types';
import { t } from '../../../../strings/t';
import blockStyles from '../../blocks/blocks.module.css';
import { placeBlock } from '../../blocks/textBlock';
import type { BlockRenderContext } from '../../blocks/types';
import type { InnerView } from '../../tables/lazyView';
import { adoptTranscripts, dataOf, transcripts } from './store';
import styles from './transcripts.module.css';
import { TranscriptView } from './TranscriptBlock';

export const labelOf = (block: BlockJson): string =>
  t('audioMore.transcript.label', { count: dataOf(block)?.lines.length ?? 0 });

export function createInner(wrapper: HTMLElement, block: BlockJson, ctx: BlockRenderContext): InnerView {
  wrapper.className = blockStyles.block;
  wrapper.dataset.appMenu = '';
  const host = wrapper.appendChild(document.createElement('div'));
  host.className = styles.card;
  const root = createRoot(host);
  let current = block;
  adoptTranscripts(ctx.page);
  const draw = () => {
    wrapper.setAttribute('aria-label', labelOf(current));
    placeBlock(wrapper, current);
    root.render(<TranscriptView block={current} />);
  };
  draw();
  // The words change as they are edited, and with undo, so the card and its name follow the store.
  const stop = transcripts.subscribe(draw);
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

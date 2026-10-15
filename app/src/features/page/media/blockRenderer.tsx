// The embed block's renderer: a React card inside the block's wrapper, loaded on first use.
import { createRoot } from 'react-dom/client';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import blockStyles from '../blocks/blocks.module.css';
import { placeBlock } from '../blocks/textBlock';
import type { BlockRenderContext } from '../blocks/types';
import type { InnerView } from '../tables/lazyView';
import { EmbedBlockView } from './EmbedBlock';
import { embedDataOf } from './model';
import { PROVIDER_NAME } from './recognize';

export function labelOf(block: BlockJson): string {
  const data = embedDataOf(block);
  if (!data) return t('accounts.media.block.unavailable');
  const provider = PROVIDER_NAME[data.provider];
  return t(data.kind === 'live' ? 'accounts.media.block.labelLive' : 'accounts.media.block.labelPlayer', {
    provider,
    title: data.title,
  });
}

export function createInner(wrapper: HTMLElement, block: BlockJson, ctx: BlockRenderContext): InnerView {
  wrapper.className = blockStyles.block;
  wrapper.dataset.appMenu = '';
  const host = wrapper.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let current = block;
  const draw = () => {
    wrapper.setAttribute('aria-label', labelOf(current));
    placeBlock(wrapper, current);
    root.render(<EmbedBlockView block={current} page={ctx.page} />);
  };
  draw();
  return {
    element: wrapper,
    editRoot: null,
    update(next) {
      current = next;
      draw();
    },
    measure: () => ({ x: wrapper.offsetLeft, y: wrapper.offsetTop, w: wrapper.offsetWidth, h: wrapper.offsetHeight }),
    destroy() {
      root.unmount();
    },
  };
}

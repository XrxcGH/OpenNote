// The video block's renderer: a React card inside the block's wrapper, loaded on first use.
import { createRoot } from 'react-dom/client';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import blockStyles from '../blocks/blocks.module.css';
import { placeBlock } from '../blocks/textBlock';
import type { BlockRenderContext } from '../blocks/types';
import type { InnerView } from '../tables/lazyView';
import { videoDataOf } from './model';
import { VideoBlockView } from './VideoBlock';

export function labelOf(block: BlockJson): string {
  const data = videoDataOf(block);
  return data ? t('video.block.label', { name: data.name }) : t('video.block.unavailable');
}

export function createInner(wrapper: HTMLElement, block: BlockJson, ctx: BlockRenderContext): InnerView {
  wrapper.className = blockStyles.block;
  wrapper.dataset.appMenu = '';
  const host = wrapper.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let current = block;
  const onCaptions = (id: string, remove: boolean) =>
    void import('./insert').then((module) => (remove ? module.removeCaptions(id) : module.setCaptions(id)));
  const draw = () => {
    wrapper.setAttribute('aria-label', labelOf(current));
    placeBlock(wrapper, current);
    root.render(<VideoBlockView block={current} page={ctx.page} onCaptions={onCaptions} />);
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

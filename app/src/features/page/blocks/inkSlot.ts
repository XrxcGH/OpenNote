// The slot an ink block holds until Phase 5's renderer draws it (ARCHITECTURE.md section 25.3; owner WP3): an empty
// box at the block's frame, so handwriting keeps its place in the order, the layout, and the z-order. It has no
// content to read, so assistive technology skips it.
import styles from './blocks.module.css';
import { placeBlock } from './textBlock';
import type { BlockRendererDef } from './types';

export const inkSlotRenderer: BlockRendererDef = {
  id: 'inkSlot',
  types: ['ink'],
  priority: -1,
  create(block) {
    const element = document.createElement('div');
    element.className = styles.block;
    element.dataset.blockId = block.id;
    element.dataset.ink = '';
    element.setAttribute('aria-hidden', 'true');
    const size = (next: typeof block) => {
      placeBlock(element, next);
      element.style.blockSize = next.frame?.h !== undefined ? `${next.frame.h}px` : '';
    };
    size(block);
    return {
      element,
      editRoot: null,
      update: size,
      measure: () => ({ x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight }),
      destroy: () => element.remove(),
    };
  },
};

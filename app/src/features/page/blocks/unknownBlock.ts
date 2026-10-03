// Blocks no renderer handles yet (owner after WP0: WP3): a placeholder that names the block and shows its fallback
// text, so nothing on the page is lost or hidden. Images and tables use it until WP5 and WP6 register theirs.
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import styles from './blocks.module.css';
import { placeBlock } from './textBlock';
import type { BlockRendererDef } from './types';

function label(block: BlockJson): string {
  const alt = typeof block.data.alt === 'string' ? block.data.alt : '';
  if (block.type === 'image') return alt ? t('page.block.image', { alt }) : t('page.block.imageUnnamed');
  if (block.type === 'table') return t('page.block.table');
  return block.fallback?.markdown || t('page.block.unknown', { type: block.type });
}

export const unknownBlockRenderer: BlockRendererDef = {
  id: 'unknown',
  types: [],
  priority: -1,
  create(block) {
    const element = document.createElement('div');
    element.className = `${styles.block} ${styles.unknown}`;
    element.setAttribute('role', 'group');
    element.tabIndex = -1;
    element.dataset.blockId = block.id;
    const text = () => {
      element.textContent = label(block);
      element.setAttribute('aria-label', label(block));
    };
    text();
    placeBlock(element, block);
    return {
      element,
      editRoot: null,
      update(next) {
        block = next;
        text();
        placeBlock(element, next);
      },
      measure: () => ({ x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight }),
      destroy: () => element.remove(),
    };
  },
};

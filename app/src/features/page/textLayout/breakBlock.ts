// The break block's view: a dashed rule with the break's name, so a break reads as a break and not as a divider. In a
// version 1 app the same block shows as a divider through its fallback. The paginator turns it into a new sheet.
import { readBreakKind } from '../../pages';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { placeBlock } from '../blocks/textBlock';
import type { BlockRendererDef } from '../blocks/types';
import styles from './breakBlock.module.css';

const label = (block: BlockJson): string =>
  readBreakKind(block.data) === 'column' ? t('textLayout.break.column') : t('textLayout.break.page');

export const breakBlockRenderer: BlockRendererDef = {
  id: 'break',
  types: ['break'],
  priority: 1,
  flag: 'text.layout',
  create(block) {
    const element = document.createElement('div');
    element.className = styles.break;
    element.setAttribute('role', 'group');
    // Focusable like an image or a file, so a keyboard user can reach a break; Delete and Backspace remove it
    // (objects/keys.ts).
    element.tabIndex = 0;
    element.dataset.scope = 'pageObject';
    element.dataset.blockId = block.id;
    const caption = document.createElement('span');
    element.append(caption);
    const draw = (next: BlockJson): void => {
      const text = label(next);
      caption.textContent = text;
      element.setAttribute('aria-label', text);
      element.dataset.breakKind = readBreakKind(next.data);
      placeBlock(element, next);
    };
    draw(block);
    return {
      element,
      editRoot: null,
      update: draw,
      measure: () => ({ x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight }),
      destroy: () => element.remove(),
    };
  },
};

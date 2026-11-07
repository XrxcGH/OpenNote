// Columns and vertical writing of a text block, drawn on the block's wrapper from its `data.layout` (R-LAY-1). The
// wrapper is the element the page view places, so CSS columns balance the block's paragraphs and the editor inside
// stays one editor. The page's text:layout flag gates it, so a page with columns still shows one column when it is off.
import { isEnabled } from '../../../app/flags';
import { layoutCss, readTextLayout } from '../../pages';
import type { BlockJson } from '../../../services/pages/types';

const PROPS = ['column-count', 'column-gap', 'column-rule', 'writing-mode'] as const;

/** Sets or clears the layout styles of a text block's wrapper. */
export function applyTextLayout(element: HTMLElement, block: BlockJson): void {
  const layout = block.type === 'text' && isEnabled('text.layout') ? readTextLayout(block.data) : null;
  const css = layout ? layoutCss(layout) : {};
  // Vertical writing is for floating text boxes: a flowing block would turn the whole page's text sideways.
  const floating = block.frame?.x !== undefined && block.frame?.y !== undefined;
  const values: Record<(typeof PROPS)[number], string> = {
    'column-count': css.columnCount === undefined ? '' : String(css.columnCount),
    'column-gap': css.columnGap ?? '',
    'column-rule': css.columnRule ?? '',
    'writing-mode': floating && css.writingMode ? css.writingMode : '',
  };
  for (const prop of PROPS) {
    if (values[prop] === '') element.style.removeProperty(prop);
    else element.style.setProperty(prop, values[prop]);
  }
  if (values['column-count'] === '') delete element.dataset.columns;
  else element.dataset.columns = values['column-count'];
}

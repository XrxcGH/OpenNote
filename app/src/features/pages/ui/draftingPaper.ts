// Puts engineering paper on the shown page: computation paper, three views with projection lines, or a title block.
// The page keeps a copy of the drawing, so it stays complete on its own. The words come from the design kit's strings.
import { t } from '../../../strings/t';
import { contentBox } from '../pagination/geometry';
import { pageLayout, setTemplate } from '../layout';
import { shownPagesView } from '../live/shown';
import { computationPaper, threeViewLayout, titleBlock, type DraftingKey } from '../paper';
import type { PaperTemplate } from '../paper/types';

const text = () => ({
  title: t('kitDesign.paper.title'),
  drawnBy: t('kitDesign.paper.drawnBy'),
  date: t('kitDesign.paper.date'),
  scale: t('kitDesign.paper.scale'),
  sheet: t('kitDesign.paper.sheet'),
  material: t('kitDesign.paper.material'),
  tolerance: t('kitDesign.paper.tolerance'),
});

function build(key: DraftingKey, area: { width: number; height: number }): PaperTemplate {
  switch (key) {
    case 'computation':
      return computationPaper(t('kitDesign.paper.computation'), area);
    case 'titleBlock':
      return titleBlock(t('kitDesign.paper.titleBlock'), text(), area);
    case 'threeView':
      return threeViewLayout(
        t('kitDesign.paper.threeView'),
        {
          ...text(),
          front: t('kitDesign.paper.front'),
          top: t('kitDesign.paper.top'),
          right: t('kitDesign.paper.right'),
        },
        area,
      );
  }
}

/** Applies the paper to the shown page as one undo step. False when no page is shown. */
export function applyDraftingPaper(key: DraftingKey): boolean {
  const api = shownPagesView.get();
  if (!api) return false;
  api.edit(
    (view) => {
      const box = contentBox(pageLayout(view).sheet, 0);
      return setTemplate(view, build(key, { width: box.w, height: box.h }));
    },
    t('kitDesign.paper.applied', { name: t(`kitDesign.paper.${key}`) }),
  );
  return true;
}

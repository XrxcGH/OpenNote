// The breadcrumb (ARCHITECTURE.md section 10.2, FEATURES.md "Back and forward"): the notebook, section, and page
// open now. In Phase 2 the crumbs are text, not links, so they add to the title bar's drag area. When the bar is
// narrow ('icon'), it shortens from the start on screen, "… › Lectures › Cell structure", while screen readers
// still hear the whole path.

import { useLocation } from '../../app/location';
import { useNotebookAccent } from '../../features/tree';
import { t } from '../../strings/t';
import { useNodes } from '../layout/useNode';
import styles from './TitleBar.module.css';

export function Breadcrumb({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const location = useLocation();
  const ids = location.view === 'workspace' ? [location.notebookId, location.sectionId, location.pageId] : [];
  const nodes = useNodes(ids).filter((node) => node?.title);
  const titles = nodes.map((node) => node?.title ?? '');
  // The notebook's color is a small dot before its name, as the tree shows it.
  const ink = useNotebookAccent();
  if (titles.length === 0) return null;
  const hiddenCount = presentation !== 'full' && titles.length > 2 ? titles.length - 2 : 0;
  return (
    <ol className={styles.breadcrumb} aria-label={t('titleBar.breadcrumb.label')}>
      {titles.map((title, index) => (
        <li
          key={`${index}-${title}`}
          className={index < hiddenCount ? styles.visuallyHidden : styles.crumb}
          // A crumb cut short with an ellipsis still shows its whole name on hover and long press.
          title={index < hiddenCount ? undefined : title}
          data-after-ellipsis={hiddenCount > 0 && index === hiddenCount ? '' : undefined}
          aria-current={index === titles.length - 1 ? 'location' : undefined}
          data-ink={index === 0 && ink ? '' : undefined}
          // A crumb cut from the start of a narrow bar is hidden, so its dot is not a mark on screen.
          data-notebook-mark={index === 0 && ink && hiddenCount === 0 ? 'breadcrumb' : undefined}
          data-accent={index === 0 && ink ? ink : undefined}
        >
          {title}
        </li>
      ))}
    </ol>
  );
}

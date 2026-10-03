// The breadcrumb (ARCHITECTURE.md section 10.2, FEATURES.md "Back and forward"): the notebook, section, and page
// open now. In Phase 2 the crumbs are text, not links, so they add to the title bar's drag area. When the bar is
// narrow ('icon'), it shortens from the start on screen, "… › Lectures › Cell structure", while screen readers
// still hear the whole path.

import { useLocation } from '../../app/location';
import { t } from '../../strings/t';
import { useNodes } from '../layout/useNode';
import styles from './TitleBar.module.css';

export function Breadcrumb({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const location = useLocation();
  const ids = location.view === 'workspace' ? [location.notebookId, location.sectionId, location.pageId] : [];
  const titles = useNodes(ids)
    .map((node) => node?.title)
    .filter((title): title is string => Boolean(title));
  if (titles.length === 0) return null;
  const hiddenCount = presentation !== 'full' && titles.length > 2 ? titles.length - 2 : 0;
  return (
    <ol className={styles.breadcrumb} aria-label={t('titleBar.breadcrumb.label')}>
      {titles.map((title, index) => (
        <li
          key={`${index}-${title}`}
          className={index < hiddenCount ? styles.visuallyHidden : styles.crumb}
          data-after-ellipsis={hiddenCount > 0 && index === hiddenCount ? '' : undefined}
          aria-current={index === titles.length - 1 ? 'location' : undefined}
        >
          {title}
        </li>
      ))}
    </ol>
  );
}

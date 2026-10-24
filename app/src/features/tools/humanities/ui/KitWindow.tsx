// The kit window: a row of tabs, one for each tool, and the tool that is chosen. The palette's per-tool commands
// choose the tab before they open the window.
import { Suspense } from 'react';
import { t } from '../../../../strings/t';
import { useStore } from '../../../../state/store';
import { TOOL_BODIES } from '../kit';
import { HUMANITIES_TOOLS } from '../meta';
import type { HumanitiesToolId } from '../meta';
import { showTool, shownTool } from '../open';
import { Tabs, ht } from './parts';
import styles from './kit.module.css';

const same = (id: HumanitiesToolId) => id;

export function HumanitiesKit() {
  const tool = useStore(shownTool, same);
  const Body = TOOL_BODIES[tool];
  const items = HUMANITIES_TOOLS.map((item) => ({ id: item.id, label: ht(`${item.id}.title`) }));
  return (
    <div className={styles.kit}>
      <div className={styles.kitTabs}>
        <Tabs label={t('kitHumanities.toolsLabel')} items={items} value={tool} onChange={showTool} />
      </div>
      <div role="tabpanel" aria-label={ht(`${tool}.title`)}>
        <Suspense fallback={null}>
          <Body />
        </Suspense>
      </div>
    </div>
  );
}

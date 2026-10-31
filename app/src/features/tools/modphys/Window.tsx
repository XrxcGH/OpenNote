// The modern physics and astronomy window: a tool picker, then the chosen tool's calculations.
import { Suspense } from 'react';
import './shared/strings';
import { t } from '../../../strings/t';
import { useStore } from '../../../state/store';
import extra from '../ui/extra.module.css';
import tools from '../ui/tools.module.css';
import { KIT } from './kit';
import { MODPHYS_TOOLS, isModPhysTool } from './meta';
import { shownTool, showTool } from './request';

export default function ModPhysWindow() {
  const tool = useStore(shownTool, (current) => current);
  const Body = KIT[tool];
  return (
    <div className={tools.tool} data-modphys={tool}>
      <div className={extra.field}>
        <label htmlFor="modphys-tool">{t('kitModPhys.window.tool')}</label>
        <select
          id="modphys-tool"
          className={extra.input}
          value={tool}
          onChange={(event) => isModPhysTool(event.target.value) && showTool(event.target.value)}
        >
          {MODPHYS_TOOLS.map((one) => (
            <option key={one.id} value={one.id}>
              {t(`kitModPhys.toolTitles.${one.id}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={extra.scroll}>
        <Suspense fallback={null}>
          <Body key={tool} />
        </Suspense>
      </div>
    </div>
  );
}

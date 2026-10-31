// The earth, atmosphere, and ocean sciences kit window: a topic picker over the chosen tool. Each tool's code
// loads the first time its topic is picked.
import { Suspense } from 'react';
import type { MessageKey } from '../../../../strings/t';
import { t } from '../../../../strings/t';
import { useStore } from '../../../../state/store';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import { KIT } from '../kit';
import { EARTH_TOOL_IDS, isEarthTool } from '../meta';
import { chooseTool, earthChoice } from '../state';
import styles from './earth.module.css';

export function EarthKit() {
  const tool = useStore(earthChoice, (choice) => choice.tool);
  const Body = KIT[tool];
  return (
    <div className={`${tools.tool} ${styles.kit}`}>
      <label className={extra.field}>
        {t('kitEarth.topic')}
        <select
          className={extra.input}
          value={tool}
          onChange={(e) => isEarthTool(e.target.value) && chooseTool(e.target.value)}
        >
          {EARTH_TOOL_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`kitEarth.tools.${id}.title` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <Suspense fallback={null}>
        <Body key={tool} />
      </Suspense>
    </div>
  );
}

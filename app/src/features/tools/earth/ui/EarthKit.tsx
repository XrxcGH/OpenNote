// The earth, atmosphere, and ocean sciences kit window: a topic picker over the chosen tool. Each tool's code
// loads the first time its topic is picked.
import { Suspense, useRef } from 'react';
import type { MessageKey } from '../../../../strings/t';
import { t } from '../../../../strings/t';
import { useStore } from '../../../../state/store';
import { useKitReopen } from '../../kits/panelForm';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import { KIT } from '../kit';
import { EARTH_TOOL_IDS, isEarthTool } from '../meta';
import { chooseTool, earthChoice } from '../state';
import styles from './earth.module.css';

export function EarthKit() {
  const tool = useStore(earthChoice, (choice) => choice.tool);
  const Body = KIT[tool];
  const panel = useRef<HTMLDivElement>(null);
  useKitReopen('earth', tool, panel);
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
      <div
        ref={panel}
        data-kit-form="earth"
        data-kit-tool={tool}
        aria-label={t(`kitEarth.tools.${tool}.title` as MessageKey)}
        style={{ display: 'contents' }}
      >
        <Suspense fallback={null}>
          <Body key={tool} />
        </Suspense>
      </div>
    </div>
  );
}

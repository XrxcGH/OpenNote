// The civil, environmental, and chemical engineering kit window: pick a tool and one of its calculations, then type
// the inputs. Each tool's calculations load the first time it is picked.
import '../text';
import { useEffect, useState } from 'react';
import { t } from '../../../../strings/t';
import { useStore } from '../../../../state/store';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import type { Calc } from '../core/types';
import { CIVIL_KIT } from '../kit';
import { CIVIL_TOOL_IDS, isCivilToolId } from '../meta';
import type { CivilToolId } from '../meta';
import { choose, civilChoice } from '../selection';
import { CalcForm } from './CalcForm';
import styles from './civil.module.css';
import { label } from './say';

export function CivilTool() {
  const choice = useStore(civilChoice, (current) => current);
  const [loaded, setLoaded] = useState<{ tool: CivilToolId; calcs: readonly Calc[] } | null>(null);
  useEffect(() => {
    let live = true;
    void CIVIL_KIT[choice.tool]().then((calcs) => live && setLoaded({ tool: choice.tool, calcs }));
    return () => {
      live = false;
    };
  }, [choice.tool]);
  const calcs = loaded?.tool === choice.tool ? loaded.calcs : null;
  const calc = calcs ? (calcs.find((one) => one.id === choice.calcs[choice.tool]) ?? calcs[0]) : undefined;
  return (
    <div className={`${tools.tool} ${styles.window}`} data-civil-tool={choice.tool}>
      <div className={styles.pickers}>
        <div className={extra.field}>
          <label htmlFor="civil-tool">{t('kitCivil.common.tool')}</label>
          <select
            id="civil-tool"
            className={extra.input}
            value={choice.tool}
            onChange={(e) => isCivilToolId(e.target.value) && choose(e.target.value)}
          >
            {CIVIL_TOOL_IDS.map((id) => (
              <option key={id} value={id}>
                {label(`tools.${id}.title`)}
              </option>
            ))}
          </select>
        </div>
        <div className={extra.field}>
          <label htmlFor="civil-calc">{t('kitCivil.common.calculation')}</label>
          <select
            id="civil-calc"
            className={extra.input}
            value={calc?.id ?? ''}
            disabled={!calcs}
            onChange={(e) => choose(choice.tool, e.target.value)}
          >
            {(calcs ?? []).map((one) => (
              <option key={one.id} value={one.id}>
                {label(one.title)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={extra.scroll}>
        {calc ? (
          <CalcForm key={`${choice.tool}.${calc.id}`} tool={choice.tool} calc={calc} />
        ) : (
          <p className={tools.note}>{t('kitCivil.common.loading')}</p>
        )}
      </div>
    </div>
  );
}

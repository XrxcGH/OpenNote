// One earth kit tool: a picker for its calculations, when it has more than one, over the chosen calculation's form.
import { t } from '../../../../strings/t';
import { useStore } from '../../../../state/store';
import extra from '../../ui/extra.module.css';
import type { EarthToolId } from '../meta';
import { chooseMode, earthChoice } from '../state';
import { EarthForm } from './EarthForm';
import type { Mode } from './form';
import styles from './earth.module.css';

export function ModeTool({ tool, modes }: { tool: EarthToolId; modes: readonly Mode[] }) {
  const saved = useStore(earthChoice, (choice) => choice.modes[tool]);
  const mode = modes.find((m) => m.id === saved) ?? modes[0];
  return (
    <div className={styles.kit}>
      {modes.length > 1 ? (
        <label className={extra.field}>
          {t('kitEarth.calculation')}
          <select className={extra.input} value={mode.id} onChange={(e) => chooseMode(tool, e.target.value)}>
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.label)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <EarthForm key={`${tool}-${mode.id}`} tool={tool} mode={mode} />
    </div>
  );
}

// The body of the aerospace window: a tab for each tool, the unit system, and the chosen tool's panel. What was
// typed in each tool and the unit system are remembered on this device, so closing the window loses nothing.
import '../text';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../../strings/t';
import { LOADERS } from '../kit';
import { AERO_TOOLS, isAeroTool } from '../meta';
import type { AeroToolId } from '../meta';
import { AERO_TAB_EVENT, loadKit, saveKit } from '../store';
import { initialValues, switchSystem } from './spec';
import type { ToolSpec, Values } from './spec';
import { ToolPanel } from './ToolPanel';
import type { UnitSystem } from './units';
import { toolText } from './words';
import styles from './kit.module.css';

function Loaded({ id, system }: { id: AeroToolId; system: UnitSystem }) {
  const [spec, setSpec] = useState<ToolSpec | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  useEffect(() => {
    let live = true;
    void LOADERS[id]().then((loaded) => {
      if (!live) return;
      const saved = loadKit().values?.[id];
      setSpec(loaded.spec);
      setValues({ ...initialValues(loaded.spec, system), ...saved });
    });
    return () => {
      live = false;
    };
    // The unit system only seeds a new form here; a later switch converts the values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // Switching SI and US converts every quantity to the new system's units; the units a student picked stay otherwise.
  const shown = useRef(system);
  useEffect(() => {
    if (!spec || shown.current === system) return;
    shown.current = system;
    setValues((current) => (current ? switchSystem(spec, current, system) : current));
  }, [spec, system]);
  useEffect(() => {
    if (!values) return;
    const memory = loadKit();
    saveKit({ ...memory, values: { ...memory.values, [id]: values } });
  }, [id, values]);
  if (!spec || !values) return <p className={styles.about}>{t('kitAero.loading')}</p>;
  return <ToolPanel spec={spec} values={values} system={system} onValues={setValues} />;
}

export function KitAeroTool() {
  const [tab, setTab] = useState<AeroToolId>(() => {
    const saved = loadKit().tab;
    return isAeroTool(saved) ? saved : AERO_TOOLS[0].id;
  });
  const systemId = useId();
  const [system, setSystem] = useState<UnitSystem>(() => (loadKit().system === 'us' ? 'us' : 'si'));
  useEffect(() => {
    const onTab = () => {
      const saved = loadKit().tab;
      if (isAeroTool(saved)) setTab(saved);
    };
    window.addEventListener(AERO_TAB_EVENT, onTab);
    return () => window.removeEventListener(AERO_TAB_EVENT, onTab);
  }, []);
  const choose = (next: AeroToolId) => {
    setTab(next);
    saveKit({ ...loadKit(), tab: next });
  };
  const chooseSystem = (next: UnitSystem) => {
    setSystem(next);
    saveKit({ ...loadKit(), system: next });
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = AERO_TOOLS.length;
    const index = AERO_TOOLS.findIndex((tool) => tool.id === tab);
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % count,
      ArrowDown: (index + 1) % count,
      ArrowLeft: (index + count - 1) % count,
      ArrowUp: (index + count - 1) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = AERO_TOOLS[next]!.id;
    choose(id);
    requestAnimationFrame(() => document.getElementById(`kit-aero-tab-${id}`)?.focus());
  };
  return (
    <div className={styles.kit}>
      <div className={styles.tabs} role="tablist" aria-label={t('kitAero.tabs')} onKeyDown={onKey}>
        {AERO_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            id={`kit-aero-tab-${tool.id}`}
            aria-selected={tab === tool.id}
            aria-controls="kit-aero-panel"
            tabIndex={tab === tool.id ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(tool.id)}
          >
            {toolText(tool.id, 'short')}
          </button>
        ))}
      </div>
      <div id="kit-aero-panel" role="tabpanel" aria-labelledby={`kit-aero-tab-${tab}`} className={styles.body}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{toolText(tab, 'title')}</h2>
          <div className={styles.system}>
            <label htmlFor={systemId}>{t('kitAero.units')}</label>
            <select
              id={systemId}
              className={styles.input}
              value={system}
              onChange={(e) => chooseSystem(e.target.value === 'us' ? 'us' : 'si')}
            >
              <option value="si">{t('kitAero.si')}</option>
              <option value="us">{t('kitAero.us')}</option>
            </select>
          </div>
        </div>
        <Loaded key={tab} id={tab} system={system} />
      </div>
    </div>
  );
}

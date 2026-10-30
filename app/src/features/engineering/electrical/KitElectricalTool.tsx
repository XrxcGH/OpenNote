// The body of the circuits and energy window: tabs for the tools, and the chosen tool's form and answer. What was
// typed in each tool is remembered on this device, so closing the window loses nothing.
import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { loadStored, saveStored } from './store';
import { KIT_STORE, KIT_TAB_EVENT } from './events';
import { LOADERS } from './kit';
import { ELECTRICAL_TOOLS } from './meta';
import type { ElectricalToolId } from './meta';
import { initialValues } from './spec';
import type { ToolSpec } from './spec';
import type { Values } from './shared';
import { ToolPanel } from './ToolPanel';
import styles from './kit.module.css';

interface Saved {
  tab?: string;
  values?: Record<string, Values>;
}

const isTool = (id: unknown): id is ElectricalToolId => ELECTRICAL_TOOLS.some((tool) => tool.id === id);

const title = (id: string): string => (t as unknown as (k: string) => string)(`kitElectrical.t.${id}.short`);

function Loaded({
  id,
  saved,
  onSave,
}: {
  id: ElectricalToolId;
  saved: Values | undefined;
  onSave(values: Values): void;
}) {
  const [spec, setSpec] = useState<ToolSpec | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  useEffect(() => {
    let live = true;
    void LOADERS[id]().then((loaded) => {
      if (!live) return;
      setSpec(loaded.spec);
      setValues({ ...initialValues(loaded.spec), ...saved });
    });
    return () => {
      live = false;
    };
    // The saved values only seed the form when the tool loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!spec || !values) return <p>{t('kitElectrical.loading')}</p>;
  return (
    <ToolPanel
      spec={spec}
      values={values}
      onValues={(next) => {
        setValues(next);
        onSave(next);
      }}
    />
  );
}

export function KitElectricalTool() {
  const [tab, setTab] = useState<ElectricalToolId>(() => {
    const saved = loadStored<Saved>(KIT_STORE, {});
    return isTool(saved.tab) ? saved.tab : ELECTRICAL_TOOLS[0].id;
  });
  const remember = useCallback((next: ElectricalToolId, values?: Values) => {
    const saved = loadStored<Saved>(KIT_STORE, {});
    saveStored(KIT_STORE, {
      tab: next,
      values: values ? { ...saved.values, [next]: values } : saved.values,
    });
  }, []);
  useEffect(() => {
    const onTab = () => {
      const saved = loadStored<Saved>(KIT_STORE, {});
      if (isTool(saved.tab)) setTab(saved.tab);
    };
    window.addEventListener(KIT_TAB_EVENT, onTab);
    return () => window.removeEventListener(KIT_TAB_EVENT, onTab);
  }, []);
  const choose = (next: ElectricalToolId) => {
    setTab(next);
    remember(next);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ELECTRICAL_TOOLS.findIndex((tool) => tool.id === tab);
    const last = ELECTRICAL_TOOLS.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % ELECTRICAL_TOOLS.length,
      ArrowDown: (index + 1) % ELECTRICAL_TOOLS.length,
      ArrowLeft: (index + last) % ELECTRICAL_TOOLS.length,
      ArrowUp: (index + last) % ELECTRICAL_TOOLS.length,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = ELECTRICAL_TOOLS[next]!.id;
    choose(id);
    requestAnimationFrame(() => document.getElementById(`kit-electrical-tab-${id}`)?.focus());
  };
  const saved = loadStored<Saved>(KIT_STORE, {});
  return (
    <div className={styles.kit}>
      <div className={styles.tabs} role="tablist" aria-label={t('kitElectrical.tabs')} onKeyDown={onKey}>
        {ELECTRICAL_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            id={`kit-electrical-tab-${tool.id}`}
            aria-selected={tab === tool.id}
            aria-controls="kit-electrical-panel"
            tabIndex={tab === tool.id ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(tool.id)}
          >
            {title(tool.id)}
          </button>
        ))}
      </div>
      <div id="kit-electrical-panel" role="tabpanel" aria-labelledby={`kit-electrical-tab-${tab}`}>
        <Loaded key={tab} id={tab} saved={saved.values?.[tab]} onSave={(values) => remember(tab, values)} />
      </div>
    </div>
  );
}

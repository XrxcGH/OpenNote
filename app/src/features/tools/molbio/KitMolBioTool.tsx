// The body of the molecular biology window: tabs for the tools, and the chosen tool's form and answer. What was typed
// in each tool is remembered on this device, so closing the window loses nothing.
import './text';
import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { loadStored, saveStored } from '../ui/storage';
import { KIT_STORE, KIT_TAB_EVENT } from './events';
import { LOADERS } from './kit';
import { MOLBIO_TOOLS } from './meta';
import type { MolToolId } from './meta';
import { say } from './say';
import { initialValues } from './spec';
import type { ToolSpec } from './spec';
import type { MolKey, Values } from './shared';
import { ToolPanel } from './ToolPanel';
import styles from './kit.module.css';

interface Saved {
  tab?: string;
  values?: Record<string, Values>;
}

const isTool = (id: unknown): id is MolToolId => MOLBIO_TOOLS.some((tool) => tool.id === id);

function Loaded({ id, saved, onSave }: { id: MolToolId; saved: Values | undefined; onSave(values: Values): void }) {
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
  if (!spec || !values) return <p>{t('kitMolBio.loading')}</p>;
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

export function KitMolBioTool() {
  const [tab, setTab] = useState<MolToolId>(() => {
    const saved = loadStored<Saved>(KIT_STORE, {});
    return isTool(saved.tab) ? saved.tab : MOLBIO_TOOLS[0].id;
  });
  const remember = useCallback((next: MolToolId, values?: Values) => {
    const saved = loadStored<Saved>(KIT_STORE, {});
    saveStored(KIT_STORE, { tab: next, values: values ? { ...saved.values, [next]: values } : saved.values });
  }, []);
  useEffect(() => {
    const onTab = () => {
      const saved = loadStored<Saved>(KIT_STORE, {});
      if (isTool(saved.tab)) setTab(saved.tab);
    };
    window.addEventListener(KIT_TAB_EVENT, onTab);
    return () => window.removeEventListener(KIT_TAB_EVENT, onTab);
  }, []);
  const choose = (next: MolToolId) => {
    setTab(next);
    remember(next);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MOLBIO_TOOLS.findIndex((tool) => tool.id === tab);
    const count = MOLBIO_TOOLS.length;
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
    const id = MOLBIO_TOOLS[next]!.id;
    choose(id);
    requestAnimationFrame(() => document.getElementById(`kit-molbio-tab-${id}`)?.focus());
  };
  const saved = loadStored<Saved>(KIT_STORE, {});
  return (
    <div className={styles.kit}>
      <p className={styles.about}>{t('kitMolBio.coursework')}</p>
      <div className={styles.tabs} role="tablist" aria-label={t('kitMolBio.tabs')} onKeyDown={onKey}>
        {MOLBIO_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            id={`kit-molbio-tab-${tool.id}`}
            aria-selected={tab === tool.id}
            aria-controls="kit-molbio-panel"
            tabIndex={tab === tool.id ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(tool.id)}
          >
            {say(`${tool.id}.short` as MolKey)}
          </button>
        ))}
      </div>
      <div id="kit-molbio-panel" role="tabpanel" aria-labelledby={`kit-molbio-tab-${tab}`}>
        <Loaded key={tab} id={tab} saved={saved.values?.[tab]} onSave={(values) => remember(tab, values)} />
      </div>
    </div>
  );
}

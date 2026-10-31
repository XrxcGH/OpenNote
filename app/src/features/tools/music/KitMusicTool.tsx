// The body of the music and studio window: tabs for the tools, and the chosen tool's form and answer. What was typed
// in each tool is remembered on this device, so closing the window loses nothing.
import './text';
import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { loadStored, saveStored } from '../ui/storage';
import { KIT_STORE, KIT_TAB_EVENT } from './events';
import { LOADERS } from './kit';
import type { LoadedTool } from './kit';
import { MUSIC_TOOLS } from './meta';
import type { MusicToolId } from './meta';
import { initialValues } from './spec';
import type { Values } from './shared';
import { say, ToolPanel } from './ToolPanel';
import styles from './kit.module.css';

interface Saved {
  tab?: string;
  values?: Record<string, Values>;
}

const isTool = (id: unknown): id is MusicToolId => MUSIC_TOOLS.some((tool) => tool.id === id);

function Loaded({ id, saved, onSave }: { id: MusicToolId; saved: Values | undefined; onSave(values: Values): void }) {
  const [tool, setTool] = useState<LoadedTool | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  useEffect(() => {
    let live = true;
    void LOADERS[id]().then((loaded) => {
      if (!live) return;
      setTool(loaded);
      setValues({ ...(loaded.spec ? initialValues(loaded.spec) : {}), ...saved });
    });
    return () => {
      live = false;
    };
    // The saved values only seed the form when the tool loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!tool || !values) return <p>{t('kitMusic.loading')}</p>;
  if (tool.Panel) return <tool.Panel />;
  if (!tool.spec) return null;
  return (
    <ToolPanel
      spec={tool.spec}
      values={values}
      onValues={(next) => {
        setValues(next);
        onSave(next);
      }}
    />
  );
}

/** Arrow keys, Home, and End move between the tabs, as a tab list should. */
function nextTab(key: string, tab: MusicToolId): MusicToolId | null {
  const index = MUSIC_TOOLS.findIndex((tool) => tool.id === tab);
  const count = MUSIC_TOOLS.length;
  const moves: Record<string, number> = {
    ArrowRight: (index + 1) % count,
    ArrowDown: (index + 1) % count,
    ArrowLeft: (index + count - 1) % count,
    ArrowUp: (index + count - 1) % count,
    Home: 0,
    End: count - 1,
  };
  const next = moves[key];
  return next === undefined ? null : MUSIC_TOOLS[next]!.id;
}

export function KitMusicTool() {
  const [tab, setTab] = useState<MusicToolId>(() => {
    const saved = loadStored<Saved>(KIT_STORE, {});
    return isTool(saved.tab) ? saved.tab : MUSIC_TOOLS[0].id;
  });
  const remember = useCallback((next: MusicToolId, values?: Values) => {
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
  const choose = (next: MusicToolId) => {
    setTab(next);
    remember(next);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(event.key, tab);
    if (!next) return;
    event.preventDefault();
    choose(next);
    requestAnimationFrame(() => document.getElementById(`kit-music-tab-${next}`)?.focus());
  };
  const saved = loadStored<Saved>(KIT_STORE, {});
  return (
    <div className={styles.kit}>
      <div className={styles.tabs} role="tablist" aria-label={t('kitMusic.tabs')} onKeyDown={onKey}>
        {MUSIC_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            id={`kit-music-tab-${tool.id}`}
            aria-selected={tab === tool.id}
            aria-controls="kit-music-panel"
            tabIndex={tab === tool.id ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(tool.id)}
          >
            {say('t', `${tool.id}.short`)}
          </button>
        ))}
      </div>
      <div id="kit-music-panel" role="tabpanel" aria-labelledby={`kit-music-tab-${tab}`}>
        <Loaded key={tab} id={tab} saved={saved.values?.[tab]} onSave={(values) => remember(tab, values)} />
      </div>
    </div>
  );
}

export default KitMusicTool;

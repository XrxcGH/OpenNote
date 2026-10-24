// The Chemistry and materials window: a row of tabs, one per tool, and an SI / US switch that sets the units fields
// start in and the units answers are shown in. Arrow keys, Home, and End move between tabs. Which tab is open and which
// system is chosen are remembered; the palette opens a particular tab (see ../open.ts).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { loadStored, saveStored } from '../../ui/storage';
import tools from '../../ui/tools.module.css';
import extra from '../../ui/extra.module.css';
import { CHEMMAT_TAB_EVENT, TAB_STORE } from '../open';
import { CHEMMAT_TOOLS } from '../tools';
import type { System } from '../units';
import own from './chemmat.module.css';
import { ToolView } from './ToolView';
import { tr } from './text';

const SYSTEM_STORE = 'chemmat.system';

/** The arrow keys, Home, and End move between tabs; this gives the index of the tab to go to, or -1 for any other key. */
function targetTab(key: string, index: number): number {
  const last = CHEMMAT_TOOLS.length - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return index === last ? 0 : index + 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return index === 0 ? last : index - 1;
  if (key === 'Home') return 0;
  return key === 'End' ? last : -1;
}

function TabStrip({ tab, choose }: { tab: string; choose: (id: string) => void }) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const onKey = (event: KeyboardEvent, index: number) => {
    const to = targetTab(event.key, index);
    if (to < 0) return;
    event.preventDefault();
    const id = CHEMMAT_TOOLS[to].id;
    choose(id);
    refs.current.get(id)?.focus();
  };
  return (
    <div className={`${tools.tabs} ${own.tabList}`} role="tablist" aria-label={tr('kitChemMat.title')}>
      {CHEMMAT_TOOLS.map((x, i) => (
        <button
          key={x.id}
          ref={(node) => {
            if (node) refs.current.set(x.id, node);
          }}
          type="button"
          role="tab"
          id={`chemmat-tab-${x.id}`}
          aria-selected={tab === x.id}
          aria-controls="chemmat-panel"
          tabIndex={tab === x.id ? 0 : -1}
          className={`${tools.tab} ${own.tabButton}`}
          onClick={() => choose(x.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {tr(x.title)}
        </button>
      ))}
    </div>
  );
}

/** The menu that stands in for the tab strip when the window is narrow. */
function ToolMenu({ tab, choose }: { tab: string; choose: (id: string) => void }) {
  return (
    <label className={own.toolMenu}>
      <select
        className={extra.input}
        aria-label={tr('kitChemMat.title')}
        value={tab}
        onChange={(e) => choose(e.target.value)}
      >
        {CHEMMAT_TOOLS.map((x) => (
          <option key={x.id} value={x.id}>
            {tr(x.title)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SystemSwitch({ system, onChange }: { system: System; onChange: (next: System) => void }) {
  return (
    <label className={own.system}>
      {tr('kitChemMat.common.system')}
      <select className={extra.input} value={system} onChange={(e) => onChange(e.target.value === 'US' ? 'US' : 'SI')}>
        <option value="SI">{tr('kitChemMat.common.si')}</option>
        <option value="US">{tr('kitChemMat.common.us')}</option>
      </select>
    </label>
  );
}

export function KitWindow() {
  const [tab, setTab] = useState<string>(() => {
    const saved = loadStored<string>(TAB_STORE, '');
    return CHEMMAT_TOOLS.some((x) => x.id === saved) ? saved : CHEMMAT_TOOLS[0].id;
  });
  const [system, setSystem] = useState<System>(() => (loadStored<string>(SYSTEM_STORE, 'SI') === 'US' ? 'US' : 'SI'));

  useEffect(() => {
    const listen = () => {
      const saved = loadStored<string>(TAB_STORE, '');
      if (CHEMMAT_TOOLS.some((x) => x.id === saved)) setTab(saved);
    };
    window.addEventListener(CHEMMAT_TAB_EVENT, listen);
    return () => window.removeEventListener(CHEMMAT_TAB_EVENT, listen);
  }, []);

  const choose = (id: string) => {
    setTab(id);
    saveStored(TAB_STORE, id);
  };
  const spec = CHEMMAT_TOOLS.find((x) => x.id === tab) ?? CHEMMAT_TOOLS[0];

  return (
    <div className={`${tools.tool} ${own.root}`}>
      <div className={own.bar}>
        <TabStrip tab={tab} choose={choose} />
        <ToolMenu tab={spec.id} choose={choose} />
        <SystemSwitch
          system={system}
          onChange={(next) => {
            setSystem(next);
            saveStored(SYSTEM_STORE, next);
          }}
        />
      </div>
      <div id="chemmat-panel" role="tabpanel" aria-labelledby={`chemmat-tab-${spec.id}`} className={extra.scroll}>
        <ToolView key={spec.id} spec={spec} system={system} />
      </div>
    </div>
  );
}

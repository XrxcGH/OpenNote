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

export function KitWindow() {
  const [tab, setTab] = useState<string>(() => {
    const saved = loadStored<string>(TAB_STORE, '');
    return CHEMMAT_TOOLS.some((x) => x.id === saved) ? saved : CHEMMAT_TOOLS[0].id;
  });
  const [system, setSystem] = useState<System>(() => (loadStored<string>(SYSTEM_STORE, 'SI') === 'US' ? 'US' : 'SI'));
  const refs = useRef(new Map<string, HTMLButtonElement>());

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
  const onKey = (event: KeyboardEvent, index: number) => {
    const last = CHEMMAT_TOOLS.length - 1;
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (to < 0) return;
    event.preventDefault();
    const id = CHEMMAT_TOOLS[to].id;
    choose(id);
    refs.current.get(id)?.focus();
  };
  const spec = CHEMMAT_TOOLS.find((x) => x.id === tab) ?? CHEMMAT_TOOLS[0];

  return (
    <div className={tools.tool}>
      <div className={own.bar}>
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
        <label className={own.system}>
          {tr('kitChemMat.common.system')}
          <select
            className={extra.input}
            value={system}
            onChange={(e) => {
              const next = e.target.value === 'US' ? 'US' : 'SI';
              setSystem(next);
              saveStored(SYSTEM_STORE, next);
            }}
          >
            <option value="SI">{tr('kitChemMat.common.si')}</option>
            <option value="US">{tr('kitChemMat.common.us')}</option>
          </select>
        </label>
      </div>
      <div id="chemmat-panel" role="tabpanel" aria-labelledby={`chemmat-tab-${spec.id}`} className={extra.scroll}>
        <ToolView key={spec.id} spec={spec} system={system} />
      </div>
    </div>
  );
}

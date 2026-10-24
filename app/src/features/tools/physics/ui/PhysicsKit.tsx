// The physics tools window: a tab per tool (arrow keys, Home and End move between them), the unit system, and the
// tool that is shown. The window remembers its tab, its unit system, and what was typed in each tool.
import { Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../../strings/t';
import { PHYSICS_KIT } from '../kit';
import { sayKey } from '../kit/say';
import type { UnitSystem } from '../kit/types';
import { followPhysicsTab, savePhysicsTab, savedPhysicsTab } from '../open';
import { loadStored, saveStored } from '../../ui/storage';
import { pageInsert } from './insert';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import styles from './physics.module.css';

const STORE = 'kit.physics';

interface Saved {
  system?: UnitSystem;
  inputs?: Record<string, unknown>;
}

const known = (id: string | null) => PHYSICS_KIT.tools.find((tool) => tool.id === id)?.id ?? PHYSICS_KIT.tools[0]?.id;

export function PhysicsKit() {
  const saved = loadStored<Saved>(STORE, {});
  const [tab, setTab] = useState(() => known(savedPhysicsTab()));
  const [system, setSystem] = useState<UnitSystem>(saved.system === 'US' ? 'US' : 'SI');
  const [inputs, setInputs] = useState<Record<string, unknown>>(saved.inputs ?? {});
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => followPhysicsTab(() => setTab(known(savedPhysicsTab()))), []);
  useEffect(() => saveStored(STORE, { system, inputs }), [system, inputs]);

  const choose = (index: number, focus: boolean) => {
    const tool = PHYSICS_KIT.tools[index];
    if (!tool) return;
    setTab(tool.id);
    savePhysicsTab(tool.id);
    if (focus) tabs.current[index]?.focus();
  };
  const onKey = (event: KeyboardEvent, index: number) => {
    const last = PHYSICS_KIT.tools.length - 1;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next > last ? 0 : next < 0 ? last : next, true);
  };

  const shown = PHYSICS_KIT.tools.find((tool) => tool.id === tab);
  if (!shown) return <p className={tools.empty}>{t('kitPhysics.ui.empty')}</p>;
  const Tool = shown.Component;
  return (
    <div className={tools.tool}>
      <div className={styles.bar}>
        <div className={styles.tabs} role="tablist" aria-label={t('kitPhysics.ui.tools')}>
          {PHYSICS_KIT.tools.map((tool, index) => (
            <button
              key={tool.id}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`physics-tab-${tool.id}`}
              aria-selected={tool.id === tab}
              aria-controls="physics-panel"
              tabIndex={tool.id === tab ? 0 : -1}
              className={tools.tab}
              onClick={() => choose(index, false)}
              onKeyDown={(event) => onKey(event, index)}
            >
              {sayKey(tool.title)}
            </button>
          ))}
        </div>
        <label className={styles.system}>
          {t('kitPhysics.ui.units')}
          <select
            className={extra.input}
            value={system}
            onChange={(event) => setSystem(event.target.value === 'US' ? 'US' : 'SI')}
          >
            <option value="SI">{t('kitPhysics.ui.si')}</option>
            <option value="US">{t('kitPhysics.ui.us')}</option>
          </select>
        </label>
      </div>
      <div id="physics-panel" role="tabpanel" aria-labelledby={`physics-tab-${shown.id}`}>
        <Suspense fallback={<p className={tools.note}>{t('kitPhysics.ui.loading')}</p>}>
          <Tool
            key={shown.id}
            inputs={inputs[shown.id] ?? null}
            setInputs={(next) => setInputs((all) => ({ ...all, [shown.id]: next }))}
            system={system}
            insert={pageInsert}
          />
        </Suspense>
      </div>
    </div>
  );
}

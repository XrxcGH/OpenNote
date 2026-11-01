// The physics tools window: a tool picker, the unit system, and the tool that is shown. With 9 tools a list box
// stays one row high at any width, where a row of tabs would fill a narrow window. The window remembers its tool, its
// unit system, and what was typed in each tool.
import '../text';
import { Suspense, useEffect, useState } from 'react';
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

  useEffect(() => followPhysicsTab(() => setTab(known(savedPhysicsTab()))), []);
  useEffect(() => saveStored(STORE, { system, inputs }), [system, inputs]);

  const choose = (id: string) => {
    const tool = PHYSICS_KIT.tools.find((one) => one.id === id);
    if (!tool) return;
    setTab(tool.id);
    savePhysicsTab(tool.id);
  };

  const shown = PHYSICS_KIT.tools.find((tool) => tool.id === tab);
  if (!shown) return <p className={tools.empty}>{t('kitPhysics.ui.empty')}</p>;
  const Tool = shown.Component;
  return (
    <div className={tools.tool}>
      <div className={styles.bar}>
        <label className={styles.picker}>
          {t('kitPhysics.ui.tool')}
          <select className={extra.input} value={shown.id} onChange={(event) => choose(event.target.value)}>
            {PHYSICS_KIT.tools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {sayKey(tool.title)}
              </option>
            ))}
          </select>
        </label>
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
      <section aria-label={sayKey(shown.title)}>
        <Suspense fallback={<p className={tools.note}>{t('kitPhysics.ui.loading')}</p>}>
          <Tool
            key={shown.id}
            inputs={inputs[shown.id] ?? null}
            setInputs={(next) => setInputs((all) => ({ ...all, [shown.id]: next }))}
            system={system}
            insert={pageInsert}
          />
        </Suspense>
      </section>
    </div>
  );
}

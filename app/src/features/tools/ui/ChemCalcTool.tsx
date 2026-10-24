// The chemistry calculators window: balancing, molar mass, stoichiometry, gas laws, solutions, and titration. Each tab
// holds one or more forms (chemForms.tsx) over the methods in ../chem/calc.
import { useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { ChemForm } from './ChemForm';
import { CALC_TABS, SUB_FORMS } from './chemForms';
import type { CalcTab } from './chemForms';
import chem from './chem.module.css';
import extra from './extra.module.css';
import { loadStored, saveStored } from './storage';
import { useSelectedTabInView } from './tabScroll';
import styles from './tools.module.css';

const STORE = 'chemcalc';

export function ChemCalcTool() {
  const saved = loadStored<{ tab?: CalcTab; sub?: Record<string, string> }>(STORE, {});
  const [tab, setTab] = useState<CalcTab>(
    CALC_TABS.includes(saved.tab as CalcTab) ? (saved.tab as CalcTab) : 'balance',
  );
  const [sub, setSub] = useState<Record<string, string>>(saved.sub ?? {});
  const strip = useRef<HTMLDivElement>(null);
  useSelectedTabInView(strip, tab);
  const forms = SUB_FORMS[tab];
  const current = forms.find((f) => f.id === sub[tab]) ?? forms[0];

  const remember = (nextTab: CalcTab, nextSub: Record<string, string>) =>
    saveStored(STORE, { tab: nextTab, sub: nextSub });

  return (
    <div className={styles.toolFill}>
      <div ref={strip} className={styles.tabs} role="tablist" aria-label={t('chem.calc.title')}>
        {CALC_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`chem-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="chem-panel"
            className={styles.tab}
            onClick={() => {
              setTab(id);
              remember(id, sub);
            }}
          >
            {t(`chem.calc.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div
        id="chem-panel"
        role="tabpanel"
        aria-labelledby={`chem-tab-${tab}`}
        className={`${extra.scroll} ${chem.panel}`}
      >
        {forms.length > 1 ? (
          <label className={extra.field}>
            {t('chem.calc.kind')}
            <select
              className={extra.input}
              value={current.id}
              onChange={(event) => {
                const next = { ...sub, [tab]: event.target.value };
                setSub(next);
                remember(tab, next);
              }}
            >
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {t(f.label)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ChemForm key={current.id} {...current.form} intro={current.form.intro ? t(current.form.intro) : undefined} />
      </div>
    </div>
  );
}

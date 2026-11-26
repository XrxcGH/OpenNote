// The thermodynamics kit window: a tab for each tool, in a tab list for each subject, and a choice of SI or US
// customary units. The tabs follow the ARIA tabs pattern across the lists, which share one panel: arrow keys move
// between them, Home and End go to the ends, and only the chosen tab is in the Tab order. Each tool's form and engine
// load the first time its tab opens.
import '../text';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../../../strings/t';
import type { ToolSpec } from '../common/spec';
import type { System } from '../common/units';
import { THERMO_LOADERS } from '../kit';
import { THERMO_META, type ThermoToolId, type ThermoToolMeta } from '../meta';
import { switchSystem, fieldsOf } from './formState';
import { say } from './say';
import { chooseTool, onTool, saveSystem, storedSystem, storedTool, type SavedForm } from './store';
import { ToolForm, firstForm } from './ToolForm';
import styles from './thermo.module.css';

type Subject = ThermoToolMeta['subject'];

/** The tools by subject, in the order the subjects first appear; the tabs read and move in this order. */
const GROUPS: readonly { subject: Subject; tools: ThermoToolId[] }[] = THERMO_META.reduce<
  { subject: Subject; tools: ThermoToolId[] }[]
>((groups, meta) => {
  const group = groups.find((one) => one.subject === meta.subject);
  if (group) group.tools.push(meta.id);
  else groups.push({ subject: meta.subject, tools: [meta.id] });
  return groups;
}, []);
const ORDER: readonly ThermoToolId[] = GROUPS.flatMap((group) => group.tools);

function useSpec(tool: ThermoToolId): ToolSpec | null {
  const [loaded, setLoaded] = useState<{ tool: ThermoToolId; spec: ToolSpec } | null>(null);
  useEffect(() => {
    let live = true;
    void THERMO_LOADERS[tool]().then((module) => live && setLoaded({ tool, spec: module.spec }));
    return () => {
      live = false;
    };
  }, [tool]);
  return loaded?.tool === tool ? loaded.spec : null;
}

interface BodyProps {
  tool: ThermoToolId;
  system: System;
  onSystem(next: System): void;
}

function LoadedTool({ tool, spec, system, onSystem }: BodyProps & { spec: ToolSpec }) {
  const [form, setForm] = useState<SavedForm>(() => firstForm(tool, spec));
  const changeSystem = (next: System) => {
    const mode = spec.modes.find((one) => one.id === form.mode) ?? spec.modes[0];
    setForm(switchSystem(form, fieldsOf(mode, form, system), system, next));
    onSystem(next);
  };
  return (
    <>
      <label className={styles.field}>
        <span>{t('kitThermo.ui.system')}</span>
        <select
          className={styles.input}
          value={system}
          onChange={(event) => changeSystem(event.target.value === 'US' ? 'US' : 'SI')}
        >
          <option value="SI">{t('kitThermo.ui.si')}</option>
          <option value="US">{t('kitThermo.ui.us')}</option>
        </select>
      </label>
      <ToolForm tool={tool} spec={spec} system={system} form={form} onForm={setForm} />
    </>
  );
}

function ToolBody(props: BodyProps) {
  const spec = useSpec(props.tool);
  if (!spec) return <p className={styles.note}>{t('kitThermo.ui.loading')}</p>;
  return <LoadedTool key={props.tool} spec={spec} {...props} />;
}

export function ThermoKit() {
  const [tool, setTool] = useState<ThermoToolId>(storedTool);
  const [system, setSystem] = useState<System>(storedSystem);
  const tabs = useRef<Partial<Record<ThermoToolId, HTMLButtonElement | null>>>({});
  useEffect(() => onTool(setTool), []);
  const pick = (next: ThermoToolId, focus = false) => {
    chooseTool(next);
    if (focus) tabs.current[next]?.focus();
  };
  const keys = (event: KeyboardEvent) => {
    const at = ORDER.indexOf(tool);
    const n = ORDER.length;
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1 };
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    pick(ORDER[(target + n) % n], true);
  };
  return (
    <div className={styles.kit}>
      <div className={styles.tabs} role="group" aria-label={t('kitThermo.ui.tools')}>
        {GROUPS.map(({ subject, tools }) => (
          <div key={subject} className={styles.tabGroup}>
            <span id={`thermo-subject-${subject}`} className={styles.subject}>
              {say(`kitThermo.subject.${subject}`)}
            </span>
            <div
              role="tablist"
              aria-labelledby={`thermo-subject-${subject}`}
              className={styles.tabRow}
              onKeyDown={keys}
            >
              {tools.map((id) => (
                <button
                  key={id}
                  ref={(node) => {
                    tabs.current[id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`thermo-tab-${id}`}
                  aria-selected={id === tool}
                  aria-controls="thermo-panel"
                  tabIndex={id === tool ? 0 : -1}
                  className={styles.tab}
                  onClick={() => pick(id)}
                >
                  {say(`kitThermo.tab.${id}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div id="thermo-panel" role="tabpanel" aria-labelledby={`thermo-tab-${tool}`} className={styles.panel}>
        <ToolBody
          key={tool}
          tool={tool}
          system={system}
          onSystem={(next) => {
            setSystem(next);
            saveSystem(next);
          }}
        />
      </div>
    </div>
  );
}

export default ThermoKit;

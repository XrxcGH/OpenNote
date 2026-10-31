// The life-systems window: a tab per tool (arrow keys move between them), and in each tool a choice of calculation
// and its form. A tool's forms load the first time its tab opens. The window remembers the last tool and
// calculation, and a palette command can open it at a given tool.
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useStore } from '../../../../state/store';
import { loadStored, saveStored } from '../../ui/storage';
import { KIT_LOADERS } from '../kit';
import { LIFESYS_TOOLS, isLifeSysTool } from '../meta';
import type { LifeSysToolId } from '../meta';
import { lifeSysRequest } from '../open';
import type { ToolSpec } from '../types';
import { CalcForm } from './CalcForm';
import styles from './lifesys.module.css';
import { problem, word } from './words';

const STORE = 'lifesys';
const selectRequest = (state: { tool: LifeSysToolId | null; at: number }) => state;

function ToolPage({ id, spec }: { id: LifeSysToolId; spec: ToolSpec }) {
  const saved = loadStored<Record<string, string>>(`${STORE}.calc`, {});
  const [calcId, setCalcId] = useState(() => saved[id] ?? spec.calcs[0].id);
  const calc = spec.calcs.find((c) => c.id === calcId) ?? spec.calcs[0];
  const selectId = `ls-${id}-calc`;
  return (
    <div className={styles.tool}>
      {spec.clinical ? <p className={styles.caution}>{word('ui.clinical')}</p> : null}
      {spec.calcs.length > 1 ? (
        <div className={styles.field}>
          <label htmlFor={selectId}>{word('ui.calculation')}</label>
          <select
            id={selectId}
            className={styles.input}
            value={calc.id}
            onChange={(e) => {
              setCalcId(e.target.value);
              saveStored(`${STORE}.calc`, { ...loadStored(`${STORE}.calc`, {}), [id]: e.target.value });
            }}
          >
            {spec.calcs.map((c) => (
              <option key={c.id} value={c.id}>
                {word(c.label)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <CalcForm key={`${id}.${calc.id}`} tool={id} spec={calc} store={`${STORE}.${id}.${calc.id}`} />
    </div>
  );
}

function useToolSpec(id: LifeSysToolId): { spec: ToolSpec | null; error: string | null } {
  const [loaded, setLoaded] = useState<{ id: LifeSysToolId; spec: ToolSpec | null; error: string | null }>({
    id,
    spec: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    KIT_LOADERS[id]().then(
      (spec) => live && setLoaded({ id, spec, error: null }),
      (error: unknown) => live && setLoaded({ id, spec: null, error: problem(error) }),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return loaded.id === id ? loaded : { spec: null, error: null };
}

export function LifeSysTool() {
  const request = useStore(lifeSysRequest, selectRequest);
  const [tool, setTool] = useState<LifeSysToolId>(() => {
    const saved = loadStored<{ tool?: string }>(STORE, {}).tool;
    return request.tool ?? (isLifeSysTool(saved) ? saved : LIFESYS_TOOLS[0].id);
  });
  const [seen, setSeen] = useState(request.at);
  if (request.tool && request.at !== seen) {
    setSeen(request.at);
    setTool(request.tool);
  }
  const { spec, error } = useToolSpec(tool);
  const choose = (next: LifeSysToolId, focus = false) => {
    setTool(next);
    saveStored(STORE, { tool: next });
    if (focus) document.getElementById(`ls-tab-${next}`)?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = LIFESYS_TOOLS.findIndex((one) => one.id === tool);
    const last = LIFESYS_TOOLS.length - 1;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next: number | null = step === undefined ? null : (index + step + LIFESYS_TOOLS.length) % LIFESYS_TOOLS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    choose(LIFESYS_TOOLS[next].id, true);
  };
  return (
    <div className={styles.tool}>
      <div className={styles.tabs} role="tablist" aria-label={word('ui.windowTitle')} onKeyDown={onKey}>
        {LIFESYS_TOOLS.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            id={`ls-tab-${one.id}`}
            aria-selected={tool === one.id}
            aria-controls="ls-panel"
            tabIndex={tool === one.id ? 0 : -1}
            className={styles.tab}
            onClick={() => choose(one.id)}
          >
            {word(`tools.${one.id}.tab`)}
          </button>
        ))}
      </div>
      <div id="ls-panel" role="tabpanel" aria-labelledby={`ls-tab-${tool}`} className={styles.panel}>
        {/* A new request (a palette command, or a live block's Open in tool) reads the saved values again. */}
        {spec ? (
          <ToolPage key={`${tool}.${seen}`} id={tool} spec={spec} />
        ) : error ? (
          <p className={styles.note}>{error}</p>
        ) : null}
      </div>
    </div>
  );
}

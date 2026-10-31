// The statistical models kit window: a tab for each tool. The tabs follow the ARIA tabs pattern: arrow keys move
// between them, Home and End go to the ends, and only the chosen tab is in the Tab order. A tool's code loads the
// first time its tab opens.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { STATMODELS_TOOLS } from '../meta';
import { followTab, saveTab, savedTab } from '../open';
import { SPECS } from '../specs';
import type { ToolSpec } from '../kit/spec';
import { ToolPanel, say } from './ToolPanel';
import styles from './statmodels.module.css';

const IDS = STATMODELS_TOOLS.map((tool) => tool.id);
const chosen = (): string => {
  const saved = savedTab();
  return saved && IDS.includes(saved) ? saved : IDS[0];
};

function useSpec(id: string): ToolSpec | null {
  const [loaded, setLoaded] = useState<{ id: string; spec: ToolSpec } | null>(null);
  useEffect(() => {
    let live = true;
    void SPECS[id]?.().then((spec) => {
      if (live) setLoaded({ id, spec });
    });
    return () => {
      live = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded.spec : null;
}

export function StatModelsKit() {
  const [tab, setTab] = useState(chosen);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => followTab(() => setTab(chosen())), []);
  const spec = useSpec(tab);
  const pick = (id: string, focus = false) => {
    saveTab(id);
    setTab(id);
    if (focus) buttons.current[id]?.focus();
  };
  const keys = (event: KeyboardEvent) => {
    const at = IDS.indexOf(tab);
    const moves: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: IDS.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    pick(IDS[(moves[event.key] + IDS.length) % IDS.length], true);
  };
  return (
    <div className={styles.tool}>
      <div className={styles.tabs} role="tablist" aria-label={say('kitStatModels.tabs')} onKeyDown={keys}>
        {STATMODELS_TOOLS.map((tool) => (
          <button
            key={tool.id}
            ref={(node) => {
              buttons.current[tool.id] = node;
            }}
            type="button"
            role="tab"
            id={`kit-statmodels-tab-${tool.id}`}
            aria-selected={tool.id === tab}
            aria-controls="kit-statmodels-panel"
            tabIndex={tool.id === tab ? 0 : -1}
            className={styles.tab}
            onClick={() => pick(tool.id)}
          >
            {say(tool.title)}
          </button>
        ))}
      </div>
      <div id="kit-statmodels-panel" role="tabpanel" aria-labelledby={`kit-statmodels-tab-${tab}`}>
        {spec ? <ToolPanel key={tab} tool={tab} spec={spec} /> : <p role="status">{say('kitStatModels.loading')}</p>}
      </div>
    </div>
  );
}

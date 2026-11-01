// The design kit window: a tab for each tool. The tabs follow the ARIA tabs pattern: arrow keys move between them,
// Home and End go to the ends, and only the chosen tab is in the Tab order. A tool's code loads the first time its
// tab opens.
import '../text';
import { Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DESIGN_TOOLS } from '../meta';
import { followTab, saveTab, savedTab } from '../open';
import { PANELS } from './panels';
import { say } from './ToolPanel';
import styles from './design.module.css';

const IDS = DESIGN_TOOLS.map((tool) => tool.id);
const chosen = (): string => {
  const saved = savedTab();
  return saved && IDS.includes(saved) ? saved : (IDS[0] ?? '');
};

export function DesignKit() {
  const [tab, setTab] = useState(chosen);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => followTab(() => setTab(chosen())), []);
  const Panel = PANELS[tab];
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
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = IDS[(next + IDS.length) % IDS.length];
    if (id) pick(id, true);
  };
  return (
    <div className={styles.tool}>
      <div className={styles.tabs} role="tablist" aria-label={say('kitDesign.tabs')} onKeyDown={keys}>
        {DESIGN_TOOLS.map((tool) => (
          <button
            key={tool.id}
            ref={(node) => {
              buttons.current[tool.id] = node;
            }}
            type="button"
            role="tab"
            id={`kit-design-tab-${tool.id}`}
            aria-selected={tool.id === tab}
            aria-controls="kit-design-panel"
            tabIndex={tool.id === tab ? 0 : -1}
            className={styles.tab}
            onClick={() => pick(tool.id)}
          >
            {say(tool.title)}
          </button>
        ))}
      </div>
      <div id="kit-design-panel" role="tabpanel" aria-labelledby={`kit-design-tab-${tab}`}>
        <Suspense fallback={<p role="status">{say('kitDesign.loading')}</p>}>{Panel && <Panel key={tab} />}</Suspense>
      </div>
    </div>
  );
}

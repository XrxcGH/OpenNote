// The psychology and behavior kit window: a tab for each tool. The tabs follow the ARIA tabs pattern: arrow keys
// move between them, Home and End go to the ends, and only the chosen tab is in the Tab order. A tool's code loads
// the first time its tab opens.
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { SPECS } from '../specs';
import type { ToolSpec } from '../kit/spec';
import { MIND_TOOLS } from '../meta';
import { followTab, saveTab, savedTab } from '../open';
import { EXTRAS } from './extras';
import { say } from './insert';
import { ToolPanel, type ExtraProps } from './ToolPanel';
import styles from './mind.module.css';

const IDS = MIND_TOOLS.map((tool) => tool.id);
const chosen = (): string => {
  const saved = savedTab();
  return saved && IDS.includes(saved) ? saved : IDS[0];
};

interface Loaded {
  readonly id: string;
  readonly spec: ToolSpec;
  readonly extra?: ComponentType<ExtraProps>;
}

function useTool(id: string): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([SPECS[id]?.(), EXTRAS[id]?.()]).then(([spec, extra]) => {
      if (live && spec) setLoaded({ id, spec, ...(extra ? { extra } : {}) });
    });
    return () => {
      live = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded : null;
}

export function MindKit() {
  const [tab, setTab] = useState(chosen);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => followTab(() => setTab(chosen())), []);
  const tool = useTool(tab);
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
      <div className={styles.tabs} role="tablist" aria-label={say('kitMind.tabs')} onKeyDown={keys}>
        {MIND_TOOLS.map((one) => (
          <button
            key={one.id}
            ref={(node) => {
              buttons.current[one.id] = node;
            }}
            type="button"
            role="tab"
            id={`kit-mind-tab-${one.id}`}
            aria-selected={one.id === tab}
            aria-controls="kit-mind-panel"
            tabIndex={one.id === tab ? 0 : -1}
            className={styles.tab}
            onClick={() => pick(one.id)}
          >
            {say(one.title)}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{say('kitMind.coursework')}</p>
      <div id="kit-mind-panel" role="tabpanel" aria-labelledby={`kit-mind-tab-${tab}`}>
        {tool ? (
          <ToolPanel key={tab} tool={tab} spec={tool.spec} {...(tool.extra ? { extra: tool.extra } : {})} />
        ) : (
          <p role="status">{say('kitMind.loading')}</p>
        )}
      </div>
    </div>
  );
}

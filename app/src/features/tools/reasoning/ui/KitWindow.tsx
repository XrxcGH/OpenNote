// The reasoning kit window: a tab for each tool, a list of the tool's modes, and the chosen mode's form. A tool's
// code loads the first time its tab opens. The palette can open the window at a tool (open.ts).
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { loadStored, saveStored } from '../../ui/storage';
import { loadTool } from '../kit';
import { REASONING_TOOLS, isReasoningTool } from '../meta';
import type { ReasoningToolId } from '../meta';
import { reasoningTab } from '../open';
import { ModeForm } from './ModeForm';
import { say } from './say';
import type { ToolSpec } from './types';
import styles from './reasoning.module.css';

const STORE = 'kit-reasoning';

interface Saved {
  tool?: string;
  modes?: Record<string, string>;
}

function useSpec(tool: ReasoningToolId): ToolSpec | null {
  const [spec, setSpec] = useState<ToolSpec | null>(null);
  useEffect(() => {
    let live = true;
    void loadTool(tool).then((loaded) => live && setSpec(loaded));
    return () => {
      live = false;
    };
  }, [tool]);
  return spec?.id === tool ? spec : null;
}

function Tabs({ tool, choose }: { tool: ReasoningToolId; choose(next: ReasoningToolId): void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = REASONING_TOOLS.indexOf(tool);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const target =
      event.key === 'Home' ? 0 : event.key === 'End' ? REASONING_TOOLS.length - 1 : step ? at + step : null;
    if (target === null) return;
    event.preventDefault();
    const next = REASONING_TOOLS[(target + REASONING_TOOLS.length) % REASONING_TOOLS.length];
    choose(next);
    document.getElementById(`kit-reasoning-tab-${next}`)?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label={say('title')} onKeyDown={onKeyDown}>
      {REASONING_TOOLS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`kit-reasoning-tab-${id}`}
          aria-selected={tool === id}
          aria-controls="kit-reasoning-panel"
          tabIndex={tool === id ? 0 : -1}
          className={styles.tab}
          onClick={() => choose(id)}
        >
          {say(`tools.${id}.tab`)}
        </button>
      ))}
    </div>
  );
}

export function KitWindow() {
  const saved = loadStored<Saved>(STORE, {});
  const [tool, setTool] = useState<ReasoningToolId>(
    () => reasoningTab.get() ?? (isReasoningTool(saved.tool) ? saved.tool : REASONING_TOOLS[0]),
  );
  const [modes, setModes] = useState<Record<string, string>>(saved.modes ?? {});
  const spec = useSpec(tool);

  const choose = (next: ReasoningToolId) => {
    setTool(next);
    saveStored(STORE, { ...loadStored<Saved>(STORE, {}), tool: next });
  };
  // The palette names a tool before the window opens (read as the first tab above), or while it is open.
  useEffect(() => {
    const remember = (asked: ReasoningToolId) => {
      reasoningTab.set(null);
      saveStored(STORE, { ...loadStored<Saved>(STORE, {}), tool: asked });
    };
    const first = reasoningTab.get();
    if (first) remember(first);
    return reasoningTab.subscribe(() => {
      const asked = reasoningTab.get();
      if (!asked) return;
      remember(asked);
      setTool(asked);
    });
  }, []);

  const mode = spec ? (spec.modes.find((m) => m.id === modes[tool]) ?? spec.modes[0]) : null;
  const pick = (id: string) => {
    const next = { ...modes, [tool]: id };
    setModes(next);
    saveStored(STORE, { ...loadStored<Saved>(STORE, {}), modes: next });
  };

  return (
    <div className={styles.kit}>
      <Tabs tool={tool} choose={choose} />
      <div
        id="kit-reasoning-panel"
        role="tabpanel"
        aria-labelledby={`kit-reasoning-tab-${tool}`}
        className={styles.panel}
      >
        <p className={styles.note}>{say(`tools.${tool}.summary`)}</p>
        {spec && mode ? (
          <>
            <div className={styles.field}>
              <label htmlFor="kit-reasoning-mode">{say('common.mode')}</label>
              <select
                id="kit-reasoning-mode"
                className={styles.input}
                value={mode.id}
                onChange={(event) => pick(event.target.value)}
              >
                {spec.modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {say(`${tool}.modes.${m.id}.name`)}
                  </option>
                ))}
              </select>
            </div>
            <ModeForm key={`${tool}.${mode.id}`} tool={tool} mode={mode} />
          </>
        ) : (
          <p className={styles.note}>{say('common.loading')}</p>
        )}
      </div>
    </div>
  );
}

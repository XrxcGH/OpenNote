// A kit's window: its tools as ARIA tabs (arrow keys, Home, and End move between them), the SI / US switch, and the
// chosen tool below. The window remembers the last tool, the system, and each tool's inputs on this device, and a
// live calculation block's Open in tool lands here with its saved inputs. Each tool loads the first time it shows.
import { Component, Suspense, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { onKitInputs, onKitTab, savedKitTab, selectKitTab, takeKitInputs } from '../registry';
import type { KitDef } from '../types';
import type { UnitSystem } from '../units';
import { SystemToggle } from './fields';
import { say } from './words';
import styles from './kit.module.css';

const inputsKey = (kit: string) => `opennote.kits.${kit}.inputs`;
const systemKey = (kit: string) => `opennote.kits.${kit}.system`;

function load<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : (JSON.parse(saved) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or off; the window keeps working and forgets on close.
  }
}

class ToolBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <p className={styles.problem}>{say('kits.window.failed')}</p> : this.props.children;
  }
}

/** The kit's tools, the chosen one, the system, and each tool's inputs, kept on this device. */
function useKitState(kit: KitDef) {
  const first = kit.tools[0]?.id ?? '';
  const known = (tool: string | null) => (tool && kit.tools.some((one) => one.id === tool) ? tool : null);
  const [tab, setTab] = useState(() => known(savedKitTab(kit.id)) ?? first);
  const [system, setSystem] = useState<UnitSystem>(() =>
    load<string>(systemKey(kit.id), 'SI') === 'US' ? 'US' : 'SI',
  );
  const [inputs, setInputs] = useState<Record<string, unknown>>(() => load(inputsKey(kit.id), {}));
  // A tool remounts when a block hands it inputs, so it starts from them.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const restore = (tool: string) => {
      if (!known(tool)) return;
      const arrived = takeKitInputs(kit.id, tool);
      setTab(tool);
      if (arrived === null) return;
      setInputs((current) => {
        const next = { ...current, [tool]: arrived };
        save(inputsKey(kit.id), next);
        return next;
      });
      setRevision((n) => n + 1);
    };
    restore(tab);
    const stopInputs = onKitInputs(kit.id, restore);
    const stopTab = onKitTab(kit.id, (tool) => known(tool) && setTab(tool));
    return () => {
      stopInputs();
      stopTab();
    };
    // Subscribes once per kit; `tab` is only the starting tool.
  }, [kit.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    tab,
    choose: (tool: string) => {
      setTab(tool);
      selectKitTab(kit.id, tool);
    },
    system,
    setSystem: (next: UnitSystem) => {
      setSystem(next);
      save(systemKey(kit.id), next);
    },
    inputs,
    setToolInputs: (tool: string, next: unknown) =>
      setInputs((current) => {
        const all = { ...current, [tool]: next };
        save(inputsKey(kit.id), all);
        return all;
      }),
    revision,
  };
}

export function KitWindow({ kit }: { kit: KitDef }) {
  const id = useId();
  const state = useKitState(kit);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (kit.tools.length === 0) return <p className={styles.note}>{say('kits.window.empty')}</p>;
  const index = Math.max(
    0,
    kit.tools.findIndex((tool) => tool.id === state.tab),
  );
  const current = kit.tools[index];
  const Tool = current.Component;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = kit.tools.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (moves[event.key] + kit.tools.length) % kit.tools.length;
    state.choose(kit.tools[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className={styles.window}>
      <div className={styles.header}>
        <div role="tablist" aria-label={say('kits.window.tools')} className={styles.tabs}>
          {kit.tools.map((tool, i) => (
            <button
              key={tool.id}
              ref={(element) => {
                tabs.current[i] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${tool.id}`}
              aria-selected={i === index}
              aria-controls={`${id}-panel`}
              tabIndex={i === index ? 0 : -1}
              className={styles.tab}
              onClick={() => state.choose(tool.id)}
              onKeyDown={onKeyDown}
            >
              {say(tool.title)}
            </button>
          ))}
        </div>
        <SystemToggle system={state.system} onChange={state.setSystem} />
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${current.id}`} className={styles.tool}>
        <ToolBoundary key={current.id}>
          <Suspense fallback={<p className={styles.note}>{say('kits.window.loading')}</p>}>
            <Tool
              key={`${current.id}.${state.revision}`}
              inputs={state.inputs[current.id] ?? null}
              setInputs={(next: unknown) => state.setToolInputs(current.id, next)}
              system={state.system}
            />
          </Suspense>
        </ToolBoundary>
      </div>
    </div>
  );
}

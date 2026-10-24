// The Math solvers window: a tab for each solver, each with its inputs, the answer, a graph, and the worked steps.
// The tabs follow the ARIA tabs pattern: arrow keys move between them, Home and End go to the ends, and only the
// chosen tab is in the Tab order.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { EquationsPanel, IntegralsPanel, SeriesPanel } from './CalculusPanels';
import { ErrorsPanel, RootsPanel, TransformsPanel } from './AppliedPanels';
import { MatricesPanel, ProbabilityPanel, ProjectilePanel } from './StatsPanels';
import { say } from './parts';
import { SOLVER_TABS, chooseTab, onTab, storedTab, type SolverTab } from './state';
import styles from './solvers.module.css';

const PANELS: Record<SolverTab, () => React.JSX.Element> = {
  integrals: IntegralsPanel,
  equations: EquationsPanel,
  transforms: TransformsPanel,
  series: SeriesPanel,
  roots: RootsPanel,
  errors: ErrorsPanel,
  probability: ProbabilityPanel,
  matrices: MatricesPanel,
  projectile: ProjectilePanel,
};

export function SolversTool() {
  const [tab, setTab] = useState<SolverTab>(storedTab);
  const tabs = useRef<Partial<Record<SolverTab, HTMLButtonElement | null>>>({});
  useEffect(() => onTab(setTab), []);
  const pick = (next: SolverTab, focus = false) => {
    chooseTab(next);
    if (focus) tabs.current[next]?.focus();
  };
  const keys = (event: KeyboardEvent) => {
    const at = SOLVER_TABS.indexOf(tab);
    const moves: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: SOLVER_TABS.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    pick(SOLVER_TABS[(moves[event.key] + SOLVER_TABS.length) % SOLVER_TABS.length], true);
  };
  const Panel = PANELS[tab];
  return (
    <div className={styles.tool}>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={say('solvers.title')}
        aria-orientation="horizontal"
        onKeyDown={keys}
      >
        {SOLVER_TABS.map((id) => (
          <button
            key={id}
            ref={(node) => {
              tabs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={`solvers-tab-${id}`}
            aria-selected={id === tab}
            aria-controls="solvers-panel"
            tabIndex={id === tab ? 0 : -1}
            className={styles.tab}
            onClick={() => pick(id)}
          >
            {say(`solvers.tab.${id}`)}
          </button>
        ))}
      </div>
      <div id="solvers-panel" role="tabpanel" aria-labelledby={`solvers-tab-${tab}`} className={styles.body}>
        <Panel key={tab} />
      </div>
    </div>
  );
}

// The bottom panel (DESIGN 5.1): Console, Problems, Tests, Debug, and Files (written by the program), as tabs.
// Its top edge drags to resize it (also with the arrow keys), and it collapses to its tab row.
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, IconButton } from '../../../ui';
import { ConsolePanel } from '../console/ConsolePanel';
import { countProblems } from '../problems/group';
import { ProblemsPanel } from '../problems/ProblemsPanel';
import type { PanelTab, StudioController } from './controller';
import styles from './studio.module.css';

const TABS: readonly { id: PanelTab; title: MessageKey }[] = [
  { id: 'console', title: 'codeStudio.studio.panel.console' },
  { id: 'problems', title: 'codeStudio.studio.panel.problems' },
  { id: 'tests', title: 'codeStudio.studio.panel.tests' },
  { id: 'debug', title: 'codeStudio.studio.panel.debug' },
  { id: 'files', title: 'codeStudio.studio.panel.files' },
];

const MIN_HEIGHT = 96;
const MAX_HEIGHT = 640;
const STEP = 24;

function TestsPanel({ controller }: { controller: StudioController }) {
  const project = controller.project()!;
  const cases = Object.values(project.tests).sort((a, b) => a.order - b.order);
  const results = new Map(controller.testResults.map((result) => [result.id, result]));
  const extra = controller.testResults.filter((result) => !project.tests[result.id]);
  if (cases.length === 0 && extra.length === 0)
    return <p className={styles.empty}>{t('codeStudio.studio.tests.none')}</p>;
  const passed = controller.testResults.filter((result) => result.status === 'pass').length;
  return (
    <div className={styles.testsPanel}>
      {controller.testResults.length > 0 && (
        <p role="status">{t('codeStudio.studio.tests.summary', { passed, total: controller.testResults.length })}</p>
      )}
      <ul className={styles.testList}>
        {[...cases.map((one) => ({ id: one.id, name: one.name })), ...extra].map((one) => {
          const result = results.get(one.id);
          return (
            <li key={one.id} data-status={result?.status ?? 'notRun'}>
              <span className={styles.testStatus}>
                {t(`codeStudio.studio.tests.status.${result?.status ?? 'notRun'}` as MessageKey)}
              </span>
              <span>{one.name}</span>
              {result?.message && <span className={styles.testMessage}>{result.message}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WrittenFiles({ controller }: { controller: StudioController }) {
  if (controller.written.length === 0) return <p className={styles.empty}>{t('codeStudio.studio.written.none')}</p>;
  return (
    <div className={styles.written}>
      <p className={styles.help}>{t('codeStudio.studio.written.help')}</p>
      {controller.written.map((file) => (
        <details key={file.path}>
          <summary>{file.path}</summary>
          <pre className={styles.writtenText}>{file.text}</pre>
        </details>
      ))}
    </div>
  );
}

function Body({ controller }: { controller: StudioController }) {
  switch (controller.panel) {
    case 'console':
      return <ConsolePanel controller={controller} />;
    case 'problems':
      return <ProblemsPanel controller={controller} />;
    case 'tests':
      return <TestsPanel controller={controller} />;
    case 'debug':
      // The debugger (code:L14a, R2) draws into this panel.
      return (
        <p className={styles.empty} data-debug-host="">
          {t('codeStudio.studio.debugLater')}
        </p>
      );
    case 'files':
      return <WrittenFiles controller={controller} />;
  }
}

export function BottomPanel({ controller }: { controller: StudioController }) {
  const [height, setHeight] = useState(220);
  const [open, setOpen] = useState(true);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const base = useId();
  const problems = countProblems(controller.problems());
  const resize = (next: number) => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next)));
  return (
    <section className={styles.panel} aria-label={t('codeStudio.studio.panel.label')}>
      {open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('codeStudio.studio.panel.resize')}
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={MAX_HEIGHT}
          aria-valuenow={height}
          tabIndex={0}
          className={styles.grip}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { y: event.clientY, height };
          }}
          onPointerMove={(event) => {
            if (drag.current) resize(drag.current.height + drag.current.y - event.clientY);
          }}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') resize(height + STEP);
            else if (event.key === 'ArrowDown') resize(height - STEP);
            else return;
            event.preventDefault();
          }}
        />
      )}
      <div className={styles.panelTabs}>
        <div role="tablist" aria-label={t('codeStudio.studio.panel.label')}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${base}-${tab.id}`}
              aria-selected={controller.panel === tab.id}
              aria-controls={`${base}-body`}
              tabIndex={controller.panel === tab.id ? 0 : -1}
              className={styles.panelTab}
              onClick={() => {
                controller.showPanel(tab.id);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                const at = TABS.findIndex((one) => one.id === controller.panel);
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = TABS[(at + step + TABS.length) % TABS.length]!;
                controller.showPanel(next.id);
                document.getElementById(`${base}-${next.id}`)?.focus();
              }}
            >
              {t(tab.title)}
              {tab.id === 'problems' && problems.errors + problems.warnings > 0 && (
                <span className={styles.count}>{problems.errors + problems.warnings}</span>
              )}
            </button>
          ))}
        </div>
        <IconButton
          label={t(open ? 'codeStudio.studio.panel.collapse' : 'codeStudio.studio.panel.expand')}
          icon={open ? CaretDown : CaretUp}
          onPress={() => setOpen(!open)}
        />
        {controller.panel === 'tests' && (
          <Button variant="quiet" disabled={controller.running} onClick={() => controller.run(true)}>
            {t('codeStudio.studio.toolbar.runTests')}
          </Button>
        )}
      </div>
      {open && (
        <div
          id={`${base}-body`}
          role="tabpanel"
          aria-labelledby={`${base}-${controller.panel}`}
          className={styles.panelBody}
          style={{ blockSize: `${height}px` }}
        >
          <Body controller={controller} />
        </div>
      )}
    </section>
  );
}

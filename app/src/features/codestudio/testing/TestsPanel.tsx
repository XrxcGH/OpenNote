// The Tests panel (DESIGN 9.2). It shows the cases and the tests found in the code as a tree. Each result has a
// text label as well as an icon. It has Run all, Run one, Run failed, and the case editor. A failed test shows the
// difference between the expected and the actual output, and a test that ran out of time says so.
import { CheckCircle, Circle, Clock, Pencil, Play, Plus, WarningCircle, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, IconButton, announce } from '../../../ui';
import { TEST_DEFAULTS } from '../contracts';
import type { CodeProject, TestCase, TestResult, TestStatus } from '../contracts';
import { nextId } from '../project/model';
import type { StudioController } from '../window/controller';
import { CaseEditor, caseOf, draftOf } from './CaseEditor';
import type { Draft } from './CaseEditor';
import { diffLines, firstDifferentToken } from './diff';
import { CALL_RUNTIMES } from './harness';
import { firstDifferentLine } from './compare';
import { installTestingHooks } from './testHooks';
import styles from './testing.module.css';

installTestingHooks();

const ICONS = {
  pass: CheckCircle,
  fail: XCircle,
  error: WarningCircle,
  time: Clock,
  skipped: Circle,
  notRun: Circle,
} as const;

type Shown = TestStatus | 'notRun';
const FAILED: readonly TestStatus[] = ['fail', 'error', 'time'];

export const statusText = (status: Shown) => t(`codeStudio.studio.tests.status.${status}` as MessageKey);

/** The group a framework test is shown under: its class or its describe block. */
function groupOf(name: string): string {
  if (name.includes(' > ')) return name.split(' > ')[0]!;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : '';
}

interface Row {
  id: string;
  name: string;
  /** The stored case, when this row is one. */
  test?: TestCase;
  result?: TestResult;
}

function Diff({ result }: { result: TestResult }) {
  const expected = result.expected ?? '';
  const actual = result.actual ?? '';
  const rows = diffLines(expected, actual);
  const token = expected.includes('\n') || actual.includes('\n') ? null : firstDifferentToken(expected, actual);
  const line = firstDifferentLine(actual, expected);
  return (
    <div className={styles.diff}>
      <p className={styles.help}>
        {token
          ? t('codeStudio.testing.firstToken', { at: token.at, expected: token.expected, actual: token.actual })
          : line !== null
            ? t('codeStudio.testing.firstLine', { line })
            : ''}
      </p>
      <pre aria-label={t('codeStudio.testing.diffLabel')} className={styles.diffText}>
        {rows.map((row, at) => (
          <span key={at} className={styles.diffRow} data-side={row.side}>
            <span className={styles.diffSide}>
              {t(
                row.side === 'same'
                  ? 'codeStudio.testing.sideSame'
                  : row.side === 'expected'
                    ? 'codeStudio.testing.sideExpected'
                    : 'codeStudio.testing.sideActual',
              )}
            </span>
            {row.text === '' ? t('codeStudio.testing.nothing') : row.text}
          </span>
        ))}
      </pre>
    </div>
  );
}

function Details({
  controller,
  result,
  limitSeconds,
}: {
  controller: StudioController;
  result: TestResult;
  limitSeconds: number;
}) {
  return (
    <div className={styles.details} role="group" aria-label={t('codeStudio.testing.details', { name: result.name })}>
      {result.status === 'time' && <p>{t('codeStudio.testing.timeLimitShown', { seconds: limitSeconds })}</p>}
      {result.message && <p className={styles.message}>{result.message}</p>}
      {result.location && (
        <Button variant="quiet" onClick={() => controller.openPath(result.location!.file, result.location!.line)}>
          {t('codeStudio.testing.openLocation', { file: result.location.file, line: result.location.line })}
        </Button>
      )}
      {result.status === 'fail' && result.expected !== undefined && result.actual !== undefined && (
        <Diff result={result} />
      )}
    </div>
  );
}

function TestRow({
  row,
  open,
  busy,
  limitSeconds,
  controller,
  onToggle,
  onEdit,
}: {
  row: Row;
  open: boolean;
  busy: boolean;
  limitSeconds: number;
  controller: StudioController;
  onToggle(): void;
  onEdit?(): void;
}) {
  const status: Shown = row.result?.status ?? 'notRun';
  const Icon = ICONS[status];
  const canOpen = Boolean(
    row.result && (row.result.message || row.result.expected !== undefined || row.result.location),
  );
  return (
    <li data-status={status} className={styles.item}>
      <div className={styles.line}>
        <Icon aria-hidden="true" size={18} weight="bold" className={styles.icon} />
        <span className={styles.status}>{statusText(status)}</span>
        <button
          type="button"
          className={styles.name}
          aria-expanded={canOpen ? open : undefined}
          disabled={!canOpen}
          onClick={onToggle}
        >
          {row.name}
        </button>
        {row.result && <span className={styles.time}>{t('codeStudio.testing.time', { ms: row.result.timeMs })}</span>}
        <IconButton
          label={t('codeStudio.testing.runOne', { name: row.name })}
          icon={Play}
          disabled={busy}
          onPress={() => controller.run({ ids: [row.id], framework: !row.test })}
        />
        {onEdit && (
          <IconButton label={t('codeStudio.testing.edit', { name: row.name })} icon={Pencil} onPress={onEdit} />
        )}
      </div>
      {open && row.result && <Details controller={controller} result={row.result} limitSeconds={limitSeconds} />}
    </li>
  );
}

const canCall = (project: CodeProject) => CALL_RUNTIMES.includes(project.runtime);

interface Editing {
  id: string | null;
  draft: Draft;
}

/** The case editor's state and its three actions: open one, save, and delete. */
function useCaseEditing(controller: StudioController, project: CodeProject, cases: TestCase[]) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const edit = (test: TestCase | null) => setEditing({ id: test?.id ?? null, draft: draftOf(test, cases.length + 1) });
  const save = () => {
    if (!editing) return;
    const id = editing.id ?? nextId('t', project.tests);
    const next = cases.reduce((max, one) => Math.max(max, one.order + 1), 0);
    const test = caseOf(editing.draft, id, editing.id ? (project.tests[id]?.order ?? 0) : next);
    if (!controller.setTest(id, test)) return;
    announce(t('codeStudio.testing.editor.saved', { name: test.name }));
    setEditing(null);
  };
  const remove = () => {
    if (!editing?.id) return;
    const name = project.tests[editing.id]?.name ?? '';
    if (!controller.setTest(editing.id, null)) return;
    announce(t('codeStudio.testing.editor.deleted', { name }));
    setEditing(null);
  };
  return { editing, setEditing, edit, save, remove };
}

interface BarProps {
  controller: StudioController;
  project: CodeProject;
  hasTests: boolean;
  onAdd?: () => void;
}

function Bar({ controller, project, hasTests, onAdd }: BarProps) {
  const total = controller.testResults.length;
  const failedIds = controller.testResults.filter((one) => FAILED.includes(one.status)).map((one) => one.id);
  const passed = controller.testResults.filter((one) => one.status === 'pass').length;
  const busy = controller.running;
  const failed = failedIds.length;
  return (
    <div className={styles.bar}>
      <Button variant="secondary" disabled={busy || !hasTests} onClick={() => controller.run(true)}>
        {t('codeStudio.testing.runAll')}
      </Button>
      <Button
        variant="secondary"
        disabled={busy || failed === 0}
        onClick={() => controller.run({ ids: failedIds, framework: failedIds.some((id) => !project.tests[id]) })}
      >
        {t('codeStudio.testing.runFailed')}
      </Button>
      {onAdd && (
        <Button variant="quiet" disabled={busy} onClick={onAdd}>
          <Plus aria-hidden="true" size={16} weight="bold" /> {t('codeStudio.testing.add')}
        </Button>
      )}
      {total > 0 && (
        <p role="status" className={styles.summary}>
          {failed > 0
            ? t('codeStudio.testing.summaryFailed', { passed, total, failed })
            : t('codeStudio.testing.summary', { passed, total })}
        </p>
      )}
    </div>
  );
}

/** Framework results grouped by class or describe block, in the order they came. */
function groupFound(found: TestResult[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const result of found) {
    const key = groupOf(result.name);
    groups.set(key, [...(groups.get(key) ?? []), { id: result.id, name: result.name, result }]);
  }
  return groups;
}

export function TestsPanel({ controller }: { controller: StudioController }) {
  const project = controller.project()!;
  const [open, setOpen] = useState<string | null>(null);
  const editable = controller.store?.editable ?? false;
  const cases = Object.values(project.tests).sort((a, b) => a.order - b.order);
  const { editing, setEditing, edit, save, remove } = useCaseEditing(controller, project, cases);
  const results = new Map(controller.testResults.map((result) => [result.id, result]));
  const found = controller.testResults.filter((result) => !project.tests[result.id]);
  const rows: Row[] = cases.map((test) => ({ id: test.id, name: test.name, test, result: results.get(test.id) }));

  const list = (items: Row[]) => (
    <ul className={styles.list}>
      {items.map((row) => (
        <TestRow
          key={row.id}
          row={row}
          open={open === row.id}
          busy={controller.running}
          limitSeconds={(row.test?.timeMs ?? TEST_DEFAULTS.timeMs) / 1000}
          controller={controller}
          onToggle={() => setOpen(open === row.id ? null : row.id)}
          {...(row.test && editable ? { onEdit: () => edit(row.test!) } : {})}
        />
      ))}
    </ul>
  );

  return (
    <div className={styles.panel}>
      <Bar
        controller={controller}
        project={project}
        hasTests={rows.length + found.length > 0}
        {...(editable ? { onAdd: () => edit(null) } : {})}
      />
      {editing && (
        <CaseEditor
          draft={editing.draft}
          existing={editing.id !== null}
          canCall={canCall(project)}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onSave={save}
          onCancel={() => setEditing(null)}
          onDelete={remove}
        />
      )}
      {rows.length === 0 && found.length === 0 && !editing && (
        <p className={styles.empty}>{t('codeStudio.testing.empty')}</p>
      )}
      {rows.length > 0 && (
        <section aria-label={t('codeStudio.testing.groupCases')}>
          <h3 className={styles.group}>{t('codeStudio.testing.groupCases')}</h3>
          {list(rows)}
        </section>
      )}
      {found.length > 0 && (
        <section aria-label={t('codeStudio.testing.groupFramework')}>
          <h3 className={styles.group}>{t('codeStudio.testing.groupFramework')}</h3>
          {[...groupFound(found)].map(([name, items]) => (
            <div key={name} role="group" aria-label={name || undefined}>
              {name && <h4 className={styles.subgroup}>{name}</h4>}
              {list(items)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

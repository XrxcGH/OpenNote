// Check notebook (docs/FEATURES.md, "Check notebook"): reads the notebook with the core and lists each problem in
// plain words with a repair. Nothing changes until a repair is picked. A damaged page comes back from its history,
// a damaged or missing file from the newest backup, and a page.md that doesn't match its page is written again
// (A2-2); each of those repairs has Undo in the dialog. A problem in the tree's own files is repaired by scanning
// the notebook again, a link that leads nowhere opens its page to fix by hand, and the search index can be rebuilt.

import { useCallback, useEffect, useState } from 'react';
import { navigate } from '../../app/location';
import { shellCall } from '../../platform/shellqol';
import type { NodeSummary } from '../../services/notes';
import { t } from '../../strings/t';
import { Button, Dialog, showToast } from '../../ui';
import { showDialog } from './dialogHost';
import { categoryOf } from './checkCategories';
import type { Category } from './checkCategories';
import styles from './Check.module.css';

interface Problem {
  readonly path: string;
  readonly code: string;
  readonly detail: string;
  readonly pageId: string | null;
}

interface Report {
  readonly files: number;
  readonly problems: readonly Problem[];
}

type Phase = { state: 'checking' } | { state: 'failed' } | { state: 'ready'; report: Report };

/** A repair the core runs on one file (shellqol/repairs.rs). */
export type RepairKind = 'pageMd' | 'pageFromHistory' | 'fromBackup';

/** A repair that ran, which Undo can take back. */
interface Done {
  readonly token: number;
  readonly path: string;
}

/** The repairs a problem offers, best first. */
export function repairsFor(problem: Pick<Problem, 'code' | 'path'>, category: Category): RepairKind[] {
  if (category === 'readable') return ['pageMd'];
  if (category === 'tree' || category === 'links' || category === 'other') return [];
  const parts = problem.path.split(/[\\/]/);
  if (problem.code === 'page.invalid' && parts.at(-1) === 'page.json') return ['pageFromHistory', 'fromBackup'];
  return problem.path && !parts.includes('.history') ? ['fromBackup'] : [];
}

const REPAIR_LABEL = {
  pageMd: 'storage.check.writeAgain',
  pageFromHistory: 'storage.check.fromHistory',
  fromBackup: 'storage.check.fromBackup',
} as const;

function categoryText(category: Category): string {
  if (category === 'links') return t('storage.check.links');
  if (category === 'readable') return t('storage.check.readable');
  return t(`qol.check.categories.${category}`);
}

function CheckContent({ book, done }: { book: NodeSummary; done(): void }) {
  const [phase, setPhase] = useState<Phase>({ state: 'checking' });
  const load = useCallback(() => {
    shellCall<Report | null>('library.check', { id: book.id }).then(
      (report) => setPhase(report ? { state: 'ready', report } : { state: 'failed' }),
      () => setPhase({ state: 'failed' }),
    );
  }, [book.id]);
  const run = () => {
    setPhase({ state: 'checking' });
    load();
  };
  useEffect(load, [load]);
  const [repaired, setRepaired] = useState<readonly Done[]>([]);
  const repair = async (problem: Problem, kind: RepairKind) => {
    try {
      const { token } = await shellCall<{ token: number }>('check.repair', { id: book.id, kind, path: problem.path });
      setRepaired((list) => [...list, { token, path: problem.path }]);
      showToast({ message: t('storage.check.repaired', { path: problem.path }) });
      run();
    } catch {
      showToast({ message: t('storage.check.failed', { path: problem.path }), tone: 'danger' });
    }
  };
  const undo = async (item: Done) => {
    try {
      await shellCall('check.undo', { token: item.token });
      setRepaired((list) => list.filter((other) => other.token !== item.token));
      showToast({ message: t('storage.check.undone', { path: item.path }) });
      run();
    } catch {
      showToast({ message: t('storage.check.undoFailed', { path: item.path }), tone: 'danger' });
    }
  };
  const rescan = async () => {
    try {
      await shellCall('library.rescan', { id: book.id });
      showToast({ message: t('qol.check.rescanned') });
      run();
    } catch {
      showToast({ message: t('qol.check.rescanFailed'), tone: 'danger' });
    }
  };
  const rebuild = async () => {
    try {
      await shellCall('library.rebuildIndex');
      showToast({ message: t('qol.check.rebuilt') });
    } catch {
      showToast({ message: t('qol.check.rebuildFailed'), tone: 'danger' });
    }
  };
  const openPage = (pageId: string) => {
    done();
    navigate({ view: 'workspace', notebookId: book.id, sectionId: null, pageId: pageId as never });
  };
  const problems = phase.state === 'ready' ? phase.report.problems : [];
  const description =
    phase.state === 'checking'
      ? t('qol.check.checking', { title: book.title })
      : phase.state === 'failed'
        ? t('qol.check.failed')
        : problems.length === 0
          ? t('qol.check.clean', { count: phase.report.files })
          : t('qol.check.found', { count: problems.length });
  return (
    <Dialog
      title={t('qol.check.dialogTitle', { title: book.title })}
      description={description}
      size="large"
      onDismiss={done}
      actions={[
        { id: 'index', label: t('qol.check.rebuildIndex'), variant: 'secondary', onPress: rebuild },
        { id: 'again', label: t('qol.check.again'), variant: 'secondary', onPress: run },
        { id: 'close', label: t('common.close'), variant: 'primary', onPress: done },
      ]}
    >
      {repaired.length > 0 && (
        <ul className={styles.problems} aria-label={t('storage.check.undo')}>
          {repaired.map((item) => (
            <li key={item.token} className={styles.problem}>
              <p>{t('storage.check.repaired', { path: item.path })}</p>
              <div className={styles.fixes}>
                <Button aria-label={t('storage.check.undoLabel', { path: item.path })} onClick={() => void undo(item)}>
                  {t('storage.check.undo')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ul className={styles.problems}>
        {problems.map((problem, index) => {
          const category: Category = categoryOf(problem.code);
          const kinds = repairsFor(problem, category);
          return (
            <li key={`${problem.path}:${problem.code}:${index}`} className={styles.problem}>
              <p>{categoryText(category)}</p>
              <p className={styles.path}>{problem.path}</p>
              <div className={styles.fixes}>
                {category === 'tree' ? (
                  <Button onClick={() => void rescan()}>{t('qol.check.fixRescan')}</Button>
                ) : kinds.length > 0 ? (
                  kinds.map((kind) => (
                    <Button key={kind} onClick={() => void repair(problem, kind)}>
                      {t(REPAIR_LABEL[kind])}
                    </Button>
                  ))
                ) : problem.pageId ? (
                  <Button onClick={() => openPage(problem.pageId as string)}>
                    {category === 'links' ? t('storage.check.openPage') : t('qol.check.fixHistory')}
                  </Button>
                ) : (
                  <span className={styles.hint}>{t('qol.check.fixBackup')}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

export function openNotebookCheck(book: NodeSummary): Promise<void> {
  return showDialog<void>((done) => <CheckContent book={book} done={() => done()} />);
}

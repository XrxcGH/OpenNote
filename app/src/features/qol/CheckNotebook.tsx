// Check notebook (docs/FEATURES.md, "Check notebook"): reads the notebook with the core and lists each problem in
// plain words with a repair. Nothing changes until a repair is picked. A damaged or missing file is repaired from
// the page history or a backup, which the report points to; a problem in the tree's own files is repaired by
// scanning the notebook again; and the search index can be rebuilt at any time.

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
      <ul className={styles.problems}>
        {problems.map((problem, index) => {
          const category: Category = categoryOf(problem.code);
          return (
            <li key={`${problem.path}:${problem.code}:${index}`} className={styles.problem}>
              <p>{t(`qol.check.categories.${category}`)}</p>
              <p className={styles.path}>{problem.path}</p>
              <div className={styles.fixes}>
                {category === 'tree' ? (
                  <Button onClick={() => void rescan()}>{t('qol.check.fixRescan')}</Button>
                ) : problem.pageId ? (
                  <Button onClick={() => openPage(problem.pageId as string)}>{t('qol.check.fixHistory')}</Button>
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

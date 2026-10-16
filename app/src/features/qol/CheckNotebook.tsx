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

async function attempt(call: () => Promise<unknown>, ok: string, failed: string): Promise<boolean> {
  try {
    await call();
    showToast({ message: ok });
    return true;
  } catch {
    showToast({ message: failed, tone: 'danger' });
    return false;
  }
}

/** The repairs and their Undo, each followed by a fresh check through `run`. */
function useRepairs(book: NodeSummary, run: () => void) {
  const [repaired, setRepaired] = useState<readonly Done[]>([]);
  const repair = async (problem: Problem, kind: RepairKind) => {
    const { path } = problem;
    let token = 0;
    const call = async () => {
      ({ token } = await shellCall<{ token: number }>('check.repair', { id: book.id, kind, path }));
    };
    if (await attempt(call, t('storage.check.repaired', { path }), t('storage.check.failed', { path }))) {
      setRepaired((list) => [...list, { token, path }]);
      run();
    }
  };
  const undo = async (item: Done) => {
    const { path } = item;
    const call = () => shellCall('check.undo', { token: item.token });
    if (await attempt(call, t('storage.check.undone', { path }), t('storage.check.undoFailed', { path }))) {
      setRepaired((list) => list.filter((other) => other.token !== item.token));
      run();
    }
  };
  const rescan = async () => {
    const call = () => shellCall('library.rescan', { id: book.id });
    if (await attempt(call, t('qol.check.rescanned'), t('qol.check.rescanFailed'))) run();
  };
  return { repaired, repair, undo, rescan };
}

function describe(phase: Phase, title: string): string {
  if (phase.state === 'checking') return t('qol.check.checking', { title });
  if (phase.state === 'failed') return t('qol.check.failed');
  const count = phase.report.problems.length;
  return count === 0 ? t('qol.check.clean', { count: phase.report.files }) : t('qol.check.found', { count });
}

function RepairedList({ repaired, undo }: { repaired: readonly Done[]; undo(item: Done): void }) {
  if (repaired.length === 0) return null;
  return (
    <ul className={styles.problems} aria-label={t('storage.check.undo')}>
      {repaired.map((item) => (
        <li key={item.token} className={styles.problem}>
          <p>{t('storage.check.repaired', { path: item.path })}</p>
          <div className={styles.fixes}>
            <Button aria-label={t('storage.check.undoLabel', { path: item.path })} onClick={() => undo(item)}>
              {t('storage.check.undo')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

interface FixProps {
  problem: Problem;
  repair(problem: Problem, kind: RepairKind): void;
  rescan(): void;
  openPage(pageId: string): void;
}

function Fix({ problem, repair, rescan, openPage }: FixProps) {
  const category: Category = categoryOf(problem.code);
  const kinds = repairsFor(problem, category);
  if (category === 'tree') return <Button onClick={rescan}>{t('qol.check.fixRescan')}</Button>;
  if (kinds.length > 0) {
    return (
      <>
        {kinds.map((kind) => (
          <Button key={kind} onClick={() => repair(problem, kind)}>
            {t(REPAIR_LABEL[kind])}
          </Button>
        ))}
      </>
    );
  }
  if (!problem.pageId) return <span className={styles.hint}>{t('qol.check.fixBackup')}</span>;
  const page = problem.pageId;
  return (
    <Button onClick={() => openPage(page)}>
      {category === 'links' ? t('storage.check.openPage') : t('qol.check.fixHistory')}
    </Button>
  );
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
  const { repaired, repair, undo, rescan } = useRepairs(book, run);
  const rebuild = () =>
    void attempt(() => shellCall('library.rebuildIndex'), t('qol.check.rebuilt'), t('qol.check.rebuildFailed'));
  const openPage = (pageId: string) => {
    done();
    navigate({ view: 'workspace', notebookId: book.id, sectionId: null, pageId: pageId as never });
  };
  const problems = phase.state === 'ready' ? phase.report.problems : [];
  return (
    <Dialog
      title={t('qol.check.dialogTitle', { title: book.title })}
      description={describe(phase, book.title)}
      size="large"
      onDismiss={done}
      actions={[
        { id: 'index', label: t('qol.check.rebuildIndex'), variant: 'secondary', onPress: rebuild },
        { id: 'again', label: t('qol.check.again'), variant: 'secondary', onPress: run },
        { id: 'close', label: t('common.close'), variant: 'primary', onPress: done },
      ]}
    >
      <RepairedList repaired={repaired} undo={(item) => void undo(item)} />
      <ul className={styles.problems}>
        {problems.map((problem, index) => (
          <li key={`${problem.path}:${problem.code}:${index}`} className={styles.problem}>
            <p>{categoryText(categoryOf(problem.code))}</p>
            <p className={styles.path}>{problem.path}</p>
            <div className={styles.fixes}>
              <Fix
                problem={problem}
                repair={(p, kind) => void repair(p, kind)}
                rescan={() => void rescan()}
                openPage={openPage}
              />
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function openNotebookCheck(book: NodeSummary): Promise<void> {
  return showDialog<void>((done) => <CheckContent book={book} done={() => done()} />);
}

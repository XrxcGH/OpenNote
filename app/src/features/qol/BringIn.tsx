// Text edited in another app (A2-1): when someone edits a page's page.md elsewhere, OpenNote keeps that file aside
// (the shell's folder watcher, shellqol/external.rs) and offers to bring its text in. The preview lists the changes,
// and "Bring in" sends the core's edits as one request, so one Undo takes them all back. Nothing changes before.
// Files only in the cloud (A4-15) download before the page's pictures and recordings are needed, with progress.

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Edit } from '../../services/pages/types';
import { shellCall, shellHost } from '../../platform/shellqol';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce, Button, Dialog, ProgressBar, showToast } from '../../ui';
import { shownQueue } from '../page';
import { externalStore } from './externalStore';
import styles from './QolPage.module.css';

export interface EditedCopy {
  readonly copy: string;
  readonly keptAt: string | null;
}

export type PlannedChange =
  | { readonly kind: 'replace'; readonly block: string; readonly markdown: string }
  | { readonly kind: 'insert'; readonly markdown: string }
  | { readonly kind: 'remove'; readonly block: string };

export interface EditPlan {
  readonly copy: string;
  readonly baseKnown: boolean;
  readonly title: string | null;
  readonly tags: readonly string[] | null;
  readonly changes: readonly PlannedChange[];
  readonly conflicts: number;
  readonly skipped: number;
  readonly tooDifferent: boolean;
  readonly edits: readonly Edit[];
}

/** The most changes the preview lists; the rest are counted. */
export const PREVIEW_LIMIT = 12;
const NONE: EditedCopy[] = [];

/** The edited copies of the page that wait to be brought in, read again when the watcher reports and on focus. */
export function useEditedCopies(pageId: string | null, enabled: boolean): EditedCopy[] {
  const tick = useStore(externalStore, (state) => state.tick);
  const [read, setRead] = useState<{ pageId: string; items: EditedCopy[] } | null>(null);
  useEffect(() => {
    if (!pageId || !enabled) return undefined;
    let current = true;
    const load = () =>
      void shellCall<EditedCopy[] | null>('edits.list', { pageId }).then(
        (list) => current && setRead({ pageId, items: Array.isArray(list) ? list : [] }),
        () => current && setRead({ pageId, items: [] }),
      );
    load();
    // The page may still be opening when the first read comes.
    const later = setTimeout(load, 800);
    window.addEventListener('focus', load);
    return () => {
      current = false;
      clearTimeout(later);
      window.removeEventListener('focus', load);
    };
  }, [pageId, enabled, tick]);
  return pageId && enabled && read?.pageId === pageId ? read.items : NONE;
}

/** A short one-line preview of Markdown. */
function preview(markdown: string): string {
  const line = markdown.replace(/\s+/g, ' ').trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

function describe(change: PlannedChange): string {
  if (change.kind === 'remove') return t('storage.edits.remove');
  const text = preview(change.markdown);
  return change.kind === 'replace' ? t('storage.edits.replace', { text }) : t('storage.edits.insert', { text });
}

function PlanList({ plan }: { plan: EditPlan }) {
  const lines: string[] = [];
  if (plan.title !== null) lines.push(t('storage.edits.newTitle', { title: plan.title }));
  if (plan.tags !== null) lines.push(t('storage.edits.newTags', { tags: plan.tags.join(', ') }));
  lines.push(...plan.changes.slice(0, PREVIEW_LIMIT).map(describe));
  const more = plan.changes.length - PREVIEW_LIMIT;
  return (
    <>
      {lines.length > 0 ? (
        <ul className={styles.planList} aria-label={t('storage.edits.title')}>
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>{t('storage.edits.nothing')}</p>
      )}
      {more > 0 && <p>{t('storage.edits.more', { count: more })}</p>}
      {plan.tooDifferent && <p>{t('storage.edits.tooDifferent')}</p>}
      {plan.conflicts > 0 && <p>{t('storage.edits.conflicts', { count: plan.conflicts })}</p>}
      {plan.skipped > 0 && <p>{t('storage.edits.skipped', { count: plan.skipped })}</p>}
      {!plan.baseKnown && <p>{t('storage.edits.baseUnknown')}</p>}
    </>
  );
}

type Answer = 'apply' | 'discard' | null;

function BringInDialog({ plan, onAnswer }: { plan: EditPlan; onAnswer(answer: Answer): void }) {
  const empty = plan.edits.length === 0;
  return (
    <Dialog
      title={t('storage.edits.title')}
      description={t('storage.edits.intro')}
      size="medium"
      initialFocus="leastDestructive"
      onDismiss={() => onAnswer(null)}
      actions={[
        { id: 'discard', label: t('storage.edits.discard'), variant: 'quiet', onPress: () => onAnswer('discard') },
        {
          id: 'cancel',
          label: t('storage.edits.cancel'),
          variant: 'secondary',
          leastDestructive: true,
          onPress: () => onAnswer(null),
        },
        ...(empty
          ? []
          : [
              {
                id: 'apply',
                label: t('storage.edits.apply'),
                variant: 'primary' as const,
                onPress: () => onAnswer('apply'),
              },
            ]),
      ]}
    >
      <PlanList plan={plan} />
    </Dialog>
  );
}

function ask(plan: EditPlan): Promise<Answer> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const answer = (value: Answer) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(value);
    };
    root.render(<BringInDialog plan={plan} onAnswer={answer} />);
  });
}

/** Bumps the watcher tick, so the notice reads the copies again. */
function refresh(): void {
  externalStore.set((state) => ({ ...state, tick: state.tick + 1 }));
}

/**
 * Shows the preview for an edited copy, and brings its text in as one request when the person agrees. The page must
 * be the one shown, since its editors show the result. Returns true when the text came in.
 */
export async function bringIn(pageId: string, copy: string): Promise<boolean> {
  const plan = await shellCall<EditPlan | null>('edits.plan', { pageId, copy }).catch(() => null);
  if (!plan) {
    showToast({ message: t('storage.edits.failed'), tone: 'danger' });
    return false;
  }
  const answer = await ask(plan);
  if (answer === 'discard') {
    await shellCall('edits.discard', { pageId, copy }).catch(() => undefined);
    announce(t('storage.edits.discarded'));
    refresh();
    return false;
  }
  if (answer !== 'apply') return false;
  const queue = shownQueue.get();
  if (!queue) {
    showToast({ message: t('storage.edits.notShown') });
    return false;
  }
  try {
    await queue.sendAndShow({ edits: [...plan.edits] });
  } catch {
    showToast({ message: t('storage.edits.failed'), tone: 'danger' });
    return false;
  }
  await shellCall('edits.discard', { pageId, copy }).catch(() => undefined);
  announce(t('storage.edits.done'));
  refresh();
  return true;
}

type CloudState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'downloading'; readonly done: number; readonly total: number }
  | { readonly kind: 'failed'; readonly count: number }
  | { readonly kind: 'done' };

/** Downloads the page's files that are only in the cloud when it opens, with progress, or a warning if they can't. */
export function useCloudDownload(pageId: string | null, enabled: boolean): [CloudState, () => void] {
  const [state, setState] = useState<{ pageId: string; state: CloudState } | null>(null);
  useEffect(() => {
    if (!pageId || !enabled) return undefined;
    let current = true;
    const set = (next: CloudState) => current && setState({ pageId, state: next });
    const stop = shellHost().listen((event) => {
      if (event.kind !== 'cloudDownload' || event.pageId !== pageId) return;
      const done = typeof event.done === 'number' ? event.done : 0;
      const total = typeof event.total === 'number' ? event.total : 0;
      set({ kind: 'downloading', done, total });
    });
    const run = async () => {
      // The page opens first; its files are known once it has.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const found = await shellCall<{ count?: number } | null>('storage.cloudOnly', { pageId }).catch(() => null);
      const total = found?.count ?? 0;
      if (!current || total === 0) return;
      set({ kind: 'downloading', done: 0, total });
      const result = await shellCall<{ ok?: boolean; failed?: number } | null>('storage.download', { pageId }).catch(
        () => null,
      );
      if (result?.ok) {
        set({ kind: 'done' });
        announce(t('storage.cloud.done'));
      } else set({ kind: 'failed', count: result?.failed ?? total });
    };
    void run();
    return () => {
      current = false;
      stop();
    };
  }, [pageId, enabled]);
  const shown = pageId && enabled && state?.pageId === pageId ? state.state : ({ kind: 'idle' } as const);
  const dismiss = () => pageId && setState({ pageId, state: { kind: 'idle' } });
  return [shown, dismiss];
}

/** The cloud download notice above a page. */
export function CloudDownloadNotice({ state, onDismiss }: { state: CloudState; onDismiss(): void }) {
  if (state.kind === 'downloading') {
    return (
      <div className={styles.notice} role="status">
        <p>{t('storage.cloud.downloading', { total: state.total })}</p>
        <ProgressBar
          label={t('storage.cloud.progress', { done: state.done, total: state.total })}
          value={state.total > 0 ? Math.round((state.done / state.total) * 100) : undefined}
        />
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div className={styles.notice} role="alert">
        <p>{t('storage.cloud.failed', { count: state.count })}</p>
        <div className={styles.actions}>
          <Button variant="quiet" onClick={onDismiss}>
            {t('storage.cloud.dismiss')}
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

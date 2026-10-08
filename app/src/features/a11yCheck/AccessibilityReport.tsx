// The accessibility report: the problems of a page or of every page in a section, each with its fix. A fix is one
// edit to the page, so Ctrl+Z in the page undoes it. The report checks a page again after a fix.

import { useCallback, useEffect, useState } from 'react';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes';
import type { Edit, PageId } from '../../services/pages/types';
import { t } from '../../strings/t';
import { Button, Dialog, TextField, showToast } from '../../ui';
import { pagesClient, showDialog } from '../qol';
import { checkPage, imageAltEdits } from './check';
import type { Issue } from './check';
import styles from './A11y.module.css';

interface PageResult {
  readonly id: NodeId;
  readonly title: string;
  readonly issues: readonly Issue[];
}

/** Opens a page, runs `work` on it, and closes it. */
async function withPage<T>(
  id: NodeId,
  work: (page: Awaited<ReturnType<ReturnType<typeof pagesClient>['open']>>) => Promise<T>,
) {
  const page = await pagesClient().open(id as unknown as PageId, { viewport: null });
  try {
    return await work(page);
  } finally {
    await page.close();
  }
}

async function checkNode(node: NodeSummary): Promise<PageResult> {
  const issues = await withPage(node.id, async (page) => checkPage(page.initial));
  return { id: node.id, title: node.title.trim() || t('tree.untitled.page'), issues };
}

function IssueRow({ issue, onFix }: { issue: Issue; onFix(edits: readonly Edit[]): Promise<void> }) {
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (edits: readonly Edit[]) => {
    setBusy(true);
    try {
      await onFix(edits);
    } finally {
      setBusy(false);
    }
  };
  const message = t(`qol.a11y.issues.${issue.kind}`, issue.params as never);
  return (
    <li className={styles.issue}>
      <p>{message}</p>
      <div className={styles.fixes}>
        {issue.fix.kind === 'edits' && (
          <Button disabled={busy} onClick={() => void run(issue.fix.kind === 'edits' ? issue.fix.edits : [])}>
            {t(`qol.a11y.fixes.${issue.kind}`)}
          </Button>
        )}
        {issue.fix.kind === 'imageAlt' && (
          <>
            <TextField label={t('qol.a11y.altLabel')} value={alt} onChange={setAlt} />
            <Button
              disabled={busy || alt.trim() === ''}
              onClick={() => issue.fix.kind === 'imageAlt' && void run(imageAltEdits(issue.fix.block, alt, false))}
            >
              {t('qol.a11y.altApply')}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => issue.fix.kind === 'imageAlt' && void run(imageAltEdits(issue.fix.block, '', true))}
            >
              {t('qol.a11y.decorative')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function Report({ nodes, done }: { nodes: readonly NodeSummary[]; done(): void }) {
  const [results, setResults] = useState<PageResult[] | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      const found: PageResult[] = [];
      for (const node of nodes) {
        try {
          found.push(await checkNode(node));
        } catch {
          found.push({ id: node.id, title: node.title, issues: [] });
        }
      }
      if (current) setResults(found);
    })();
    return () => {
      current = false;
    };
  }, [nodes]);
  const fix = useCallback(
    async (result: PageResult, edits: readonly Edit[]) => {
      try {
        await withPage(result.id, (page) => page.send({ edits: [...edits] }));
        const node = nodes.find((one) => one.id === result.id);
        if (node) {
          const next = await checkNode(node);
          setResults((all) => all && all.map((one) => (one.id === next.id ? next : one)));
        }
      } catch {
        showToast({ message: t('qol.a11y.fixFailed'), tone: 'danger' });
      }
    },
    [nodes],
  );
  const total = results?.reduce((sum, result) => sum + result.issues.length, 0) ?? 0;
  return (
    <Dialog
      title={t('qol.a11y.title')}
      description={
        results === null
          ? t('qol.a11y.checking')
          : total === 0
            ? t('qol.a11y.none')
            : t('qol.a11y.summary', { count: total })
      }
      size="large"
      onDismiss={done}
      actions={[{ id: 'close', label: t('common.close'), variant: 'primary', onPress: done }]}
    >
      {results
        ?.filter((result) => result.issues.length > 0)
        .map((result) => (
          <section key={result.id} aria-label={result.title} className={styles.page}>
            <h3>{result.title}</h3>
            <ul className={styles.issues}>
              {result.issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onFix={(edits) => fix(result, edits)} />
              ))}
            </ul>
          </section>
        ))}
    </Dialog>
  );
}

/** Checks one page, or every page of a section. */
export async function openAccessibilityCheck(notes: NotesService, node: NodeSummary): Promise<void> {
  const pages =
    node.kind === 'page' ? [node] : (await notes.listChildren(node.id)).filter((child) => child.kind === 'page');
  await showDialog<void>((done) => <Report nodes={pages} done={() => done()} />);
}

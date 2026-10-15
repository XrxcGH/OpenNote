// Delete history (A2-3, A4-12) for a page, a section, or a notebook: the History panel, the tree's section and
// notebook menus, and the palette all come here. One question, with "Keep named versions" checked and Cancel
// focused first; the current pages never change. The shell's history_delete does the work (core_bridge/admin.rs).

import { useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { HistoryScope } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, Dialog } from '../../../ui';
import { historyAdmin } from './admin';
import styles from './history.module.css';

interface AskOptions {
  readonly name: string;
  readonly body: string;
}

function AskDialog({ name, body, onAnswer }: AskOptions & { onAnswer(keepNamed: boolean | null): void }) {
  const [keepNamed, setKeepNamed] = useState(true);
  const id = useId();
  return (
    <Dialog
      title={t('history.delete.title', { name })}
      description={body}
      initialFocus="leastDestructive"
      onDismiss={() => onAnswer(null)}
      actions={[
        {
          id: 'cancel',
          label: t('history.delete.cancel'),
          variant: 'secondary',
          leastDestructive: true,
          onPress: () => onAnswer(null),
        },
        { id: 'delete', label: t('history.delete.confirm'), variant: 'danger', onPress: () => onAnswer(keepNamed) },
      ]}
    >
      <p className={styles.keepNamed}>
        <input
          id={id}
          type="checkbox"
          checked={keepNamed}
          onChange={(event) => setKeepNamed(event.currentTarget.checked)}
        />
        <label htmlFor={id}>{t('history.delete.keepNamed')}</label>
      </p>
    </Dialog>
  );
}

/** Asks before deleting history. Resolves to the "Keep named versions" choice, or null when canceled. */
export function askDeleteHistory(options: AskOptions): Promise<boolean | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const answer = (keepNamed: boolean | null) => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(keepNamed);
    };
    root.render(<AskDialog {...options} onAnswer={answer} />);
  });
}

/** Whether Delete history can run here: the shell installed its admin. */
export function canDeleteHistory(): boolean {
  return historyAdmin() !== null;
}

/**
 * Deletes the history of a page, section, or notebook after asking. `name` is its title. Returns true when the
 * history was deleted.
 */
export async function deleteHistoryFor(scope: HistoryScope, name: string): Promise<boolean> {
  const admin = historyAdmin();
  if (!admin) return false;
  const body = scope.kind === 'page' ? t('history.delete.page') : t('history.delete.many');
  const keepNamed = await askDeleteHistory({ name, body });
  if (keepNamed === null) return false;
  const notebook = scope.kind === 'notebook' ? scope.id : (admin.notebookOf(scope.id) ?? '');
  try {
    await admin.deleteHistory(notebook, scope, keepNamed);
    announce(t('history.delete.done'));
    return true;
  } catch {
    announce(t('history.delete.failed'), 'assertive');
    return false;
  }
}

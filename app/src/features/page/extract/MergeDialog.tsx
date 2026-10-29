// The Merge pages dialog: the pages of the current section, each with a check box. The current page starts checked.
// It resolves the checked pages' IDs, or null when the person cancels.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { NodeId, NodeSummary } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import type { DialogAction } from '../../../ui';
import styles from '../qol/qol.module.css';

function Picker(props: { pages: readonly NodeSummary[]; current: NodeId; done(ids: NodeId[] | null): void }) {
  const { pages, current, done } = props;
  const [chosen, setChosen] = useState<ReadonlySet<NodeId>>(new Set([current]));
  const toggle = (id: NodeId) =>
    setChosen((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const actions: DialogAction[] = [
    {
      id: 'cancel',
      label: t('common.cancel'),
      variant: 'secondary',
      leastDestructive: true,
      onPress: () => done(null),
    },
    {
      id: 'merge',
      label: t('pageExtras.merge.action', { count: chosen.size }),
      variant: 'primary',
      onPress: () => done([...chosen]),
    },
  ];
  return (
    <Dialog
      title={t('pageExtras.merge.dialogTitle')}
      description={t('pageExtras.merge.dialogDescription')}
      actions={actions}
      onDismiss={() => done(null)}
    >
      <ul className={styles.pickList}>
        {pages.map((page) => (
          <li key={page.id}>
            <label className={styles.pickRow}>
              <input type="checkbox" checked={chosen.has(page.id)} onChange={() => toggle(page.id)} />
              {page.title.trim() || t('pageExtras.templates.untitled')}
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function pickPages(pages: readonly NodeSummary[], current: NodeId): Promise<NodeId[] | null> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = (ids: NodeId[] | null) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(ids);
    };
    root.render(<Picker pages={pages} current={current} done={done} />);
  });
}

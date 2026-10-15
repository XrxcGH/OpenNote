// Import OneNote notebooks (Microsoft account): choose one notebook or all of them, bring them in, and say what came over.
// What did not come over is on an Import report page, so nothing is lost without the person being able to see it.
import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { connectors, connectorsStore } from '../../connectors';
import { accountsHost } from '../host';
import { attempt, isConnected, tellNotConnected } from '../run';
import { pickOne } from '../ui/prompts';
import { listNotebooks } from './graph';
import type { GraphNotebook } from './graph';
import { importNotebooks } from './import';

/** The account the Microsoft connector is signed in as. */
export function microsoftAccount(): string {
  const item = connectorsStore.get().items.find((one) => one.id === 'microsoft');
  return item && item.state.kind === 'connected' ? item.state.account : '';
}

export async function importOneNote(): Promise<void> {
  if (!(await isConnected('microsoft'))) return tellNotConnected('Microsoft');
  await attempt('Microsoft', async () => {
    const client = connectors();
    announce(t('accounts.onenote.working'));
    const notebooks = await listNotebooks(client);
    const choice = await pickOne<GraphNotebook | 'all'>({
      title: t('accounts.onenote.pick.title'),
      description: t('accounts.onenote.pick.description'),
      confirmLabel: t('accounts.onenote.pick.confirm'),
      empty: t('accounts.onenote.pick.none'),
      choices: [
        ...(notebooks.length > 1 ? [{ id: 'all', label: t('accounts.onenote.pick.all'), value: 'all' as const }] : []),
        ...notebooks.map((one) => ({
          id: one.id,
          label: one.name || t('accounts.onenote.untitledNotebook'),
          value: one,
        })),
      ],
    });
    if (!choice) return;
    const context = commandContext('palette');
    const reports = await importNotebooks(
      {
        client,
        host: accountsHost(),
        notes: context.notes,
        pages: context.platform.pages,
        account: microsoftAccount(),
        progress: (done, total) => {
          if (done === total || done % 10 === 0) announce(t('accounts.onenote.progress', { done, total }));
        },
      },
      choice === 'all' ? notebooks : [choice],
    );
    const pages = reports.reduce((sum, one) => sum + one.pages, 0);
    const left = reports.reduce((sum, one) => sum + one.failedPages.length, 0);
    const message = [
      t('accounts.onenote.done', { notebooks: reports.length, pages }),
      left > 0 ? t('accounts.onenote.doneLeft', { left }) : '',
    ]
      .join(' ')
      .trim();
    showToast({ message });
    announce(message);
  });
}

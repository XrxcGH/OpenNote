// The Sync Readwise command: runs a sync with the app's own notes, pages, and connectors, and says how it went.

import { commandContext } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { ConnectorHttpError } from '../../connectors';
import { accountsHost } from '../host';
import { services } from '../notebook';
import { attempt, isConnected, tellNotConnected } from '../run';
import { syncReadwise } from './sync';

const WORKING = 'readwise-sync';

export async function sync(): Promise<void> {
  if (!(await isConnected('readwise'))) return tellNotConnected('Readwise');
  const { notes, pages } = services();
  const working = showToast({ id: WORKING, message: t('accounts.readwise.working') });
  const finished = await attempt('Readwise', async () => {
    try {
      const result = await syncReadwise({
        notes,
        pages,
        host: accountsHost(),
        client: commandContext('palette').platform.connectors,
      });
      const none = result.added + result.updated + result.removed === 0;
      const message = none
        ? t('accounts.readwise.upToDate')
        : t('accounts.readwise.done', { added: result.added, updated: result.updated, removed: result.removed });
      showToast({ id: WORKING, message });
      announce(message);
    } catch (error) {
      if (error instanceof ConnectorHttpError && error.status === 429) {
        showToast({ id: WORKING, message: t('accounts.readwise.rateLimited'), tone: 'danger' });
        return;
      }
      throw error;
    }
  });
  if (!finished) working.dismiss();
}

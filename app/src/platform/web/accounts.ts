// The web platform's account calls: the in-memory host, over the same fake connectors the Settings page uses.
import { createFakeAccountsHost } from '../../features/accounts';
import type { AccountsHost } from '../../features/accounts';
import type { ConnectorsClient } from '../../features/connectors';

export function createWebAccounts(connectors: ConnectorsClient): AccountsHost {
  return createFakeAccountsHost(() => connectors);
}

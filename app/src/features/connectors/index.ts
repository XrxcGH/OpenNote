// Connectors: the accounts OpenNote can sign in to, and the Settings page that lists them (the shell side is in
// app/src-tauri/src/connectors). A feature that needs an account uses `platform.connectors`: `request` sends a
// request with the account's token added by the shell, so no token ever reaches the interface.

export { createFakeConnectors } from './fake';
export type { FakeConnectors, FakeOptions } from './fake';
export type { ConnectorsClient } from './client';
export { ConnectorNetworkUse } from './NetworkUse';
export {
  cancelSignIn,
  connectTo,
  connectorsStore,
  disconnectFrom,
  isConnectorConnected,
  refreshConnectors,
} from './runtime';
export { ConnectorError, ERROR_CODES } from './types';
export type * from './types';

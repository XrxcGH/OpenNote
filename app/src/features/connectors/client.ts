// What the page needs from the host. platform/tauri/connectors.ts implements it over the Tauri commands, and fake.ts
// is the in-memory version that the web platform and the tests use. Features that need an account later call
// `isConnected` and `request`: the host adds the token, so a feature never sees one.

import type { ConnectInput, ConnectorInfo, ConnectorRequest, ConnectorResponse, Disconnected } from './types';

export interface ConnectorsClient {
  /** Every connector and its state. */
  list(): Promise<ConnectorInfo[]>;
  /**
   * Signs in. For a service with its own sign-in page this opens the person's browser and answers when they finish,
   * up to 5 minutes later, or rejects with a ConnectorError. Resolves to the connector with its new state.
   */
  connect(id: string, input?: ConnectInput): Promise<ConnectorInfo>;
  /** Stops a sign-in that is waiting for the browser. */
  cancel(id: string): Promise<void>;
  /** Removes the connection from this computer, and from the service where the service allows it. */
  disconnect(id: string): Promise<Disconnected>;
  /**
   * Runs a request with the connection's token added. `access` names the capabilities the request needs, such as
   * `calendarRead`. Rejects with a ConnectorError (`expired`, `missingAccess`, `offline`, `foreignHost`, and so on).
   */
  request(id: string, access: readonly string[], request: ConnectorRequest): Promise<ConnectorResponse>;
}

// The Connectors page through the shell's commands. The shell refuses with a fixed code, and this turns it into the
// ConnectorError that the page reads. No command returns a token. It calls Tauri directly, so adding these
// commands never edits the shared command table in invoke.ts.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { ConnectorError, ERROR_CODES } from '../../features/connectors';
import type { ConnectorInfo, ConnectorResponse, ConnectorsClient, Disconnected } from '../../features/connectors';
import { toIpcError } from './invoke';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    const { code } = toIpcError(error);
    throw new ConnectorError(ERROR_CODES.find((known) => known === code) ?? 'unknown');
  }
}

export function createTauriConnectors(): ConnectorsClient {
  return {
    list: () => call<ConnectorInfo[]>('connectors_list'),
    connect: (id, input) => call<ConnectorInfo>('connectors_connect', { id, input: input ?? null }),
    cancel: (id) => call<null>('connectors_cancel', { id }).then(() => undefined),
    disconnect: (id) => call<Disconnected>('connectors_disconnect', { id }),
    request: (id, access, request) =>
      call<ConnectorResponse>('connectors_request', { id, scopes: [...access], request }),
  };
}

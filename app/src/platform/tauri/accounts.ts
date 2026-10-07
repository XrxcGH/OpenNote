// The account features' host calls through the shell's one `accounts_call` command (app/src-tauri/src/connectors).
// A refusal comes back as a ConnectorError, like the connectors' own calls. No call returns a token.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { AccountsHost, Downloaded, UploadPart } from '../../features/accounts';
import { ConnectorError, ERROR_CODES } from '../../features/connectors';
import type { ConnectorInfo, ConnectorResponse } from '../../features/connectors';
import { toIpcError } from './invoke';

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await tauriInvoke<T>('accounts_call', { name, args });
  } catch (error) {
    const { code } = toIpcError(error);
    throw new ConnectorError(ERROR_CODES.find((known) => known === code) ?? 'unknown');
  }
}

const decode = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

export function createTauriAccounts(): AccountsHost {
  return {
    stateGet: async <T>(name: string) => (await call<T | null>('state.get', { name })) ?? null,
    stateSet: (name, value) => call<unknown>('state.set', { name, value }).then(() => undefined),
    stateDelete: (name) => call<unknown>('state.delete', { name }).then(() => undefined),
    setClient: (connector, clientId, clientSecret) =>
      call<ConnectorInfo>('client.set', { connector, clientId, clientSecret: clientSecret ?? null }),
    tempDir: async () => (await call<{ path: string }>('temp.dir')).path,
    tempWrite: (file, part: UploadPart) => call<{ path: string; bytes: number }>('temp.write', { file, part }),
    tempRead: async (file) => decode((await call<{ base64: string }>('temp.read', { file })).base64),
    tempRemove: (file) => call<unknown>('temp.remove', { file }).then(() => undefined),
    download: (connector, access, request, file) =>
      call<Downloaded>('transfer.download', { connector, access: [...access], request, file }),
    upload: (connector, access, request, parts, contentType) =>
      call<ConnectorResponse>('transfer.upload', {
        connector,
        access: [...access],
        request,
        parts: [...parts],
        contentType,
      }),
  };
}

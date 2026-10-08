// What the account features need from the host beyond a request: small saved state, files in the transfer folder,
// and a file moved to or from a service without its bytes crossing into the interface. The shell side is
// `accounts_call` (app/src-tauri/src/connectors/accounts.rs). The web platform and the tests use `fakeHost.ts`.

import { commandContext } from '../../commands/registry';
import type { ConnectorInfo, ConnectorRequest, ConnectorResponse } from '../connectors';

/** A piece of an upload's body. The pieces are joined in order. */
export type UploadPart =
  | { kind: 'text'; text: string }
  | { kind: 'base64'; base64: string }
  /** A file in the transfer folder, or a slice of one. */
  | { kind: 'file'; file: string; offset?: number; length?: number };

export interface Downloaded {
  status: number;
  contentType: string | null;
  bytes: number;
  /** Where the file is, for a step that reads it (an import). */
  path: string;
  /** The service's words when the answer was a failure; the file is written only on success. */
  body: string;
}

export interface AccountsHost {
  stateGet<T>(name: string): Promise<T | null>;
  stateSet(name: string, value: unknown): Promise<void>;
  stateDelete(name: string): Promise<void>;
  /** Saves the client ID (and secret) typed on a card. Resolves to the connector with its new state. */
  setClient(connector: string, clientId: string, clientSecret?: string): Promise<ConnectorInfo>;
  /** The transfer folder, made if it is missing. */
  tempDir(): Promise<string>;
  tempWrite(file: string, part: UploadPart): Promise<{ path: string; bytes: number }>;
  tempRead(file: string): Promise<Uint8Array>;
  tempRemove(file: string): Promise<void>;
  /** Fetches the address and writes the body to `file` in the transfer folder. */
  download(connector: string, access: readonly string[], request: ConnectorRequest, file: string): Promise<Downloaded>;
  /** Sends the joined parts as the body of the request. */
  upload(
    connector: string,
    access: readonly string[],
    request: ConnectorRequest,
    parts: readonly UploadPart[],
    contentType: string,
  ): Promise<ConnectorResponse>;
  /**
   * Sends the joined parts as a POST to an address that the service itself gave in an earlier answer (an upload
   * address on its storage), with no token. The connector must be connected. Only a plain https address on a name
   * (not a number, and not this computer) is sent to.
   */
  uploadPublic(
    connector: string,
    url: string,
    parts: readonly UploadPart[],
    contentType: string,
  ): Promise<ConnectorResponse>;
}

/** The host's account calls. */
export function accountsHost(): AccountsHost {
  return commandContext('menu').platform.accounts;
}

/** Bytes as base64 text. */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** Bytes as an upload part. */
export function bytesPart(bytes: Uint8Array): UploadPart {
  return { kind: 'base64', base64: base64Of(bytes) };
}

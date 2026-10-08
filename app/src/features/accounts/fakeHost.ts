// An in-memory AccountsHost for the web platform and the tests. State and "files" live in maps. A download asks the
// connectors client for the answer and keeps its text as the file; an upload joins the parts and asks the client to
// run the request with the joined body, so a mock server sees exactly the bytes a service would.

import type { ConnectorsClient } from '../connectors';
import { ConnectorError } from '../connectors';
import type { AccountsHost, UploadPart } from './host';

const encoder = new TextEncoder();

const fromBase64 = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

export interface FakeAccountsHost extends AccountsHost {
  /** The saved state by name, for a test to read or seed. */
  readonly state: Map<string, unknown>;
  /** The files of the transfer folder by name. */
  readonly files: Map<string, Uint8Array>;
  /** The bodies the uploads sent, as text. */
  readonly uploads: { connector: string; url: string; contentType: string; body: string }[];
}

const FOLDER = '/fake-accounts/tmp';

export function createFakeAccountsHost(connectors: () => ConnectorsClient): FakeAccountsHost {
  const state = new Map<string, unknown>();
  const files = new Map<string, Uint8Array>();
  const uploads: FakeAccountsHost['uploads'] = [];
  const name = (file: string): string => (file.startsWith(`${FOLDER}/`) ? file.slice(FOLDER.length + 1) : file);
  const partBytes = (part: UploadPart): Uint8Array => {
    if (part.kind === 'text') return encoder.encode(part.text);
    if (part.kind === 'base64') return fromBase64(part.base64);
    const bytes = files.get(name(part.file));
    if (!bytes) throw new ConnectorError('badInput');
    const start = part.offset ?? 0;
    return bytes.slice(start, part.length === undefined ? undefined : start + part.length);
  };
  return {
    state,
    files,
    uploads,
    stateGet: <T>(key: string) => Promise.resolve(structuredClone((state.get(key) as T | undefined) ?? null)),
    stateSet: (key, value) => (state.set(key, structuredClone(value)), Promise.resolve()),
    stateDelete: (key) => (state.delete(key), Promise.resolve()),
    async setClient(connector, clientId) {
      const list = await connectors().list();
      const info = list.find((item) => item.id === connector);
      if (!info || clientId.trim() === '' || /\s/.test(clientId)) throw new ConnectorError('badInput');
      return info.state.kind === 'needsSetup' ? { ...info, state: { kind: 'notConnected' } } : info;
    },
    tempDir: () => Promise.resolve(FOLDER),
    tempWrite(file, part) {
      const bytes = partBytes(part);
      files.set(name(file), bytes);
      return Promise.resolve({ path: `${FOLDER}/${name(file)}`, bytes: bytes.length });
    },
    tempRead(file) {
      const bytes = files.get(name(file));
      return bytes ? Promise.resolve(bytes) : Promise.reject(new ConnectorError('badInput'));
    },
    tempRemove: (file) => (files.delete(name(file)), Promise.resolve()),
    async download(connector, access, request, file) {
      const response = await connectors().request(connector, access, request);
      const ok = response.status >= 200 && response.status < 300;
      const bytes = ok ? encoder.encode(response.body) : new Uint8Array();
      if (ok) files.set(name(file), bytes);
      return {
        status: response.status,
        contentType: response.contentType,
        bytes: bytes.length,
        path: `${FOLDER}/${name(file)}`,
        body: ok ? '' : response.body,
      };
    },
    async upload(connector, access, request, parts, contentType) {
      const joined = parts.map(partBytes);
      const all = new Uint8Array(joined.reduce((sum, one) => sum + one.length, 0));
      let at = 0;
      for (const one of joined) {
        all.set(one, at);
        at += one.length;
      }
      const body = new TextDecoder().decode(all);
      uploads.push({ connector, url: request.url, contentType, body });
      return connectors().request(connector, access, { ...request, body, contentType });
    },
    async uploadPublic(connector, url, parts, contentType) {
      const joined = parts.map(partBytes);
      const all = new Uint8Array(joined.reduce((sum, one) => sum + one.length, 0));
      let at = 0;
      for (const one of joined) {
        all.set(one, at);
        at += one.length;
      }
      const body = new TextDecoder().decode(all);
      uploads.push({ connector, url, contentType, body });
      return connectors().request(connector, [], { method: 'POST', url, body, contentType });
    },
  };
}

// WebDAV: a server the person gave an address, a user name, and a password for (Nextcloud, ownCloud, a NAS, and the
// like). Folders are listed with PROPFIND, and a file is sent with PUT. A name that is taken is not overwritten: the
// request says "only if nothing is there" and the file goes again under a new name when the server says it is taken.
// Updating the copy overwrites on purpose. The address is the server's own, and the user and password are the host's.
import { ConnectorHttpError } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import { schoolAddress } from '../lms/canvas';
import type { Destination, LocalFile, RemoteFolder, Sent } from './types';

const PROPFIND = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`;

/** The folders named in a PROPFIND answer for a folder, without the folder itself. */
export function foldersIn(xml: string, here: string): RemoteFolder[] {
  const found: RemoteFolder[] = [];
  const base = decodeURIComponent(here).replace(/\/+$/, '');
  for (const part of xml.split(/<(?:\w+:)?response[\s>]/i).slice(1)) {
    const href = /<(?:\w+:)?href>([^<]*)<\/(?:\w+:)?href>/i.exec(part)?.[1];
    if (!href || !/<(?:\w+:)?collection\b/i.test(part)) continue;
    let path = href.trim();
    try {
      path = decodeURIComponent(new URL(path, 'https://example.invalid').pathname);
    } catch {
      continue;
    }
    path = path.replace(/\/+$/, '');
    if (path === base || path === '') continue;
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name) found.push({ id: path, name });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function webdavDestination(deps: { client: ConnectorsClient; host: AccountsHost }): Destination {
  const { client, host } = deps;

  /** The part of the server's address before the folders: its path, which a folder's path includes. */
  async function root(): Promise<{ origin: string; path: string }> {
    const url = new URL(await schoolAddress(client, 'webdav'));
    return { origin: url.origin, path: url.pathname.replace(/\/+$/, '') };
  }

  const encoded = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

  async function put(path: string, local: LocalFile, replace: boolean): Promise<Reply> {
    const { origin } = await root();
    return host.upload(
      'webdav',
      ['webdavFiles'],
      { method: 'PUT', url: `${origin}${encoded(path)}`, ...(replace ? {} : { headers: { 'If-None-Match': '*' } }) },
      [{ kind: 'file', file: local.file }],
      local.mime,
    );
  }

  type Reply = Awaited<ReturnType<AccountsHost['upload']>>;

  async function sent(path: string): Promise<Sent> {
    const { origin } = await root();
    return { id: path, name: path.slice(path.lastIndexOf('/') + 1), link: `${origin}${encoded(path)}` };
  }

  return {
    service: 'webdav',
    async folders(parent) {
      const { origin, path } = await root();
      const here = parent ?? `${path}/`;
      const answer = await client.request('webdav', ['webdavFiles'], {
        method: 'PROPFIND',
        url: `${origin}${encoded(here.endsWith('/') ? here : `${here}/`)}`,
        headers: { Depth: '1' },
        contentType: 'application/xml',
        body: PROPFIND,
      });
      if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
      return foldersIn(answer.body, here);
    },
    async send(local, folder) {
      const { path } = await root();
      const dir = (folder ?? path).replace(/\/+$/, '');
      const dot = local.name.lastIndexOf('.');
      const stem = dot > 0 ? local.name.slice(0, dot) : local.name;
      const extension = dot > 0 ? local.name.slice(dot) : '';
      for (let copy = 0; copy <= 9; copy += 1) {
        const name = copy === 0 ? local.name : `${stem} (${copy})${extension}`;
        const answer = await put(`${dir}/${name}`, local, false);
        // 412 is "something is there already", and some servers say 409 or 405 for the same thing.
        if ([412, 409, 405].includes(answer.status)) continue;
        if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
        return sent(`${dir}/${name}`);
      }
      throw new ConnectorHttpError(409, JSON.stringify({ message: 'The name is taken.' }));
    },
    async replace(local, remote) {
      const answer = await put(remote, local, true);
      if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
      return sent(remote);
    },
  };
}

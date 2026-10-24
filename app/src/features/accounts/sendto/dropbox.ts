// Dropbox: the folders to choose from, and a file sent with one upload request (up to 150 MB), new or over the file sent
// before. Dropbox names files by path, so the path is the copy's ID. A name that is taken is kept and the new file is
// renamed, so nothing is overwritten unless the person asked to update the copy.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import type { Destination, LocalFile, RemoteFolder, Sent } from './types';

const API = 'https://api.dropboxapi.com/2/files';
const UPLOAD = 'https://content.dropboxapi.com/2/files/upload';
const MAX_PAGES = 30;

interface Entry {
  '.tag': string;
  name: string;
  path_lower?: string;
  path_display?: string;
}

interface Listing {
  entries?: Entry[];
  cursor?: string;
  has_more?: boolean;
}

interface Uploaded {
  name?: string;
  path_display?: string;
  path_lower?: string;
}

export function dropboxDestination(deps: { client: ConnectorsClient; host: AccountsHost }): Destination {
  const { client, host } = deps;

  async function upload(path: string, mode: 'add' | 'overwrite', local: LocalFile): Promise<Sent> {
    const answer = await host.upload(
      'dropbox',
      ['dropboxWrite'],
      {
        method: 'POST',
        url: UPLOAD,
        headers: { 'Dropbox-API-Arg': JSON.stringify({ path, mode, autorename: mode === 'add', mute: true }) },
      },
      [{ kind: 'file', file: local.file }],
      'application/octet-stream',
    );
    if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
    const done = JSON.parse(answer.body || '{}') as Uploaded;
    const shown = done.path_display ?? path;
    const folder = shown.slice(0, shown.lastIndexOf('/'));
    return {
      id: done.path_lower ?? path.toLowerCase(),
      name: done.name ?? local.name,
      link: `https://www.dropbox.com/home${encodeURI(folder)}`,
    };
  }

  return {
    service: 'dropbox',
    async folders(parent) {
      const found: RemoteFolder[] = [];
      let page = await requestConnector<Listing>(
        'dropbox',
        ['dropboxRead'],
        { url: `${API}/list_folder`, json: { path: parent ?? '', recursive: false, limit: 500 } },
        client,
      );
      for (let more = 0; more < MAX_PAGES; more += 1) {
        for (const entry of page.data?.entries ?? []) {
          if (entry['.tag'] === 'folder') found.push({ id: entry.path_display ?? entry.name, name: entry.name });
        }
        if (!page.data?.has_more || !page.data.cursor) break;
        page = await requestConnector<Listing>(
          'dropbox',
          ['dropboxRead'],
          { url: `${API}/list_folder/continue`, json: { cursor: page.data.cursor } },
          client,
        );
      }
      return found.sort((a, b) => a.name.localeCompare(b.name));
    },
    send: (local, folder) => upload(`${folder ?? ''}/${local.name}`, 'add', local),
    replace: (local, remote) => upload(remote, 'overwrite', local),
  };
}

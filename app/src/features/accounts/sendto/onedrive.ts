// OneDrive through Microsoft Graph: the folders to choose from, and a file sent with one PUT (Graph takes up to 250 MB
// that way). A name that is taken is kept and the new file is renamed, so nothing is overwritten. A copy sent before is
// replaced by its ID.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import type { Destination, LocalFile, RemoteFolder, Sent } from './types';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_PAGES = 20;

interface Children {
  value?: { id: string; name: string; folder?: object }[];
  '@odata.nextLink'?: string;
}

interface Item {
  id?: string;
  name?: string;
  webUrl?: string;
}

export function onedriveDestination(deps: { client: ConnectorsClient; host: AccountsHost }): Destination {
  const { client, host } = deps;

  async function put(url: string, local: LocalFile): Promise<Sent> {
    const answer = await host.upload(
      'microsoft',
      ['onedriveFiles'],
      { method: 'PUT', url },
      [{ kind: 'file', file: local.file }],
      local.mime,
    );
    if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
    const item = JSON.parse(answer.body || '{}') as Item;
    if (!item.id) throw new ConnectorHttpError(502, answer.body);
    return { id: item.id, name: item.name ?? local.name, link: item.webUrl ?? '' };
  }

  return {
    service: 'onedrive',
    async folders(parent) {
      const found: RemoteFolder[] = [];
      let url: string | null = parent
        ? `${GRAPH}/me/drive/items/${encodeURIComponent(parent)}/children`
        : `${GRAPH}/me/drive/root/children`;
      let query: Record<string, string | number> | undefined = { $select: 'id,name,folder', $top: 200 };
      for (let page = 0; url && page < MAX_PAGES; page += 1) {
        const reply: { data?: Children } = await requestConnector<Children>(
          'microsoft',
          ['onedriveFiles'],
          { url, ...(query ? { query } : {}) },
          client,
        );
        for (const one of reply.data?.value ?? []) if (one.folder) found.push({ id: one.id, name: one.name });
        url = reply.data?.['@odata.nextLink'] ?? null;
        query = undefined;
      }
      return found.sort((a, b) => a.name.localeCompare(b.name));
    },
    send(local, folder) {
      const name = encodeURIComponent(local.name);
      const where = folder ? `items/${encodeURIComponent(folder)}` : 'root';
      return put(`${GRAPH}/me/drive/${where}:/${name}:/content?@microsoft.graph.conflictBehavior=rename`, local);
    },
    replace(local, remote) {
      return put(`${GRAPH}/me/drive/items/${encodeURIComponent(remote)}/content`, local);
    },
  };
}

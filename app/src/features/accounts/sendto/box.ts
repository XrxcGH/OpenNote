// Box: the folders to choose from, and a file sent as one multipart request (the file's name and folder, then its bytes),
// new, or over the file sent before. Box names a folder or file by an ID, and the top folder is "0". A name that is
// taken in a folder is refused by Box with a conflict, and the file is then sent again under a new name.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import type { Destination, LocalFile, RemoteFolder, Sent } from './types';

const API = 'https://api.box.com/2.0';
const UPLOAD = 'https://upload.box.com/api/2.0/files';
const MAX_PAGES = 30;
const LIMIT = 100;

interface Items {
  entries?: { id: string; name: string; type: string }[];
  total_count?: number;
}

interface Uploaded {
  entries?: { id: string; name: string }[];
}

export function boxDestination(deps: { client: ConnectorsClient; host: AccountsHost }): Destination {
  const { client, host } = deps;

  async function multipart(url: string, attributes: Record<string, unknown>, local: LocalFile) {
    const boundary = `opennote${Math.random().toString(36).slice(2, 12)}`;
    return host.upload(
      'box',
      ['boxFiles'],
      { method: 'POST', url },
      [
        {
          kind: 'text',
          text:
            `--${boundary}\r\nContent-Disposition: form-data; name="attributes"\r\n\r\n${JSON.stringify(attributes)}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${local.name.replace(/"/g, '')}"\r\n` +
            `Content-Type: ${local.mime}\r\n\r\n`,
        },
        { kind: 'file', file: local.file },
        { kind: 'text', text: `\r\n--${boundary}--` },
      ],
      `multipart/form-data; boundary=${boundary}`,
    );
  }

  async function finish(answer: { status: number; body: string }, local: LocalFile): Promise<Sent> {
    if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
    const entry = (JSON.parse(answer.body || '{}') as Uploaded).entries?.[0];
    if (!entry) throw new ConnectorHttpError(502, answer.body);
    return { id: entry.id, name: entry.name || local.name, link: `https://app.box.com/file/${entry.id}` };
  }

  return {
    service: 'box',
    async folders(parent) {
      const found: RemoteFolder[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const reply = await requestConnector<Items>(
          'box',
          ['boxFiles'],
          {
            url: `${API}/folders/${encodeURIComponent(parent ?? '0')}/items`,
            query: { fields: 'id,name,type', limit: LIMIT, offset: page * LIMIT },
          },
          client,
        );
        const entries = reply.data?.entries ?? [];
        for (const entry of entries) if (entry.type === 'folder') found.push({ id: entry.id, name: entry.name });
        if (entries.length < LIMIT) break;
      }
      return found.sort((a, b) => a.name.localeCompare(b.name));
    },
    async send(local, folder) {
      const parent = { id: folder ?? '0' };
      const first = await multipart(`${UPLOAD}/content`, { name: local.name, parent }, local);
      if (first.status !== 409) return finish(first, local);
      // The name is taken: Box says so, and the file goes again with a number after its name.
      const dot = local.name.lastIndexOf('.');
      const stem = dot > 0 ? local.name.slice(0, dot) : local.name;
      const extension = dot > 0 ? local.name.slice(dot) : '';
      for (let copy = 1; copy <= 9; copy += 1) {
        const name = `${stem} (${copy})${extension}`;
        const again = await multipart(`${UPLOAD}/content`, { name, parent }, { ...local, name });
        if (again.status !== 409) return finish(again, { ...local, name });
      }
      throw new ConnectorHttpError(409, JSON.stringify({ message: 'The name is taken.' }));
    },
    async replace(local, remote) {
      return finish(
        await multipart(`${UPLOAD}/${encodeURIComponent(remote)}/content`, { name: local.name }, local),
        local,
      );
    },
  };
}

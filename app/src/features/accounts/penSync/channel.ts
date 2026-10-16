// The settings channel: one small JSON file in the app's own hidden folder of the linked cloud account. On Google that is
// the app data folder of Drive (only OpenNote can see it, and it does not show in the person's Drive). On Microsoft it is
// the app folder of OneDrive (`Apps/OpenNote`). The file holds the items and nothing else; no token is in it.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { RemoteDoc } from './merge';

export type PenService = 'google' | 'microsoft';

export interface Channel {
  service: PenService;
  /** The file's content, or null when there is none yet or it is not ours to read. */
  read(): Promise<RemoteDoc | null>;
  write(doc: RemoteDoc): Promise<void>;
}

const NAME = 'opennote-settings.json';

function parse(text: string): RemoteDoc | null {
  try {
    const value = JSON.parse(text) as Partial<RemoteDoc> | null;
    if (!value || value.v !== 1 || typeof value.items !== 'object' || value.items === null) return null;
    const items: RemoteDoc['items'] = {};
    for (const [key, item] of Object.entries(value.items)) {
      if (item && typeof item.updated === 'string') items[key] = item;
    }
    return { v: 1, items };
  } catch {
    return null;
  }
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

function google(client: ConnectorsClient): Channel {
  const access = ['driveAppData'];
  async function find(): Promise<string | null> {
    const reply = await requestConnector<{ files?: { id: string }[] }>(
      'google',
      access,
      { url: DRIVE, query: { spaces: 'appDataFolder', q: `name='${NAME}'`, fields: 'files(id)', pageSize: 1 } },
      client,
    );
    return reply.data?.files?.[0]?.id ?? null;
  }
  return {
    service: 'google',
    async read() {
      const id = await find();
      if (!id) return null;
      const reply = await requestConnector(
        'google',
        access,
        { url: `${DRIVE}/${encodeURIComponent(id)}`, query: { alt: 'media' } },
        client,
      );
      return parse(reply.text);
    },
    async write(doc) {
      const id = await find();
      const boundary = `opennote${Math.random().toString(36).slice(2, 12)}`;
      const metadata = id ? {} : { name: NAME, parents: ['appDataFolder'] };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(doc)}\r\n--${boundary}--`;
      const answer = await client.request('google', access, {
        method: id ? 'PATCH' : 'POST',
        url: `${DRIVE_UPLOAD}${id ? `/${encodeURIComponent(id)}` : ''}?uploadType=multipart&fields=id`,
        contentType: `multipart/related; boundary=${boundary}`,
        body,
      });
      if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
    },
  };
}

const APPROOT = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${NAME}:/content`;

function microsoft(client: ConnectorsClient): Channel {
  const access = ['onedriveFiles'];
  return {
    service: 'microsoft',
    async read() {
      const reply = await requestConnector('microsoft', access, { url: APPROOT, accept: [404] }, client);
      return reply.status === 404 ? null : parse(reply.text);
    },
    async write(doc) {
      const answer = await client.request('microsoft', access, {
        method: 'PUT',
        url: APPROOT,
        contentType: 'application/json',
        body: JSON.stringify(doc),
      });
      if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
    },
  };
}

export function channelFor(service: PenService, client: ConnectorsClient): Channel {
  return service === 'google' ? google(client) : microsoft(client);
}

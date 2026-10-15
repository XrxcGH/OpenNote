// OneNote through Microsoft Graph: the notebooks, their sections (inside section groups too), the pages of a section,
// and a page's HTML. Lists are followed across pages. Pictures are fetched one at a time into the transfer folder.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ACCESS = ['onenoteRead'] as const;
const MAX_PAGES = 50;

export interface GraphNotebook {
  id: string;
  name: string;
}

export interface GraphSection {
  id: string;
  /** The section's name, with the names of the section groups it sits in before it. */
  name: string;
}

export interface GraphPage {
  id: string;
  title: string;
  modified: string;
  /** 0 for a page, 1 and 2 for subpages. */
  level: number;
}

interface List<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

async function listAll<T>(
  client: ConnectorsClient,
  first: string,
  query?: Record<string, string | number>,
): Promise<T[]> {
  const found: T[] = [];
  let url: string | null = first;
  let params = query;
  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const reply: { data?: List<T> } = await requestConnector<List<T>>(
      'microsoft',
      [...ACCESS],
      { url, ...(params ? { query: params } : {}) },
      client,
    );
    found.push(...(reply.data?.value ?? []));
    url = reply.data?.['@odata.nextLink'] ?? null;
    params = undefined;
  }
  return found;
}

export async function listNotebooks(client: ConnectorsClient): Promise<GraphNotebook[]> {
  const found = await listAll<{ id: string; displayName?: string }>(client, `${GRAPH}/me/onenote/notebooks`);
  return found.map((one) => ({ id: one.id, name: one.displayName ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The sections of a notebook, and of the section groups inside it, to any depth. */
export async function listSections(client: ConnectorsClient, notebook: string): Promise<GraphSection[]> {
  const sections: GraphSection[] = [];
  async function walk(base: string, prefix: string, depth: number): Promise<void> {
    const own = await listAll<{ id: string; displayName?: string }>(client, `${base}/sections`);
    for (const one of own) sections.push({ id: one.id, name: `${prefix}${one.displayName ?? ''}` });
    if (depth >= 5) return;
    const groups = await listAll<{ id: string; displayName?: string }>(client, `${base}/sectionGroups`);
    for (const group of groups) {
      await walk(
        `${GRAPH}/me/onenote/sectionGroups/${encodeURIComponent(group.id)}`,
        `${prefix}${group.displayName ?? ''} - `,
        depth + 1,
      );
    }
  }
  await walk(`${GRAPH}/me/onenote/notebooks/${encodeURIComponent(notebook)}`, '', 0);
  return sections;
}

export async function listPages(client: ConnectorsClient, section: string): Promise<GraphPage[]> {
  const found = await listAll<{ id: string; title?: string; lastModifiedDateTime?: string; level?: number }>(
    client,
    `${GRAPH}/me/onenote/sections/${encodeURIComponent(section)}/pages`,
    { $select: 'id,title,lastModifiedDateTime,level,order', $orderby: 'order', $top: 100 },
  );
  return found.map((one) => ({
    id: one.id,
    title: one.title ?? '',
    modified: one.lastModifiedDateTime ?? '',
    level: Math.min(2, Math.max(0, one.level ?? 0)),
  }));
}

/** The page's HTML, with the full-size address of each picture. */
export async function pageHtml(client: ConnectorsClient, page: string): Promise<string> {
  const reply = await requestConnector(
    'microsoft',
    [...ACCESS],
    {
      url: `${GRAPH}/me/onenote/pages/${encodeURIComponent(page)}/content`,
      query: { includeIDs: 'false', includeinkML: 'true' },
    },
    client,
  );
  return reply.text;
}

/** Only a picture on Graph itself is fetched: a page can name any address, and none of them is followed. */
export function isGraphResource(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' && url.hostname === 'graph.microsoft.com' && !url.port && !url.username;
  } catch {
    return false;
  }
}

/** Fetches a picture or an attached file into the transfer folder. Answers its bytes and type. */
export async function fetchPicture(
  host: AccountsHost,
  address: string,
  file: string,
  fallbackMime = 'image/png',
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!isGraphResource(address)) throw new ConnectorHttpError(400, '');
  const got = await host.download('microsoft', [...ACCESS], { method: 'GET', url: address }, file);
  if (got.status < 200 || got.status >= 300) throw new ConnectorHttpError(got.status, got.body);
  const bytes = await host.tempRead(file);
  await host.tempRemove(file).catch(() => undefined);
  return { bytes, mime: (got.contentType ?? fallbackMime).split(';')[0]?.trim() || fallbackMime };
}

// Readwise's export API (v2): every book with the highlights that changed after a time, a page at a time. The token is
// the host's; this code only asks. `includeDeleted` lets a highlight deleted at Readwise leave the notebook too.

import type { ConnectorReply, ConnectorsClient } from '../../connectors';
import { requestConnector } from '../../connectors';

export interface ExportHighlight {
  id: number;
  text: string;
  note?: string | null;
  location?: number | null;
  location_type?: string | null;
  is_deleted?: boolean;
  tags?: { name: string }[];
  updated?: string;
}

export interface ExportBook {
  user_book_id: number;
  title: string;
  author?: string | null;
  category?: string | null;
  source?: string | null;
  readwise_url?: string | null;
  summary?: string | null;
  highlights: ExportHighlight[];
}

interface ExportPage {
  nextPageCursor?: string | null;
  results?: ExportBook[];
}

/** The most pages one sync reads, so a loop at the service can't run forever. */
export const MAX_PAGES = 500;

/** Reads the export page by page. `onPage` runs for each page before the next is asked for. */
export async function readExport(
  client: ConnectorsClient,
  updatedAfter: string | null,
  onPage: (books: ExportBook[]) => Promise<void>,
): Promise<void> {
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const reply: ConnectorReply<ExportPage> = await requestConnector<ExportPage>(
      'readwise',
      ['readwiseRead'],
      {
        url: 'https://readwise.io/api/v2/export/',
        query: { updatedAfter, pageCursor: cursor, includeDeleted: 'true' },
      },
      client,
    );
    await onPage(reply.data?.results ?? []);
    cursor = reply.data?.nextPageCursor ?? null;
    if (!cursor) return;
  }
}

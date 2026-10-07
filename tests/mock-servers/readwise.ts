// A mock of Readwise's export API (v2): books with their highlights, filtered by `updatedAfter`, a book at a time with a
// `nextPageCursor`. The token is checked the way Readwise checks it, in an `Authorization: Token ...` header.
import { MockServer } from './server';

export interface MockHighlight {
  id: number;
  text: string;
  note?: string;
  location?: number;
  location_type?: string;
  updated: string;
  is_deleted?: boolean;
  tags?: { name: string }[];
}

export interface MockBook {
  user_book_id: number;
  title: string;
  author?: string;
  category: string;
  source?: string;
  readwise_url?: string;
  highlights: MockHighlight[];
}

export function readwiseMock(books: MockBook[], options: { pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 1;
  const state = { books, limited: false };
  const server = new MockServer();
  server.route('GET readwise.io/api/v2/export', (request) => {
    // The host adds the token. A feature that sets an Authorization header itself is wrong.
    if (request.headers.authorization) return { status: 400, json: { detail: 'A feature must not send a token.' } };
    if (state.limited) return { status: 429, json: { detail: 'Request was throttled.' } };
    const after = request.query.updatedAfter ?? '';
    const changed = state.books
      .map((book) => ({ ...book, highlights: book.highlights.filter((one) => one.updated > after) }))
      .filter((book) => book.highlights.length > 0);
    const start = Number(request.query.pageCursor ?? 0) || 0;
    const results = changed.slice(start, start + pageSize);
    const more = start + pageSize < changed.length;
    return { json: { count: changed.length, nextPageCursor: more ? String(start + pageSize) : null, results } };
  });
  return { server, state };
}

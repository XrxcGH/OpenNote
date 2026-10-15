// Mocks of the file services: Google Drive (folders by search, a multipart upload that can convert, a multipart update)
// and OneDrive through Graph (children of a folder, a PUT of content by path or by item). The files they take are kept so a
// test can see what was stored. Bodies are text in these tests.
import { MockServer } from './server';

export interface DriveFolder {
  id: string;
  name: string;
  parent: string;
}

export interface StoredFile {
  id: string;
  name: string;
  parent: string | null;
  mimeType: string | null;
  content: string;
  /** What the request carried as metadata (Drive). */
  metadata?: Record<string, unknown>;
  versions: number;
}

/** A Google Doc, Sheet, or Slides file in the Drive mock, with the Office file Drive exports it as. */
export interface DriveDoc {
  id: string;
  name: string;
  mimeType: string;
  modified: string;
  exported: string;
}

export function addDrive(server: MockServer, folders: DriveFolder[], pageSize = 100, documents: DriveDoc[] = []) {
  const files = new Map<string, StoredFile>();
  let next = 1;

  server.route('GET www.googleapis.com/drive/v3/files', (request) => {
    const query = request.query.q ?? '';
    const parent = /^'([^']*)' in parents/.exec(query)?.[1] ?? 'root';
    if (!query.includes("mimeType='application/vnd.google-apps.folder'")) {
      const kind = /mimeType='([^']*)'/.exec(query)?.[1];
      const found = documents
        .filter((doc) => doc.mimeType === kind)
        .sort((a, b) => b.modified.localeCompare(a.modified))
        .slice(0, Number(request.query.pageSize ?? 100));
      return { json: { files: found.map((doc) => ({ id: doc.id, name: doc.name, modifiedTime: doc.modified })) } };
    }
    const mine = folders.filter((folder) => folder.parent === parent).sort((a, b) => a.name.localeCompare(b.name));
    const start = Number(request.query.pageToken ?? 0) || 0;
    const slice = mine.slice(start, start + pageSize);
    const more = start + pageSize < mine.length;
    return {
      json: {
        files: slice.map((folder) => ({ id: folder.id, name: folder.name })),
        ...(more ? { nextPageToken: String(start + pageSize) } : {}),
      },
    };
  });

  server.route('GET www.googleapis.com/drive/v3/files/:id/export', (request, params) => {
    const doc = documents.find((one) => one.id === params.id);
    if (!doc) return undefined;
    // Drive refuses an export to a type it can't make.
    if (!request.query.mimeType?.startsWith('application/vnd.openxmlformats-officedocument.')) {
      return { status: 400, json: { error: { message: 'Export format is not supported.' } } };
    }
    return { text: doc.exported, contentType: request.query.mimeType };
  });

  function readMultipart(body: string, contentType: string): { metadata: Record<string, unknown>; content: string } {
    const boundary = /boundary=([^;]+)/.exec(contentType)?.[1] ?? '';
    const parts = body.split(`--${boundary}`).filter((part) => part.trim() !== '' && part.trim() !== '--');
    const json = (parts[0] ?? '').split('\r\n\r\n')[1] ?? '{}';
    const content = ((parts[1] ?? '').split('\r\n\r\n')[1] ?? '').replace(/\r\n$/, '');
    return { metadata: JSON.parse(json.trim()) as Record<string, unknown>, content };
  }

  server.route('POST www.googleapis.com/upload/drive/v3/files', (request) => {
    const { metadata, content } = readMultipart(request.body, request.contentType);
    const id = `file${next++}`;
    const file: StoredFile = {
      id,
      name: String(metadata.name ?? ''),
      parent: Array.isArray(metadata.parents) ? String(metadata.parents[0]) : null,
      mimeType: typeof metadata.mimeType === 'string' ? metadata.mimeType : null,
      content,
      metadata,
      versions: 1,
    };
    files.set(id, file);
    return { json: { id, name: file.name, webViewLink: `https://drive.example/${id}` } };
  });

  server.route('PATCH www.googleapis.com/upload/drive/v3/files/:id', (request, params) => {
    const file = files.get(params.id ?? '');
    if (!file) return undefined;
    file.content = readMultipart(request.body, request.contentType).content;
    file.versions += 1;
    return { json: { id: file.id, name: file.name, webViewLink: `https://drive.example/${file.id}` } };
  });

  return { files };
}

export interface GraphFolder {
  id: string;
  name: string;
  /** The folder it is in; undefined for the top. */
  parent?: string;
  /** A file, not a folder. */
  file?: boolean;
}

export function addOneDrive(server: MockServer, items: GraphFolder[]) {
  const files = new Map<string, StoredFile>();
  let next = 1;
  const listing = (parent: string | undefined) =>
    items
      .filter((item) => item.parent === parent)
      .map((item) => ({ id: item.id, name: item.name, ...(item.file ? { file: {} } : { folder: {} }) }));

  server.route('GET graph.microsoft.com/v1.0/me/drive/root/children', () => ({ json: { value: listing(undefined) } }));
  server.route('GET graph.microsoft.com/v1.0/me/drive/items/:id/children', (_request, params) => ({
    json: { value: listing(params.id) },
  }));
  // A file by path under the top or under an item: .../root:/name:/content and .../items/ID:/name:/content
  server.route('PUT graph.microsoft.com/v1.0/me/drive/*', (request) => {
    const path = decodeURIComponent(request.path);
    const byPath = /\/me\/drive\/(?:root|items\/([^:/]+)):\/(.+):\/content$/.exec(path);
    const byItem = /\/me\/drive\/items\/([^/:]+)\/content$/.exec(path);
    if (byPath) {
      const id = `item${next++}`;
      const taken = [...files.values()].some((one) => one.name === byPath[2] && one.parent === (byPath[1] ?? null));
      const name = taken ? `${byPath[2]} 1` : (byPath[2] ?? '');
      files.set(id, {
        id,
        name,
        parent: byPath[1] ?? null,
        mimeType: request.contentType,
        content: request.body,
        versions: 1,
      });
      return { status: 201, json: { id, name, webUrl: `https://onedrive.example/${id}` } };
    }
    const file = byItem ? files.get(byItem[1] ?? '') : undefined;
    if (!file) return undefined;
    file.content = request.body;
    file.versions += 1;
    return { json: { id: file.id, name: file.name, webUrl: `https://onedrive.example/${file.id}` } };
  });

  return { files };
}

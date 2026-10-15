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

/** Dropbox: folders by path, and uploads that add (renaming a taken name) or overwrite. */
export function addDropbox(server: MockServer, folders: string[]) {
  const files = new Map<string, StoredFile>();
  server.route('POST api.dropboxapi.com/2/files/list_folder', (request) => {
    const path = (request.json<{ path?: string }>()?.path ?? '').toLowerCase();
    const inside = folders.filter(
      (one) => one.toLowerCase().startsWith(`${path}/`) && one.slice(path.length + 1).indexOf('/') < 0,
    );
    return {
      json: {
        entries: inside.map((one) => ({
          '.tag': 'folder',
          name: one.slice(one.lastIndexOf('/') + 1),
          path_display: one,
          path_lower: one.toLowerCase(),
        })),
        has_more: false,
        cursor: 'c',
      },
    };
  });
  server.route('POST content.dropboxapi.com/2/files/upload', (request) => {
    const arg = JSON.parse(request.headers['dropbox-api-arg'] ?? '{}') as {
      path: string;
      mode: string;
      autorename?: boolean;
    };
    let path = arg.path;
    const taken = files.has(path.toLowerCase());
    if (taken && arg.mode === 'add') {
      const dot = path.lastIndexOf('.');
      path = `${path.slice(0, dot)} (1)${path.slice(dot)}`;
    }
    const earlier = files.get(path.toLowerCase());
    files.set(path.toLowerCase(), {
      id: path,
      name: path.slice(path.lastIndexOf('/') + 1),
      parent: path.slice(0, path.lastIndexOf('/')),
      mimeType: request.contentType,
      content: request.body,
      versions: (earlier?.versions ?? 0) + 1,
    });
    return {
      json: { name: path.slice(path.lastIndexOf('/') + 1), path_display: path, path_lower: path.toLowerCase() },
    };
  });
  return { files };
}

/** Box: folders by ID, and multipart uploads that refuse a taken name with a conflict. */
export function addBox(server: MockServer, folders: { id: string; name: string; parent: string }[]) {
  const files = new Map<string, StoredFile>();
  let next = 1;
  server.route('GET api.box.com/2.0/folders/:id/items', (_request, params) => ({
    json: {
      entries: [
        ...folders
          .filter((one) => one.parent === params.id)
          .map((one) => ({ id: one.id, name: one.name, type: 'folder' })),
        { id: 'file0', name: 'Readme.txt', type: 'file' },
      ],
    },
  }));
  const read = (request: { body: string; contentType: string }) => {
    const boundary = /boundary=([^;]+)/.exec(request.contentType)?.[1] ?? '';
    const parts = request.body.split(`--${boundary}`).filter((part) => part.includes('Content-Disposition'));
    const attributes = JSON.parse(((parts[0] ?? '').split('\r\n\r\n')[1] ?? '{}').trim()) as {
      name: string;
      parent?: { id: string };
    };
    const content = ((parts[1] ?? '').split('\r\n\r\n')[1] ?? '').replace(/\r\n$/, '');
    return { attributes, content };
  };
  server.route('POST upload.box.com/api/2.0/files/content', (request) => {
    const { attributes, content } = read(request);
    const parent = attributes.parent?.id ?? '0';
    if ([...files.values()].some((one) => one.name === attributes.name && one.parent === parent)) {
      return { status: 409, json: { code: 'item_name_in_use' } };
    }
    const id = `box${next++}`;
    files.set(id, { id, name: attributes.name, parent, mimeType: null, content, versions: 1 });
    return { status: 201, json: { entries: [{ id, name: attributes.name }] } };
  });
  server.route('POST upload.box.com/api/2.0/files/:id/content', (request, params) => {
    const file = files.get(params.id ?? '');
    if (!file) return undefined;
    file.content = read(request).content;
    file.versions += 1;
    return { status: 201, json: { entries: [{ id: file.id, name: file.name }] } };
  });
  return { files };
}

/** A WebDAV server under /dav/: PROPFIND of a folder, and PUT that honors If-None-Match. */
export function addWebdav(server: MockServer, folders: string[]) {
  const files = new Map<string, StoredFile>();
  const known = new Set(['/dav', ...folders]);
  server.route('PROPFIND files.example.org/*', (request) => {
    const here = decodeURIComponent(request.path).replace(/\/+$/, '');
    if (!known.has(here)) return undefined;
    const rows = [
      here,
      ...[...known].filter(
        (one) => one !== here && one.startsWith(`${here}/`) && one.slice(here.length + 1).indexOf('/') < 0,
      ),
    ];
    const body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${rows
      .map(
        (one) =>
          `<d:response><d:href>${one.split('/').map(encodeURIComponent).join('/')}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`,
      )
      .join(
        '',
      )}<d:response><d:href>${here}/note.txt</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>`;
    return { status: 207, text: body, contentType: 'application/xml' };
  });
  server.route('PUT files.example.org/*', (request) => {
    const path = decodeURIComponent(request.path);
    const exists = files.has(path);
    if (exists && request.headers['if-none-match'] === '*') return { status: 412, text: '' };
    files.set(path, {
      id: path,
      name: path.slice(path.lastIndexOf('/') + 1),
      parent: null,
      mimeType: request.contentType,
      content: request.body,
      versions: (files.get(path)?.versions ?? 0) + 1,
    });
    return { status: exists ? 204 : 201, text: '' };
  });
  return { files };
}

/** The hidden app folder of each service: Drive's appDataFolder, and OneDrive's special/approot. One settings file each. */
export function addAppFolders(server: MockServer) {
  const drive = { id: null as string | null, content: '', versions: 0, parents: [] as unknown[] };
  server.route('GET www.googleapis.com/drive/v3/files', (request) => {
    if (request.query.spaces !== 'appDataFolder') return { json: { files: [] } };
    return {
      json: { files: drive.id && (request.query.q ?? '').includes('opennote-settings.json') ? [{ id: drive.id }] : [] },
    };
  });
  server.route('GET www.googleapis.com/drive/v3/files/:id', (request, params) => {
    if (params.id !== drive.id || request.query.alt !== 'media') return undefined;
    return { text: drive.content, contentType: 'application/json' };
  });
  const read = (body: string, contentType: string) => {
    const boundary = /boundary=([^;]+)/.exec(contentType)?.[1] ?? '';
    const parts = body.split(`--${boundary}`).filter((part) => part.includes('Content-Type'));
    const metadata = JSON.parse(((parts[0] ?? '').split('\r\n\r\n')[1] ?? '{}').trim()) as { parents?: unknown[] };
    const content = ((parts[1] ?? '').split('\r\n\r\n')[1] ?? '').replace(/\r\n$/, '');
    return { metadata, content };
  };
  server.route('POST www.googleapis.com/upload/drive/v3/files', (request) => {
    const { metadata, content } = read(request.body, request.contentType);
    drive.id = 'settings1';
    drive.content = content;
    drive.parents = metadata.parents ?? [];
    drive.versions += 1;
    return { json: { id: drive.id } };
  });
  server.route('PATCH www.googleapis.com/upload/drive/v3/files/:id', (request, params) => {
    if (params.id !== drive.id) return undefined;
    drive.content = read(request.body, request.contentType).content;
    drive.versions += 1;
    return { json: { id: drive.id } };
  });
  const onedrive = { content: null as string | null, versions: 0 };
  const path = 'graph.microsoft.com/v1.0/me/drive/special/approot:/opennote-settings.json:/content';
  server.route(`GET ${path}`, () =>
    onedrive.content === null ? undefined : { text: onedrive.content, contentType: 'application/json' },
  );
  server.route(`PUT ${path}`, (request) => {
    onedrive.content = request.body;
    onedrive.versions += 1;
    return { json: { id: 'approot-file' } };
  });
  return { drive, onedrive };
}

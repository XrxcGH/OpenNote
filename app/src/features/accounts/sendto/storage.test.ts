// Send to Dropbox, Box, and a WebDAV server against mocks: the folders, a file sent new, a taken name never overwritten,
// and a copy updated in place.
import { describe, expect, it } from 'vitest';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { addBox, addDropbox, addWebdav } from '../../../../../tests/mock-servers/storage';
import { createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { boxDestination } from './box';
import { sendFile } from './commands';
import { loadCopies } from './copies';
import { dropboxDestination } from './dropbox';
import { DOCX } from './types';
import type { LocalFile } from './types';
import { foldersIn, webdavDestination } from './webdav';

async function rig(connector: string, server: MockServer, connect?: { token: string; baseUrl: string }) {
  const connectors = createFakeConnectors({
    respond: server.respond,
    ...(connect ? {} : { connected: { [connector]: 'sam@example.com' } }),
  });
  if (connect) await connectors.client.connect(connector, connect);
  const host = createFakeAccountsHost(() => connectors.client);
  await host.tempWrite('Notes.docx', { kind: 'text', text: 'FILE-1' });
  const local: LocalFile = { file: 'Notes.docx', name: 'Notes.docx', mime: DOCX };
  return { client: connectors.client, host, local };
}

const options = (host: Awaited<ReturnType<typeof rig>>['host'], extra: Record<string, unknown> = {}) => ({
  node: 'page1',
  scope: 'page' as const,
  format: 'docx' as const,
  folder: null,
  folderName: 'top',
  host,
  ...extra,
});

describe('Dropbox', () => {
  it('lists folders, sends a file, renames a taken name, and updates the copy by its path', async () => {
    const server = new MockServer();
    const { files } = addDropbox(server, ['/School', '/School/Biology', '/Work']);
    const { client, host, local } = await rig('dropbox', server);
    const dropbox = dropboxDestination({ client, host });
    expect((await dropbox.folders(null)).map((one) => one.name)).toEqual(['School', 'Work']);
    expect((await dropbox.folders('/School')).map((one) => one.name)).toEqual(['Biology']);

    const first = await sendFile(dropbox, local, options(host, { folder: '/School/Biology' }));
    const second = await sendFile(dropbox, local, options(host, { folder: '/School/Biology', node: 'page2' }));
    expect(first.remote).toBe('/school/biology/notes.docx');
    expect(second.name).toBe('Notes (1).docx');
    expect(files.size).toBe(2);

    await host.tempWrite('Notes.docx', { kind: 'text', text: 'FILE-2' });
    await sendFile(dropbox, local, options(host, { replace: first.remote }));
    expect(files.get('/school/biology/notes.docx')).toMatchObject({ content: 'FILE-2', versions: 2 });
    expect(files.size).toBe(2);
    expect(await loadCopies(host)).toHaveLength(2);
  });
});

describe('Box', () => {
  it('lists only folders, sends a file, and sends again under a number when the name is taken', async () => {
    const server = new MockServer();
    const { files } = addBox(server, [
      { id: '11', name: 'Biology', parent: '0' },
      { id: '12', name: 'Chemistry', parent: '0' },
    ]);
    const { client, host, local } = await rig('box', server);
    const box = boxDestination({ client, host });
    expect((await box.folders(null)).map((one) => one.name)).toEqual(['Biology', 'Chemistry']);
    const first = await sendFile(box, local, options(host, { folder: '11' }));
    const second = await sendFile(box, local, options(host, { folder: '11', node: 'page2' }));
    expect(files.get(first.remote)).toMatchObject({ name: 'Notes.docx', parent: '11', content: 'FILE-1' });
    expect(second.name).toBe('Notes (1).docx');

    await host.tempWrite('Notes.docx', { kind: 'text', text: 'FILE-2' });
    await sendFile(box, local, options(host, { replace: first.remote }));
    expect(files.get(first.remote)).toMatchObject({ content: 'FILE-2', versions: 2 });
  });
});

describe('WebDAV', () => {
  const connect = { token: 'sam:app-password', baseUrl: 'https://files.example.org/dav/' };

  it('reads the folders of a PROPFIND answer without the folder itself or the files', () => {
    const xml =
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>' +
      '<d:response><d:href>/dav/My%20Notes/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>' +
      '<d:response><d:href>/dav/a.txt</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>';
    expect(foldersIn(xml, '/dav/')).toEqual([{ id: '/dav/My Notes', name: 'My Notes' }]);
  });

  it('lists folders from the server address, sends without overwriting, and updates the copy', async () => {
    const server = new MockServer();
    const { files } = addWebdav(server, ['/dav/School', '/dav/School/Biology']);
    const { client, host, local } = await rig('webdav', server, connect);
    const webdav = webdavDestination({ client, host });
    expect((await webdav.folders(null)).map((one) => one.name)).toEqual(['School']);
    expect((await webdav.folders('/dav/School')).map((one) => one.name)).toEqual(['Biology']);

    const first = await sendFile(webdav, local, options(host, { folder: '/dav/School/Biology' }));
    const second = await sendFile(webdav, local, options(host, { folder: '/dav/School/Biology', node: 'page2' }));
    expect(first.remote).toBe('/dav/School/Biology/Notes.docx');
    expect(second.remote).toBe('/dav/School/Biology/Notes (1).docx');
    expect(files.size).toBe(2);
    expect(server.requests.filter((one) => one.method === 'PUT')[0]?.headers['if-none-match']).toBe('*');

    await host.tempWrite('Notes.docx', { kind: 'text', text: 'FILE-2' });
    await sendFile(webdav, local, options(host, { replace: first.remote }));
    expect(files.get(first.remote)).toMatchObject({ content: 'FILE-2', versions: 2 });
    // Updating does not ask the server to refuse.
    expect(server.requests.filter((one) => one.method === 'PUT').at(-1)?.headers['if-none-match']).toBeUndefined();
  });

  it('sends to the top of the server when no folder is chosen', async () => {
    const server = new MockServer();
    const { files } = addWebdav(server, []);
    const { client, host, local } = await rig('webdav', server, connect);
    await sendFile(webdavDestination({ client, host }), local, options(host));
    expect([...files.keys()]).toEqual(['/dav/Notes.docx']);
  });
});

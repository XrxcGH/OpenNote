// Send to Google Drive and OneDrive against mock services: the folders (across pages), a file sent new, converted to a
// Google Doc, and sent again over its copy; the link kept between a page and its copy; and when the page counts as changed.
import { describe, expect, it } from 'vitest';
import { addDrive, addOneDrive } from '../../../../../tests/mock-servers/storage';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { formatsFor, sendFile } from './commands';
import { changedSince, copiesDue, copiesOf, loadCopies } from './copies';
import { driveDestination } from './drive';
import { onedriveDestination } from './onedrive';
import { DOCX } from './types';
import type { LocalFile } from './types';

async function rig(connected: Record<string, string>, server: MockServer) {
  const connectors = createFakeConnectors({ connected, respond: server.respond });
  const host = createFakeAccountsHost(() => connectors.client);
  await host.tempWrite('Cell notes.docx', { kind: 'text', text: 'WORD-FILE-1' });
  const local: LocalFile = { file: 'Cell notes.docx', name: 'Cell notes.docx', mime: DOCX };
  return { client: connectors.client, host, local };
}

describe('Google Drive', () => {
  const folders = [
    { id: 'f2', name: 'Chemistry', parent: 'root' },
    { id: 'f1', name: 'Biology', parent: 'root' },
    { id: 'f3', name: 'Lab reports', parent: 'f1' },
  ];

  it('lists the folders of a folder, across pages, by name', async () => {
    const server = new MockServer();
    addDrive(server, folders, 1);
    const { client, host } = await rig({ google: 'sam@example.com' }, server);
    const drive = driveDestination({ client, host });
    expect((await drive.folders(null)).map((one) => one.name)).toEqual(['Biology', 'Chemistry']);
    expect((await drive.folders('f1')).map((one) => one.name)).toEqual(['Lab reports']);
    expect(server.requests).toHaveLength(3);
  });

  it('sends a file into a folder, links it, and sends over the same copy next time', async () => {
    const server = new MockServer();
    const { files } = addDrive(server, folders);
    const { client, host, local } = await rig({ google: 'sam@example.com' }, server);
    const drive = driveDestination({ client, host });
    const copy = await sendFile(drive, local, {
      node: 'page1',
      scope: 'page',
      format: 'docx',
      folder: 'f3',
      folderName: 'Lab reports',
      host,
      now: new Date('2026-10-01T10:00:00Z'),
    });
    expect(copy).toMatchObject({ service: 'drive', node: 'page1', link: 'https://drive.example/file1' });
    expect(files.get('file1')).toMatchObject({ name: 'Cell notes.docx', parent: 'f3', content: 'WORD-FILE-1' });
    expect(await loadCopies(host)).toHaveLength(1);

    await host.tempWrite('Cell notes.docx', { kind: 'text', text: 'WORD-FILE-2' });
    await sendFile(drive, local, {
      node: 'page1',
      scope: 'page',
      format: 'docx',
      folder: null,
      folderName: 'Lab reports',
      replace: copy.remote,
      host,
    });
    expect(files.size).toBe(1);
    expect(files.get('file1')).toMatchObject({ content: 'WORD-FILE-2', versions: 2 });
    // Still one link for the page, not two.
    expect(await loadCopies(host)).toHaveLength(1);
  });

  it('turns a Word file into a Google Doc when asked', async () => {
    const server = new MockServer();
    const { files } = addDrive(server, folders);
    const { client, host, local } = await rig({ google: 'sam@example.com' }, server);
    await sendFile(driveDestination({ client, host }), local, {
      node: 'page1',
      scope: 'page',
      format: 'gdoc',
      folder: null,
      folderName: 'My Drive',
      host,
    });
    expect(files.get('file1')).toMatchObject({ name: 'Cell notes', mimeType: 'application/vnd.google-apps.document' });
  });

  it('does not link a selection, which cannot be made again', async () => {
    const server = new MockServer();
    addDrive(server, folders);
    const { client, host, local } = await rig({ google: 'sam@example.com' }, server);
    await sendFile(driveDestination({ client, host }), local, {
      node: 'page1',
      scope: 'selection',
      format: 'docx',
      folder: null,
      folderName: 'My Drive',
      host,
    });
    expect(await loadCopies(host)).toEqual([]);
  });
});

describe('OneDrive', () => {
  const items = [
    { id: 'a', name: 'Notes' },
    { id: 'b', name: 'Readme.txt', file: true },
    { id: 'c', name: 'School', parent: undefined },
    { id: 'd', name: 'Biology', parent: 'c' },
  ];

  it('lists only folders', async () => {
    const server = new MockServer();
    addOneDrive(server, items);
    const { client, host } = await rig({ microsoft: 'sam@example.com' }, server);
    const onedrive = onedriveDestination({ client, host });
    expect((await onedrive.folders(null)).map((one) => one.name)).toEqual(['Notes', 'School']);
    expect((await onedrive.folders('c')).map((one) => one.name)).toEqual(['Biology']);
  });

  it('sends into a folder, renames rather than overwrites, and replaces its own copy', async () => {
    const server = new MockServer();
    const { files } = addOneDrive(server, items);
    const { client, host, local } = await rig({ microsoft: 'sam@example.com' }, server);
    const onedrive = onedriveDestination({ client, host });
    const first = await sendFile(onedrive, local, {
      node: 'sec1',
      scope: 'section',
      format: 'docx',
      folder: 'd',
      folderName: 'Biology',
      host,
    });
    const second = await sendFile(onedrive, local, {
      node: 'sec2',
      scope: 'section',
      format: 'docx',
      folder: 'd',
      folderName: 'Biology',
      host,
    });
    expect(files.get(first.remote)?.name).toBe('Cell notes.docx');
    expect(files.get(second.remote)?.name).toBe('Cell notes.docx 1');
    await host.tempWrite('Cell notes.docx', { kind: 'text', text: 'WORD-FILE-2' });
    await sendFile(onedrive, local, {
      node: 'sec1',
      scope: 'section',
      format: 'docx',
      folder: null,
      folderName: 'Biology',
      replace: first.remote,
      host,
    });
    expect(files.get(first.remote)).toMatchObject({ content: 'WORD-FILE-2', versions: 2 });
  });
});

describe('the link between a page and its copy', () => {
  it('finds the copies of a page and the section and notebook it sits in', () => {
    const base = {
      service: 'drive',
      remote: 'r',
      name: 'n',
      link: '',
      folder: '',
      format: 'docx',
      sentAt: '',
    } as const;
    const copies = [
      { ...base, node: 'page1', scope: 'page' },
      { ...base, node: 'sec1', scope: 'section' },
      { ...base, node: 'other', scope: 'page' },
    ] as const;
    expect(copiesOf(copies, ['page1', 'sec1', 'nb1']).map((one) => one.node)).toEqual(['page1', 'sec1']);
  });

  it('counts a page as changed only when it changed after the copy was sent', () => {
    expect(changedSince({ sentAt: '2026-10-01T10:00:00Z' }, '2026-10-01T10:00:01Z')).toBe(true);
    expect(changedSince({ sentAt: '2026-10-01T10:00:00Z' }, '2026-10-01T09:00:00Z')).toBe(false);
    expect(changedSince({ sentAt: 'nonsense' }, '2026-10-01T09:00:00Z')).toBe(false);
  });

  it('picks the Dropbox, Box, and WebDAV copies a sync sends again', () => {
    const base = {
      remote: 'r',
      name: 'n',
      link: '',
      folder: '',
      format: 'pdf',
      sentAt: '2026-10-01T10:00:00Z',
    } as const;
    const copies = [
      { ...base, service: 'dropbox', node: 'changed', scope: 'page' },
      { ...base, service: 'box', node: 'quiet', scope: 'page' },
      { ...base, service: 'webdav', node: 'sec', scope: 'section' },
      { ...base, service: 'drive', node: 'changed', scope: 'page' },
      { ...base, service: 'dropbox', node: 'changed', scope: 'page', format: 'png' },
    ] as const;
    const modified = (node: string) => (node === 'quiet' ? '2026-10-01T09:00:00Z' : '2026-10-02T09:00:00Z');
    const due = copiesDue(copies, ['dropbox', 'box', 'webdav'], modified);
    expect(due.map((one) => [one.service, one.node].join(':'))).toEqual(['dropbox:changed', 'webdav:sec']);
  });

  it('offers the types each service can take', () => {
    expect(formatsFor('drive', 'page')).toEqual(['pdf', 'docx', 'xlsx', 'pptx', 'gdoc', 'gsheet', 'gslides']);
    expect(formatsFor('onedrive', 'page')).toEqual(['pdf', 'docx', 'xlsx', 'pptx']);
    expect(formatsFor('onedrive', 'notebook')).toEqual(['docx', 'xlsx', 'pptx']);
    expect(formatsFor('drive', 'selection')).toEqual(['png', 'docx', 'gdoc']);
  });
});

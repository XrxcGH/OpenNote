// Google Docs, Sheets, and Slides against a mock Drive: the recent files of each kind, the export Drive makes of one, a
// refusal said, and an Office file sent to be converted to a Google Sheet or Slides file.
import { describe, expect, it } from 'vitest';
import { addDrive } from '../../../../../tests/mock-servers/storage';
import { MockServer } from '../../../../../tests/mock-servers/server';
import { ConnectorHttpError, createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { driveDestination } from '../sendto/drive';
import { sendFile } from '../sendto/commands';
import { formatsFor } from '../sendto/commands';
import { OFFICE, officeOf, XLSX } from '../sendto/types';
import { fetchDoc, KINDS, recentDocs } from './import';

const docs = [
  {
    id: 'd1',
    name: 'Cell lecture',
    mimeType: KINDS.docs.google,
    modified: '2026-10-02T10:00:00Z',
    exported: 'DOCX-BYTES',
  },
  { id: 'd2', name: 'Old essay', mimeType: KINDS.docs.google, modified: '2026-09-01T10:00:00Z', exported: 'DOCX-OLD' },
  {
    id: 's1',
    name: 'Lab results',
    mimeType: KINDS.sheets.google,
    modified: '2026-10-03T10:00:00Z',
    exported: 'XLSX-BYTES',
  },
  {
    id: 'p1',
    name: 'Mitosis / Meiosis',
    mimeType: KINDS.slides.google,
    modified: '2026-10-01T10:00:00Z',
    exported: 'PPTX-BYTES',
  },
];

async function rig(server: MockServer) {
  const connectors = createFakeConnectors({ connected: { google: 'sam@example.com' }, respond: server.respond });
  return { client: connectors.client, host: createFakeAccountsHost(() => connectors.client) };
}

describe('importing from Google', () => {
  it('lists the newest files of one kind', async () => {
    const server = new MockServer();
    addDrive(server, [], 100, docs);
    const { client } = await rig(server);
    expect((await recentDocs(client, 'docs')).map((one) => one.name)).toEqual(['Cell lecture', 'Old essay']);
    expect((await recentDocs(client, 'sheets')).map((one) => one.name)).toEqual(['Lab results']);
    expect(await recentDocs(client, 'docs', 1)).toHaveLength(1);
  });

  it('has Drive export the file as an Office file and keeps it in the transfer folder', async () => {
    const server = new MockServer();
    addDrive(server, [], 100, docs);
    const { client, host } = await rig(server);
    const [sheet] = await recentDocs(client, 'sheets');
    if (!sheet) throw new Error('no sheet');
    const path = await fetchDoc(host, 'sheets', sheet);
    expect(path.endsWith('Lab results.xlsx')).toBe(true);
    expect(new TextDecoder().decode(host.files.get('Lab results.xlsx'))).toBe('XLSX-BYTES');
    const asked = server.requests.find((one) => one.path.endsWith('/export'));
    expect(asked?.query.mimeType).toBe(KINDS.sheets.exportAs);
  });

  it('makes a safe file name from a title with a slash', async () => {
    const server = new MockServer();
    addDrive(server, [], 100, docs);
    const { client, host } = await rig(server);
    const [slides] = await recentDocs(client, 'slides');
    if (!slides) throw new Error('no slides');
    expect((await fetchDoc(host, 'slides', slides)).endsWith('Mitosis Meiosis.pptx')).toBe(true);
  });

  it('says so when Drive refuses the export', async () => {
    const server = new MockServer();
    addDrive(server, [], 100, []);
    const { host } = await rig(server);
    await expect(fetchDoc(host, 'docs', { id: 'gone', name: 'Gone', modified: '' })).rejects.toBeInstanceOf(
      ConnectorHttpError,
    );
  });
});

describe('exporting to Google', () => {
  it('converts an Excel file to a Google Sheet and drops the extension from the name', async () => {
    const server = new MockServer();
    const { files } = addDrive(server, []);
    const { client, host } = await rig(server);
    await host.tempWrite('Tables.xlsx', { kind: 'text', text: 'XLSX-FILE' });
    await sendFile(
      driveDestination({ client, host }),
      { file: 'Tables.xlsx', name: 'Tables.xlsx', mime: XLSX },
      { node: 'n', scope: 'page', format: 'gsheet', folder: null, folderName: 'My Drive', host },
    );
    expect(files.get('file1')).toMatchObject({ name: 'Tables', mimeType: OFFICE.xlsx.convertTo });
  });

  it('knows which Office file each Google type is made from', () => {
    expect(officeOf('gslides')).toEqual({ type: 'pptx', convert: true });
    expect(officeOf('pdf')).toBeNull();
    expect(formatsFor('drive', 'section')).toEqual(['docx', 'xlsx', 'pptx', 'gdoc', 'gsheet', 'gslides']);
    expect(formatsFor('onedrive', 'page')).toEqual(['pdf', 'docx', 'xlsx', 'pptx']);
  });
});

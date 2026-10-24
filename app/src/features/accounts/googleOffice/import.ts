// Google Docs, Sheets, and Slides into OpenNote: the recent files of a kind in the person's Drive, and one of them
// exported by Drive as a Word, Excel, or PowerPoint file in the transfer folder. The importers OpenNote already has for
// those files do the rest (Sheets become table pages, Slides become a page for each slide to write on), and the person
// sees their review and loss report before anything is added.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import { fileNameOf } from '../sendto/render';

export type OfficeKind = 'docs' | 'sheets' | 'slides';

export const KINDS: Record<OfficeKind, { google: string; exportAs: string; extension: 'docx' | 'xlsx' | 'pptx' }> = {
  docs: {
    google: 'application/vnd.google-apps.document',
    exportAs: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  },
  sheets: {
    google: 'application/vnd.google-apps.spreadsheet',
    exportAs: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
  slides: {
    google: 'application/vnd.google-apps.presentation',
    exportAs: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
  },
};

const FILES = 'https://www.googleapis.com/drive/v3/files';

export interface DriveDoc {
  id: string;
  name: string;
  modified: string;
}

interface FileList {
  files?: { id: string; name: string; modifiedTime?: string }[];
}

/** The files of a kind that changed most recently, newest first. */
export async function recentDocs(client: ConnectorsClient, kind: OfficeKind, limit = 50): Promise<DriveDoc[]> {
  const reply = await requestConnector<FileList>(
    'google',
    ['driveRead'],
    {
      url: FILES,
      query: {
        q: `mimeType='${KINDS[kind].google}' and trashed=false`,
        fields: 'files(id,name,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: limit,
      },
    },
    client,
  );
  return (reply.data?.files ?? []).map((one) => ({ id: one.id, name: one.name, modified: one.modifiedTime ?? '' }));
}

/** Has Drive export the file and keeps it in the transfer folder. Answers the file's path. */
export async function fetchDoc(host: AccountsHost, kind: OfficeKind, doc: DriveDoc): Promise<string> {
  const { extension, exportAs } = KINDS[kind];
  const url = `${FILES}/${encodeURIComponent(doc.id)}/export?mimeType=${encodeURIComponent(exportAs)}`;
  const name = fileNameOf(doc.name, extension);
  const got = await host.download('google', ['driveRead'], { method: 'GET', url }, name);
  if (got.status < 200 || got.status >= 300) throw new ConnectorHttpError(got.status, got.body);
  return got.path;
}

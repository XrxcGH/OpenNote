// Google Drive: the folders to choose from (read with the Drive read access), and a file sent in one multipart request
// (the metadata and the bytes together), new or over a copy sent before. A Word file can be turned into a Google Doc
// as it arrives. The app only changes files it made itself (the `drive.file` access).
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import type { Destination, LocalFile, RemoteFolder, Sent } from './types';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_PAGES = 20;

interface FileList {
  files?: { id: string; name: string }[];
  nextPageToken?: string;
}

interface DriveFile {
  id?: string;
  name?: string;
  webViewLink?: string;
}

/** An ID for Drive's search language: the quote and the backslash are the only characters that need care. */
const quoted = (id: string): string => `'${id.replace(/[\\']/g, '')}'`;

export function driveDestination(deps: { client: ConnectorsClient; host: AccountsHost }): Destination {
  const { client, host } = deps;

  async function multipart(
    method: 'POST' | 'PATCH',
    url: string,
    metadata: Record<string, unknown>,
    local: LocalFile,
  ): Promise<Sent> {
    const boundary = `opennote${Math.random().toString(36).slice(2, 12)}`;
    const answer = await host.upload(
      'google',
      ['driveFiles'],
      { method, url },
      [
        {
          kind: 'text',
          text:
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
            `--${boundary}\r\nContent-Type: ${local.mime}\r\n\r\n`,
        },
        { kind: 'file', file: local.file },
        { kind: 'text', text: `\r\n--${boundary}--` },
      ],
      `multipart/related; boundary=${boundary}`,
    );
    if (answer.status < 200 || answer.status >= 300) throw new ConnectorHttpError(answer.status, answer.body);
    const file = JSON.parse(answer.body || '{}') as DriveFile;
    if (!file.id) throw new ConnectorHttpError(502, answer.body);
    return { id: file.id, name: file.name ?? local.name, link: file.webViewLink ?? '' };
  }

  return {
    service: 'drive',
    async folders(parent) {
      const found: RemoteFolder[] = [];
      let token: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const reply = await requestConnector<FileList>(
          'google',
          ['driveRead'],
          {
            url: FILES,
            query: {
              q: `${quoted(parent ?? 'root')} in parents and mimeType='${FOLDER}' and trashed=false`,
              fields: 'files(id,name),nextPageToken',
              pageSize: 100,
              orderBy: 'name',
              pageToken: token,
            },
          },
          client,
        );
        for (const one of reply.data?.files ?? []) found.push({ id: one.id, name: one.name });
        token = reply.data?.nextPageToken;
        if (!token) break;
      }
      return found;
    },
    send(local, folder, convertTo) {
      return multipart(
        'POST',
        `${UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`,
        {
          name: convertTo ? local.name.replace(/\.(docx|xlsx|pptx)$/i, '') : local.name,
          ...(folder ? { parents: [folder] } : {}),
          ...(convertTo ? { mimeType: convertTo } : {}),
        },
        local,
      );
    },
    replace(local, remote) {
      return multipart(
        'PATCH',
        `${UPLOAD}/${encodeURIComponent(remote)}?uploadType=multipart&fields=id,name,webViewLink`,
        {},
        local,
      );
    },
  };
}

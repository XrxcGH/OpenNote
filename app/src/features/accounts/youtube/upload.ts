// Uploading a video to YouTube the way YouTube's resumable upload works: one request that says what the video is and
// answers with an upload address, then the file in pieces, each with the range it covers. YouTube answers 308 while it
// wants more and 200 or 201 with the video's ID when it has it all. A video is only ever private or unlisted from here.

import { ConnectorHttpError } from '../../connectors';
import type { ConnectorResponse, ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';

export type YoutubePrivacy = 'private' | 'unlisted';

/** A multiple of 256 KiB, which YouTube requires of every piece but the last. */
export const CHUNK = 8 * 1024 * 1024;

const START = 'https://www.googleapis.com/upload/youtube/v3/videos';
const ACCESS = ['youtubeUpload'] as const;

export interface UploadInput {
  /** The file in the transfer folder. */
  file: string;
  size: number;
  title: string;
  description?: string;
  privacy: YoutubePrivacy;
}

export interface Uploaded {
  id: string;
  url: string;
}

function failure(response: ConnectorResponse): ConnectorHttpError {
  return new ConnectorHttpError(response.status, response.body);
}

/** Sends one piece, and once more when YouTube was busy. */
async function sendPiece(
  host: AccountsHost,
  address: string,
  input: UploadInput,
  start: number,
): Promise<ConnectorResponse> {
  const length = Math.min(CHUNK, input.size - start);
  const request = {
    method: 'PUT' as const,
    url: address,
    headers: { 'Content-Range': `bytes ${start}-${start + length - 1}/${input.size}` },
  };
  const parts = [{ kind: 'file' as const, file: input.file, offset: start, length }];
  const first = await host.upload('google', ACCESS, request, parts, 'video/mp4');
  if (first.status < 500) return first;
  return host.upload('google', ACCESS, request, parts, 'video/mp4');
}

export async function uploadVideo(
  deps: { client: ConnectorsClient; host: AccountsHost },
  input: UploadInput,
  progress: (share: number) => void = () => undefined,
): Promise<Uploaded> {
  if (input.size <= 0) throw new ConnectorHttpError(400, JSON.stringify({ error: 'The video is empty.' }));
  const started = await deps.client.request('google', [...ACCESS], {
    method: 'POST',
    url: `${START}?uploadType=resumable&part=snippet,status`,
    headers: { 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(input.size) },
    contentType: 'application/json; charset=UTF-8',
    body: JSON.stringify({
      snippet: { title: input.title.slice(0, 100), description: input.description ?? '' },
      status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (started.status < 200 || started.status >= 300) throw failure(started);
  const address = started.location;
  if (!address) throw new ConnectorHttpError(502, '');
  let at = 0;
  for (;;) {
    const answer = await sendPiece(deps.host, address, input, at);
    at += Math.min(CHUNK, input.size - at);
    progress(Math.min(1, at / input.size));
    if (answer.status === 200 || answer.status === 201) {
      const id = (JSON.parse(answer.body || '{}') as { id?: string }).id;
      if (!id) throw new ConnectorHttpError(502, answer.body);
      return { id, url: `https://www.youtube.com/watch?v=${id}` };
    }
    if (answer.status !== 308 || at >= input.size) throw failure(answer);
  }
}

// Fetching a video's captions through the person's own account: YouTube's Data API (the caption list, then the track as
// SubRip; YouTube lets only the video's owner download a track) and Vimeo's text tracks (a list with a link to each
// WebVTT file). The words become the video's transcript on the block. Nothing leaves the device but the video's ID.
import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import { parseCaptions } from './captions';
import type { EmbedTranscript } from './model';

/** Why captions weren't read, when the reason is one the person can act on. */
export class CaptionsError extends Error {
  readonly reason: 'none' | 'notOwner';

  constructor(reason: 'none' | 'notOwner') {
    super(reason);
    this.name = 'CaptionsError';
    this.reason = reason;
  }
}

const base = (language: string): string => language.toLowerCase().split(/[-_]/)[0] ?? '';

/** The track in the language the person reads, else a hand-made one, else the first. */
export function pickTrack<T extends { language: string; machine?: boolean }>(
  tracks: readonly T[],
  wanted: string,
): T | null {
  const mine = tracks.filter((track) => base(track.language) === base(wanted));
  const people = (list: readonly T[]) => list.find((track) => !track.machine);
  return people(mine) ?? mine[0] ?? people(tracks) ?? tracks[0] ?? null;
}

interface YoutubeList {
  items?: { id: string; snippet?: { language?: string; trackKind?: string } }[];
}

async function youtube(client: ConnectorsClient | undefined, id: string, wanted: string): Promise<EmbedTranscript> {
  const list = await requestConnector<YoutubeList>(
    'google',
    ['youtubeCaptions'],
    { url: 'https://youtube.googleapis.com/youtube/v3/captions', query: { part: 'snippet', videoId: id } },
    client,
  );
  const tracks = (list.data?.items ?? []).map((item) => ({
    id: item.id,
    language: item.snippet?.language ?? '',
    machine: item.snippet?.trackKind === 'ASR',
  }));
  const track = pickTrack(tracks, wanted);
  if (!track) throw new CaptionsError('none');
  let text: string;
  try {
    const file = await requestConnector(
      'google',
      ['youtubeCaptions'],
      {
        url: `https://youtube.googleapis.com/youtube/v3/captions/${encodeURIComponent(track.id)}`,
        query: { tfmt: 'srt' },
      },
      client,
    );
    text = file.text;
  } catch (error) {
    if (error instanceof ConnectorHttpError && error.status === 403) throw new CaptionsError('notOwner');
    throw error;
  }
  const lines = parseCaptions(text);
  if (lines.length === 0) throw new CaptionsError('none');
  return { language: track.language, source: 'youtube', lines };
}

interface VimeoList {
  data?: { active?: boolean; language?: string; link?: string }[];
}

async function vimeo(client: ConnectorsClient | undefined, id: string, wanted: string): Promise<EmbedTranscript> {
  const list = await requestConnector<VimeoList>(
    'vimeo',
    ['vimeoRead'],
    { url: `https://api.vimeo.com/videos/${encodeURIComponent(id)}/texttracks` },
    client,
  );
  const tracks = (list.data?.data ?? [])
    .filter((item) => item.active !== false && typeof item.link === 'string')
    .map((item) => ({ language: item.language ?? '', link: item.link ?? '' }));
  const track = pickTrack(tracks, wanted);
  if (!track) throw new CaptionsError('none');
  const file = await requestConnector('vimeo', ['vimeoRead'], { url: track.link }, client);
  const lines = parseCaptions(file.text);
  if (lines.length === 0) throw new CaptionsError('none');
  return { language: track.language, source: 'vimeo', lines };
}

/** The transcript of a YouTube or Vimeo video. Throws CaptionsError for no captions or a video that isn't the person's. */
export function fetchTranscript(
  client: ConnectorsClient | undefined,
  provider: 'youtube' | 'vimeo',
  id: string,
  wanted: string,
): Promise<EmbedTranscript> {
  return provider === 'youtube' ? youtube(client, id, wanted) : vimeo(client, id, wanted);
}

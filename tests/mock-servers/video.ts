// Mocks of the caption endpoints of YouTube (Data API v3: a list of caption tracks, then a download that only the video's
// owner may make) and Vimeo (a list of text tracks, each with a link to its WebVTT file).
import { MockServer } from './server';

export interface MockYoutubeTrack {
  id: string;
  language: string;
  /** "standard" or "ASR" (made by speech recognition). */
  kind?: string;
  srt: string;
}

export function addYoutubeCaptions(server: MockServer, videos: Record<string, MockYoutubeTrack[]>, owned = true): void {
  server.route('GET youtube.googleapis.com/youtube/v3/captions', (request) => {
    const tracks = videos[request.query.videoId ?? ''];
    if (!tracks) return { json: { items: [] } };
    return {
      json: {
        items: tracks.map((track) => ({
          id: track.id,
          snippet: { language: track.language, trackKind: track.kind ?? 'standard' },
        })),
      },
    };
  });
  server.route('GET youtube.googleapis.com/youtube/v3/captions/:id', (request, params) => {
    if (!owned) {
      return {
        status: 403,
        json: { error: { message: 'The permissions associated with the request are not sufficient.' } },
      };
    }
    for (const tracks of Object.values(videos)) {
      const track = tracks.find((one) => one.id === params.id);
      if (track) {
        return request.query.tfmt === 'srt' ? { text: track.srt, contentType: 'application/x-subrip' } : undefined;
      }
    }
    return undefined;
  });
}

export interface MockVimeoTrack {
  language: string;
  active?: boolean;
  vtt: string;
}

export function addVimeoCaptions(server: MockServer, videos: Record<string, MockVimeoTrack[]>): void {
  server.route('GET api.vimeo.com/videos/:id/texttracks', (_request, params) => {
    const tracks = videos[params.id ?? ''];
    if (!tracks) return undefined;
    return {
      json: {
        data: tracks.map((track, at) => ({
          active: track.active ?? true,
          language: track.language,
          type: 'captions',
          link: `https://captions.cloud.vimeo.com/${params.id}/${at}.vtt`,
        })),
      },
    };
  });
  server.route('GET captions.cloud.vimeo.com/:id/:file', (_request, params) => {
    const tracks = videos[params.id ?? ''];
    const track = tracks?.[Number((params.file ?? '').replace('.vtt', ''))];
    return track ? { text: track.vtt, contentType: 'text/vtt' } : undefined;
  });
}

export interface MockUploads {
  /** The privacy and title each started upload asked for. */
  started: { title: string; privacy: string; length: string }[];
  /** The ranges received, in order, and the bytes of the whole file so far. */
  ranges: string[];
  received: number;
  /** Set to make the next piece fail with this status once. */
  failOnce?: number;
}

/** YouTube's resumable upload: a start request that answers with an address, then pieces with a range each. */
export function addYoutubeUpload(server: MockServer, id = 'vid12345678'): MockUploads {
  const state: MockUploads = { started: [], ranges: [], received: 0 };
  let total = 0;
  server.route('POST www.googleapis.com/upload/youtube/v3/videos', (request) => {
    const body = request.json<{ snippet?: { title?: string }; status?: { privacyStatus?: string } }>();
    state.started.push({
      title: body?.snippet?.title ?? '',
      privacy: body?.status?.privacyStatus ?? '',
      length: request.headers['x-upload-content-length'] ?? '',
    });
    total = Number(request.headers['x-upload-content-length'] ?? 0);
    return { json: {}, location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=u1' };
  });
  server.route('PUT www.googleapis.com/upload/youtube/v3/videos', (request) => {
    if (state.failOnce) {
      const status = state.failOnce;
      state.failOnce = undefined;
      return { status, json: { error: { message: 'Try again.' } } };
    }
    state.ranges.push(request.headers['content-range'] ?? '');
    state.received += request.body.length;
    return state.received >= total ? { json: { id } } : { status: 308, text: '' };
  });
  return state;
}

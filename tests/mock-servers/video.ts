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

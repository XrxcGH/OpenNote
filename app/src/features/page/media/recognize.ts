// Recognizing a pasted link as something that can sit on a page as a player or a live embed. Only the sites listed here
// are ever shown in a frame, and the frame address is built from the ID found in the link, never taken from it. The
// hosts the frames load from are the app's frame list (app/src-tauri/tauri.conf.json), which a test keeps in step.

export type PlayerProvider = 'youtube' | 'vimeo' | 'applePodcasts' | 'spotify';
export type LiveProvider = 'desmos' | 'geogebra' | 'figma' | 'miro' | 'lucidchart';
export type EmbedProvider = PlayerProvider | LiveProvider;
export type EmbedKind = 'player' | 'live';

export interface Recognized {
  kind: EmbedKind;
  provider: EmbedProvider;
  /** The site's ID for the video, episode, graph, or board. */
  id: string;
  /** The link as the site writes it, with nothing that tracks the person. */
  url: string;
  /** The address the frame loads. */
  embedUrl: string;
  /** A name for it before the site has been asked. */
  title: string;
  /** Where the site gives the video's or graph's title and picture, if it does. */
  previewUrl: string | null;
  /** A picture at a fixed address, for sites that have one. */
  pictureUrl: string | null;
  /** Whether the frame tells the page where the playhead is, so notes can be time-stamped. */
  playhead: boolean;
  /** Where in the video it starts, in seconds. */
  startSec: number | null;
}

/** The hosts frames load from. */
export const FRAME_HOSTS: readonly string[] = [
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'embed.podcasts.apple.com',
  'open.spotify.com',
  'www.desmos.com',
  'www.geogebra.org',
  'www.figma.com',
  'miro.com',
  'lucid.app',
];

/** Whether the address is on a host a frame may load from, over https. */
export function isFrameAddress(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' && !url.port && !url.username && FRAME_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;
const DESMOS_ID = /^[A-Za-z0-9]{5,24}$/;
const GEOGEBRA_ID = /^[A-Za-z0-9]{4,24}$/;
const FIGMA_KEY = /^[A-Za-z0-9]{10,40}$/;
const MIRO_ID = /^[A-Za-z0-9_=-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPOTIFY_ID = /^[A-Za-z0-9]{10,32}$/;

/** "90", "1m30s", "1h2m3s", or "2:05" as seconds; null when it isn't a time. */
export function secondsOf(text: string | null): number | null {
  if (!text) return null;
  const plain = /^(\d{1,6})s?$/.exec(text);
  if (plain) return Number(plain[1]);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (parts && (parts[1] || parts[2] || parts[3])) {
    return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
  }
  const clock = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) {
    return clock[3] === undefined
      ? Number(clock[1]) * 60 + Number(clock[2])
      : Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  return null;
}

const base = (
  kind: EmbedKind,
  provider: EmbedProvider,
  id: string,
  rest: Partial<Recognized> & Pick<Recognized, 'url' | 'embedUrl' | 'title'>,
): Recognized => ({
  kind,
  provider,
  id,
  previewUrl: null,
  pictureUrl: null,
  playhead: false,
  startSec: null,
  ...rest,
});

function youtube(url: URL): Recognized | null {
  const host = url.hostname.replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? '';
  else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') id = url.searchParams.get('v') ?? '';
    else if (first === 'shorts' || first === 'embed' || first === 'live' || first === 'v') id = second ?? '';
  } else return null;
  if (!YOUTUBE_ID.test(id)) return null;
  const startSec = secondsOf(url.searchParams.get('t') ?? url.searchParams.get('start'));
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  embed.searchParams.set('enablejsapi', '1');
  embed.searchParams.set('rel', '0');
  embed.searchParams.set('playsinline', '1');
  if (startSec) embed.searchParams.set('start', String(startSec));
  return base('player', 'youtube', id, {
    url: watch,
    embedUrl: embed.toString(),
    title: 'YouTube video',
    previewUrl: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
    pictureUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    playhead: true,
    startSec,
  });
}

function vimeo(url: URL): Recognized | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const at = segments.findIndex((one) => VIMEO_ID.test(one));
  const id = at < 0 ? '' : (segments[at] ?? '');
  if (!id) return null;
  // An unlisted video carries a hash, as the next segment or as ?h=.
  const next = segments[at + 1];
  const hash = url.searchParams.get('h') ?? (next && /^[0-9a-f]{8,12}$/i.test(next) ? next : null);
  const link = hash ? `https://vimeo.com/${id}/${hash}` : `https://vimeo.com/${id}`;
  const embed = new URL(`https://player.vimeo.com/video/${id}`);
  embed.searchParams.set('dnt', '1');
  if (hash) embed.searchParams.set('h', hash);
  const startSec = secondsOf(url.hash.startsWith('#t=') ? url.hash.slice(3) : null);
  return base('player', 'vimeo', id, {
    url: link,
    embedUrl: embed.toString(),
    title: 'Vimeo video',
    previewUrl: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(link)}`,
    playhead: true,
    startSec,
  });
}

function podcast(url: URL): Recognized | null {
  if (url.hostname === 'podcasts.apple.com') {
    const match = /^\/([a-z]{2})\/podcast\/([^/]+)\/id(\d+)$/.exec(url.pathname);
    if (!match) return null;
    const episode = url.searchParams.get('i');
    const path = `/${match[1]}/podcast/${match[2]}/id${match[3]}`;
    const query = episode && /^\d+$/.test(episode) ? `?i=${episode}` : '';
    return base('player', 'applePodcasts', `${match[3]}${episode ? `:${episode}` : ''}`, {
      url: `https://podcasts.apple.com${path}${query}`,
      embedUrl: `https://embed.podcasts.apple.com${path}${query}`,
      title: 'Podcast',
    });
  }
  if (url.hostname === 'open.spotify.com') {
    const [, kind, id] = url.pathname.split('/');
    if ((kind !== 'episode' && kind !== 'show') || !id || !SPOTIFY_ID.test(id)) return null;
    const link = `https://open.spotify.com/${kind}/${id}`;
    return base('player', 'spotify', id, {
      url: link,
      embedUrl: `https://open.spotify.com/embed/${kind}/${id}`,
      title: kind === 'show' ? 'Podcast' : 'Podcast episode',
      previewUrl: `https://open.spotify.com/oembed?url=${encodeURIComponent(link)}`,
    });
  }
  return null;
}

function desmos(url: URL): Recognized | null {
  if (url.hostname !== 'www.desmos.com' && url.hostname !== 'desmos.com') return null;
  const [, tool, id] = url.pathname.split('/');
  if ((tool !== 'calculator' && tool !== 'geometry' && tool !== '3d') || !id || !DESMOS_ID.test(id)) return null;
  return base('live', 'desmos', id, {
    url: `https://www.desmos.com/${tool}/${id}`,
    embedUrl: `https://www.desmos.com/${tool}/${id}?embed`,
    title: 'Desmos graph',
    pictureUrl: tool === 'calculator' ? `https://saved-work.desmos.com/calc_thumbs/production/${id}.png` : null,
  });
}

function geogebra(url: URL): Recognized | null {
  if (url.hostname !== 'www.geogebra.org' && url.hostname !== 'geogebra.org') return null;
  const [, tool, id] = url.pathname.split('/');
  if (!['m', 'classic', 'graphing', 'geometry', '3d', 'material'].includes(tool ?? '') || !id) return null;
  if (!GEOGEBRA_ID.test(id)) return null;
  return base('live', 'geogebra', id, {
    url: `https://www.geogebra.org/m/${id}`,
    embedUrl: `https://www.geogebra.org/material/iframe/id/${id}`,
    title: 'GeoGebra',
  });
}

function figma(url: URL): Recognized | null {
  if (url.hostname !== 'www.figma.com' && url.hostname !== 'figma.com') return null;
  const [, tool, key] = url.pathname.split('/');
  if (!['file', 'design', 'proto', 'board', 'slides', 'deck'].includes(tool ?? '') || !key || !FIGMA_KEY.test(key)) {
    return null;
  }
  const link = new URL(`https://www.figma.com/${tool}/${key}`);
  const node = url.searchParams.get('node-id');
  if (node && /^[0-9A-Za-z:%-]{1,40}$/.test(node)) link.searchParams.set('node-id', node);
  const embed = new URL('https://www.figma.com/embed');
  embed.searchParams.set('embed_host', 'opennote');
  embed.searchParams.set('url', link.toString());
  return base('live', 'figma', key, { url: link.toString(), embedUrl: embed.toString(), title: 'Figma' });
}

function miro(url: URL): Recognized | null {
  if (url.hostname !== 'miro.com' && url.hostname !== 'www.miro.com') return null;
  const [, app, kind, id] = url.pathname.split('/');
  if (app !== 'app' || kind !== 'board' || !id || !MIRO_ID.test(id)) return null;
  return base('live', 'miro', id, {
    url: `https://miro.com/app/board/${id}/`,
    embedUrl: `https://miro.com/app/embed/${id}/`,
    title: 'Miro board',
  });
}

function lucid(url: URL): Recognized | null {
  if (url.hostname !== 'lucid.app' && url.hostname !== 'www.lucid.app') return null;
  const [, tool, id] = url.pathname.split('/');
  if ((tool !== 'lucidchart' && tool !== 'documents') || !id || !UUID.test(id)) return null;
  return base('live', 'lucidchart', id, {
    url: `https://lucid.app/lucidchart/${id}/view`,
    embedUrl: `https://lucid.app/documents/embedded/${id}`,
    title: 'Lucidchart',
  });
}

const RECOGNIZERS = [youtube, vimeo, podcast, desmos, geogebra, figma, miro, lucid] as const;

/** What a pasted link is, or null when it is not a link to one of the sites. Only https links count. */
export function recognize(input: string): Recognized | null {
  const text = input.trim();
  if (text === '' || /\s/.test(text) || text.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) return null;
  for (const recognizer of RECOGNIZERS) {
    const found = recognizer(url);
    if (found && isFrameAddress(found.embedUrl)) return found;
  }
  return null;
}

/** The name shown for a provider. */
export const PROVIDER_NAME: Record<EmbedProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  applePodcasts: 'Apple Podcasts',
  spotify: 'Spotify',
  desmos: 'Desmos',
  geogebra: 'GeoGebra',
  figma: 'Figma',
  miro: 'Miro',
  lucidchart: 'Lucidchart',
};

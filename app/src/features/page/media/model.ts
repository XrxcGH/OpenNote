// What an embed block holds. Its data names the site and the item and keeps what the page needs offline: the title and
// the picture (a page asset), and a transcript when captions were fetched. The block is of one type for players and
// live embeds. A reader that does not know the type shows the fallback, which is the title and the link.
import type { BlockJson } from '../../../services/pages/types';
import { PROVIDER_NAME, recognize } from './recognize';
import type { EmbedKind, EmbedProvider, Recognized } from './recognize';

export const EMBED_TYPE = 'ext:org.opennote/embed';

export interface TranscriptLine {
  /** Where in the video the line starts. */
  startMs: number;
  text: string;
}

export interface EmbedTranscript {
  language: string;
  /** The site the captions came from. */
  source: 'youtube' | 'vimeo';
  lines: TranscriptLine[];
}

export interface EmbedData {
  kind: EmbedKind;
  provider: EmbedProvider;
  id: string;
  url: string;
  title: string;
  /** The page asset that holds the saved picture, when there is one. */
  thumb?: string;
  startSec?: number;
  transcript?: EmbedTranscript;
}

/** The data a new block starts with. */
export function dataFor(found: Recognized): EmbedData {
  return {
    kind: found.kind,
    provider: found.provider,
    id: found.id,
    url: found.url,
    title: found.title,
    ...(found.startSec ? { startSec: found.startSec } : {}),
  };
}

/** The embed a block holds, read defensively: the data came from a file that anyone may have edited. */
export function embedDataOf(
  block: Pick<BlockJson, 'data'>,
): (EmbedData & { embedUrl: string; playhead: boolean }) | null {
  const data = block.data as Partial<EmbedData>;
  if (typeof data.url !== 'string') return null;
  // The frame address is made again from the link, so a hand-edited file can't point the frame anywhere else.
  const found = recognize(data.url);
  if (!found) return null;
  const title = typeof data.title === 'string' && data.title !== '' ? data.title.slice(0, 300) : found.title;
  const lines = Array.isArray(data.transcript?.lines)
    ? data.transcript.lines.filter(
        (line): line is TranscriptLine => typeof line?.startMs === 'number' && typeof line.text === 'string',
      )
    : [];
  return {
    ...dataFor(found),
    title,
    ...(typeof data.thumb === 'string' ? { thumb: data.thumb } : {}),
    ...(typeof data.startSec === 'number' ? { startSec: data.startSec } : {}),
    ...(data.transcript && lines.length > 0
      ? {
          transcript: {
            language: typeof data.transcript.language === 'string' ? data.transcript.language : '',
            source: data.transcript.source === 'vimeo' ? 'vimeo' : 'youtube',
            lines,
          },
        }
      : {}),
    embedUrl: found.embedUrl,
    playhead: found.playhead,
  };
}

/** What a reader that doesn't know the block shows: the title as a link. */
export function fallbackFor(data: Pick<EmbedData, 'title' | 'url' | 'provider'>): { markdown: string } {
  const title = data.title.replace(/[[\]]/g, '');
  return { markdown: `[${title}](${data.url}) (${PROVIDER_NAME[data.provider]})` };
}

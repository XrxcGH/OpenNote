// What a local video block holds: the page asset with the video, its file name, and, when there are captions, the page
// asset with the WebVTT file. The block is of one type; a reader that doesn't know it shows the fallback.
import type { BlockJson } from '../../../services/pages/types';

export const VIDEO_TYPE = 'ext:org.opennote/video';

export interface VideoData {
  asset: string;
  name: string;
  /** The page asset with the captions, when there are some. */
  captions?: string;
  captionsName?: string;
}

/** The data a new block starts with. */
export const dataFor = (asset: string, name: string): VideoData => ({ asset, name });

/** What a reader that doesn't know the block shows. */
export const fallbackFor = (name: string): { markdown: string } => ({
  markdown: `Video: ${name.replace(/[[\]`*_]/g, '')}`,
});

/** The video a block holds, read defensively: the data came from a file that anyone may have edited. */
export function videoDataOf(block: Pick<BlockJson, 'data'>): VideoData | null {
  const data = block.data as Partial<VideoData>;
  if (typeof data.asset !== 'string' || data.asset === '') return null;
  return {
    asset: data.asset,
    name: typeof data.name === 'string' && data.name !== '' ? data.name.slice(0, 300) : 'video',
    ...(typeof data.captions === 'string' && data.captions !== ''
      ? {
          captions: data.captions,
          ...(typeof data.captionsName === 'string' ? { captionsName: data.captionsName.slice(0, 300) } : {}),
        }
      : {}),
  };
}

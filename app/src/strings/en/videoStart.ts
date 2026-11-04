// The video words start-up reads: the palette and slash commands, and what a video block says when its code can't
// load. The rest of video.ts joins this object when the video code loads (features/page/video/text.ts), so the
// player's and the import's messages are not in start-up.
import type { video as all } from './video';

export const videoStart = {
  commands: {
    insert: 'Insert video file',
    insertKeywords: 'video mp4 webm movie clip file local play embed',
    slash: 'Video file',
    captions: 'Add captions to a video',
    captionsKeywords: 'video captions subtitles vtt webvtt',
  },
  block: {
    unavailable: 'This video can’t be shown. The file is unchanged.',
  },
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in video.ts. */
export const video = videoStart as unknown as typeof all;

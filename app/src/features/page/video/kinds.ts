// Which files are local videos a page can play, and which caption files go with them. This file loads at start-up
// (the drop and paste watchers use it), so it holds only small checks. A file is a video when its name says mp4, m4v,
// or webm and its type, when it has one, agrees; the bytes are checked again before the file is stored.

export type VideoMime = 'video/mp4' | 'video/webm';

/** Larger videos are refused, as every attachment over this size is. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** A caption file is text; a megabyte is hours of speech. */
export const MAX_CAPTION_BYTES = 1024 * 1024;

const TYPES: Record<string, VideoMime> = {
  'video/mp4': 'video/mp4',
  'video/x-m4v': 'video/mp4',
  'video/webm': 'video/webm',
};

/** The type a video file is stored with, or null when it isn't an mp4 or webm file. */
export function videoMimeOf(file: Pick<File, 'name' | 'type'>): VideoMime | null {
  const name = file.name.toLowerCase();
  const byName: VideoMime | null = /\.(mp4|m4v)$/.test(name)
    ? 'video/mp4'
    : name.endsWith('.webm')
      ? 'video/webm'
      : null;
  if (!byName) return null;
  const type = file.type.toLowerCase();
  if (type === '') return byName;
  return TYPES[type] === byName ? byName : null;
}

/** Whether the first bytes are those of the format: an mp4 has `ftyp` at byte 4, a webm starts with an EBML header. */
export function bytesMatch(head: Uint8Array, mime: VideoMime): boolean {
  if (mime === 'video/webm') return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  return head.length >= 8 && String.fromCharCode(head[4] ?? 0, head[5] ?? 0, head[6] ?? 0, head[7] ?? 0) === 'ftyp';
}

/** Whether the file is a WebVTT caption file by name and type. */
export function isCaptionFile(file: Pick<File, 'name' | 'type'>): boolean {
  const type = file.type.toLowerCase();
  return file.name.toLowerCase().endsWith('.vtt') && (type === '' || type === 'text/vtt' || type === 'text/plain');
}

/** Whether the text is WebVTT: it starts with the signature, after a byte order mark if there is one. */
export function isWebVtt(text: string): boolean {
  return /^\uFEFF?WEBVTT(?:[ \t\r\n]|$)/.test(text);
}

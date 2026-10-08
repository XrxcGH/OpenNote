// The seam for search (Phase 12): the text inside images and handwriting, for the index to hold. Search asks here and
// gets the words with their boxes, so a hit can be marked on the image or the ink. Background indexing never asks
// the person anything and never reports an error: when a feature is off, flagged off, or missing what it needs, the
// answer is null, and the item is tried again later. Nothing leaves the device.
import { isEnabled } from '../../app/flags';
import { isIntelError } from '../../services/intel';
import type { InkStroke, Rect } from '../../services/intel';
import { readTextInImage } from './imageText';
import type { ReadImageOptions } from './imageText';
import { linesOf } from './ink';
import { isOn } from './choices';
import { intelClient, loadIntel } from './runtime';

export interface RecognizedWord {
  text: string;
  /** In image pixels for an image, and in page units for handwriting. */
  bounds: Rect;
}

export interface RecognizedText {
  source: 'image' | 'handwriting';
  /** The lines, joined with line breaks. */
  text: string;
  words: RecognizedWord[];
}

/** Whether the person has turned on what this kind of text needs, so search can say what is missing. */
export async function searchTextReady(source: RecognizedText['source']): Promise<boolean> {
  if (!isEnabled('intel.searchText')) return false;
  await loadIntel();
  return isOn(source === 'image' ? 'ocr' : 'handwriting');
}

/** Gives up quietly on anything but a request to stop. */
function unavailable(error: unknown): null {
  if (isIntelError(error, 'canceled')) throw error;
  return null;
}

/** The text in an image file, or null. */
export async function searchTextInImage(blob: Blob, options: ReadImageOptions = {}): Promise<RecognizedText | null> {
  if (!(await searchTextReady('image'))) return null;
  try {
    const result = await readTextInImage(blob, options);
    const lines = result.lines.map((line) => line.text.trim()).filter(Boolean);
    return {
      source: 'image',
      text: lines.join('\n'),
      words: result.lines.flatMap((line) => line.words.map((word) => ({ text: word.text, bounds: word.bounds }))),
    };
  } catch (error) {
    return unavailable(error);
  }
}

/** The text in handwriting, from strokes with their own transforms applied, or null. */
export async function searchTextInInk(strokes: InkStroke[]): Promise<RecognizedText | null> {
  if (strokes.length === 0 || !(await searchTextReady('handwriting'))) return null;
  try {
    const recognition = await (await intelClient()).recognizeInk(strokes, { kind: 'auto' });
    return {
      source: 'handwriting',
      text: linesOf(recognition).join('\n'),
      words: recognition.lines.flatMap((line) => line.words.map((word) => ({ text: word.text, bounds: word.bounds }))),
    };
  } catch (error) {
    return unavailable(error);
  }
}

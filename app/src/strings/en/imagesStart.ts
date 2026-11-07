// The image words start-up reads: the palette commands. The rest of images.ts joins this object when the image code
// loads (features/page/images/text.ts), so the dialog, toolbar, and import messages are not in start-up.
import type { images as all } from './images';

export const imagesStart = {
  insert: 'Image…',
  insertKeywords: 'picture photo screenshot file insert',
  crop: 'Crop image',
  cropKeywords: 'trim cut edges',
  altText: 'Alt text…',
  altTextKeywords: 'description accessibility screen reader decorative',
} as const;

/** The whole namespace as t() sees it. A test checks that these words are the same as in images.ts. */
export const images = imagesStart as unknown as typeof all;

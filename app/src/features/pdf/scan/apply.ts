// Scan cleanup on the page (A3-20): reading a picture's pixels, cleaning them, and putting the clean page in place of
// the photo, or adding several photos as a multi-page scan. The original photo stays in the page's assets and its
// block remembers it, so "Restore the original photo" brings it back. Each command is one step that one undo
// takes back.
import { newId } from '../../../editor/ids';
import type { BlockJson, Edit, ImportedAsset } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { EditTarget } from '../target';
import { cleanScan } from './clean';
import { findPage } from './clean';
import type { CleanResult, Pixels, Quad, ScanMode } from './clean';

/** The longest side read from a photo. A bigger photo is shrunk first, which keeps cleanup quick. */
export const MAX_INPUT_SIDE = 3000;
/** The biggest photo file read. */
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

/** A photo's pixels, shrunk so its longest side is at most `MAX_INPUT_SIDE`. */
export async function pixelsOf(blob: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_INPUT_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('A canvas is not available.');
    context.drawImage(bitmap, 0, 0, width, height);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}

/** A cleaned page as a file: PNG for black and white, which compresses it best, and JPEG otherwise. */
export async function encode(pixels: Pixels, mode: ScanMode): Promise<{ blob: Blob; mime: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A canvas is not available.');
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  const mime = mode === 'blackAndWhite' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.9));
  if (!blob) throw new Error('The cleaned page could not be saved.');
  return { blob, mime };
}

/** Corners as fractions of the photo's width and height, so they hold at any size the photo is read at. */
export type Frame = Quad;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Turns a frame into corners in a photo's pixels, clamped inside the photo. */
export function cornersOf(frame: Frame, width: number, height: number): Quad {
  const at = ([x, y]: readonly [number, number]) => [clamp01(x) * (width - 1), clamp01(y) * (height - 1)] as const;
  return [at(frame[0]), at(frame[1]), at(frame[2]), at(frame[3])];
}

/** Finds the page in a photo, as a frame, and whether its edges were clear. */
export async function detectFrame(blob: Blob): Promise<{ frame: Frame; found: boolean }> {
  const pixels = await pixelsOf(blob);
  const { corners, found } = findPage(pixels);
  const w = Math.max(1, pixels.width - 1);
  const h = Math.max(1, pixels.height - 1);
  const to = ([x, y]: readonly [number, number]) => [clamp01(x / w), clamp01(y / h)] as const;
  return { frame: [to(corners[0]), to(corners[1]), to(corners[2]), to(corners[3])], found };
}

/** Cleans a photo file, inside the corners the person placed when there is a frame. */
export async function cleanBlob(blob: Blob, mode: ScanMode, frame?: Frame): Promise<CleanResult> {
  const pixels = await pixelsOf(blob);
  return cleanScan(pixels, { mode, corners: frame ? cornersOf(frame, pixels.width, pixels.height) : undefined });
}

async function store(target: EditTarget, result: CleanResult, mode: ScanMode, name: string): Promise<ImportedAsset> {
  const { blob, mime } = await encode(result, mode);
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  return target.importImage({ kind: 'bytes', bytes: await blob.arrayBuffer(), name: `${name}.${ext}`, mime });
}

const scanData = (mode: ScanMode, result: CleanResult) => ({
  mode,
  corners: result.corners.map(([x, y]) => [Math.round(x), Math.round(y)]),
});

/** Puts the cleaned page in place of a picture's photo. The photo is kept as the block's `original`. */
export async function cleanPicture(
  target: EditTarget,
  block: BlockJson,
  mode: ScanMode,
  placed?: Frame,
): Promise<boolean> {
  const asset = typeof block.data.asset === 'string' ? block.data.asset : null;
  if (!asset) return false;
  const original = typeof block.data.original === 'string' ? block.data.original : asset;
  const response = await fetch(target.page.assetUrl(original));
  if (!response.ok) return false;
  const result = await cleanBlob(await response.blob(), mode, placed);
  const cleaned = await store(target, result, mode, 'scan');
  const edits: Edit[] = [
    { edit: 'addAsset', asset: cleaned.id },
    {
      edit: 'patchBlock',
      block: block.id,
      data: { asset: cleaned.id, original, scan: scanData(mode, result), crop: null },
    },
  ];
  const frame = block.frame;
  if (frame?.w !== undefined && frame.h !== undefined && !block.lock) {
    edits.push({
      edit: 'moveBlock',
      block: block.id,
      frame: { ...frame, h: (frame.w * result.height) / result.width },
    });
  }
  await target.send(edits);
  return true;
}

/** Brings back the photo a cleaned picture was made from. */
export async function restoreOriginal(target: EditTarget, block: BlockJson): Promise<boolean> {
  const original = typeof block.data.original === 'string' ? block.data.original : null;
  if (!original) return false;
  await target.send([{ edit: 'patchBlock', block: block.id, data: { asset: original, original: null, scan: null } }]);
  return true;
}

/** Cleans several photos and adds them to the page one below the other, as a multi-page scan. */
export async function addScans(
  target: EditTarget,
  photos: readonly File[],
  mode: ScanMode,
  top: number,
  onPage?: (done: number) => void,
  frame?: Frame,
): Promise<number> {
  const edits: Edit[] = [];
  let y = top;
  let made = 0;
  for (const [index, photo] of photos.entries()) {
    if (photo.size > MAX_PHOTO_BYTES) continue;
    // Placed corners belong to the one photo the person saw; with several photos each finds its own edges.
    const result = await cleanBlob(photo, mode, photos.length === 1 ? frame : undefined).catch(() => null);
    if (!result) continue;
    const original = await target.importImage({
      kind: 'bytes',
      bytes: await photo.arrayBuffer(),
      name: photo.name || 'photo',
      mime: photo.type || 'image/jpeg',
    });
    const cleaned = await store(target, result, mode, `scan-${index + 1}`);
    const w = 612;
    const h = Math.round((w * result.height) / result.width);
    edits.push(
      { edit: 'addAsset', asset: original.id },
      { edit: 'addAsset', asset: cleaned.id },
      {
        edit: 'insertBlock',
        block: {
          id: newId() as never,
          type: 'image',
          frame: { x: 0, y, w, h },
          data: {
            asset: cleaned.id,
            original: original.id,
            alt: t('pdf.scan.pageAlt', { page: index + 1 }),
            scan: scanData(mode, result),
          },
        },
      },
    );
    y += h + 24;
    made += 1;
    onPage?.(made);
  }
  if (made > 0) await target.send(edits);
  return made;
}

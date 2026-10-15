// Note space and handouts (A2-20). "Add note space" puts a ruled or blank sheet beside a PDF page or slide, on the right,
// below, or both, so there is room to write. "Make handouts" lays out 2 or 3 pages to a sheet, each with lines
// beside it, like PowerPoint's handouts. The sheets are pictures locked in place, so ink goes on top. Each command
// is one step that one undo takes back on each page it changes. The layout math is plain functions, tested alone.
import { newId } from '../../editor/ids';
import type { BlockJson, Edit, ImportedAsset, NewBlock } from '../../services/pages/types';
import { t } from '../../strings/t';
import { isPagePicture } from './model';
import type { EditTarget } from './target';

export type Side = 'right' | 'bottom' | 'both';
export type Paper = 'ruled' | 'blank';
export type PerSheet = 2 | 3;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The note space is this share of the picture's width on the right, and of its height below. */
export const RIGHT_SHARE = 0.6;
export const BOTTOM_SHARE = 0.5;
/** A handout sheet: US Letter at 96 units an inch, with half-inch margins. */
export const SHEET = { w: 816, h: 1056, margin: 48, gap: 24 };
/** Ruled lines are this far apart, in page units, as on college-ruled paper. */
export const LINE_SPACING = 27;

/** Where a picture is, with a page picture that has no position read as the top left corner. */
export function frameOf(block: Pick<BlockJson, 'frame'>): Rect {
  const { x = 0, y = 0, w = 816, h = 1056 } = block.frame ?? {};
  return { x, y, w, h };
}

/** The sheets of note space for a picture at `pic`. With both, the bottom sheet runs under the right one too. */
export function noteSpaceFrames(pic: Rect, side: Side): Rect[] {
  const right = { x: pic.x + pic.w, y: pic.y, w: Math.round(pic.w * RIGHT_SHARE), h: pic.h };
  const belowWidth = side === 'both' ? pic.w + right.w : pic.w;
  const bottom = { x: pic.x, y: pic.y + pic.h, w: belowWidth, h: Math.round(pic.h * BOTTOM_SHARE) };
  if (side === 'right') return [right];
  if (side === 'bottom') return [bottom];
  return [right, bottom];
}

/** One slot of a handout sheet: the picture's place and the lines' place beside it. */
export interface HandoutSlot {
  picture: Rect;
  lines: Rect;
}

/**
 * The slots of one handout sheet for pictures of the given width-to-height ratios. Each row holds a picture on the
 * left, as big as fits, and lines on the right.
 */
export function handoutSlots(ratios: readonly number[], perSheet: PerSheet): HandoutSlot[] {
  const { w, h, margin, gap } = SHEET;
  const rowHeight = (h - 2 * margin - (perSheet - 1) * gap) / perSheet;
  const pictureWidth = perSheet === 3 ? 360 : 440;
  return ratios.slice(0, perSheet).map((ratio, index) => {
    const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
    const pw = Math.min(pictureWidth, rowHeight * safe);
    const ph = pw / safe;
    const top = margin + index * (rowHeight + gap);
    const picture = { x: margin, y: Math.round(top + (rowHeight - ph) / 2), w: Math.round(pw), h: Math.round(ph) };
    const linesX = margin + pictureWidth + gap;
    return { picture, lines: { x: linesX, y: Math.round(top), w: w - margin - linesX, h: Math.round(rowHeight) } };
  });
}

/** Splits a list into sheets of `size`. */
export function sheetsOf<T>(items: readonly T[], size: number): T[][] {
  const sheets: T[][] = [];
  for (let at = 0; at < items.length; at += size) sheets.push(items.slice(at, at + size));
  return sheets;
}

/** A sheet of paper as a PNG, drawn at twice its size: white, with ruled lines when asked. */
export async function paperPng(w: number, h: number, paper: Paper): Promise<Blob> {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A canvas is not available.');
  // checks-disable-next-line brand-consistency: page content saved in a picture, not interface styling
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (paper === 'ruled') {
    // checks-disable-next-line brand-consistency: page content saved in a picture, not interface styling
    context.strokeStyle = '#c5d0dc';
    context.lineWidth = scale;
    for (let y = LINE_SPACING; y < h; y += LINE_SPACING) {
      context.beginPath();
      context.moveTo(0, Math.round(y * scale) + 0.5);
      context.lineTo(canvas.width, Math.round(y * scale) + 0.5);
      context.stroke();
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The sheet could not be drawn.');
  return blob;
}

async function sheetAsset(page: Pick<EditTarget, 'importImage'>, rect: Rect, paper: Paper): Promise<ImportedAsset> {
  const png = await paperPng(rect.w, rect.h, paper);
  return page.importImage({
    kind: 'bytes',
    bytes: await png.arrayBuffer(),
    name: `note-space-${paper}.png`,
    mime: 'image/png',
  });
}

function sheetBlock(asset: ImportedAsset, rect: Rect, paper: Paper): NewBlock {
  return {
    id: newId() as never,
    type: 'image',
    lock: 'position',
    frame: rect,
    data: { asset: asset.id, alt: t(`pdf.noteSpace.alt.${paper}`), decorative: true, background: 'noteSpace' },
  };
}

/** Whether the page already has note space next to this picture, so a second run doesn't stack another. */
function hasNoteSpace(blocks: readonly BlockJson[], rect: Rect): boolean {
  return blocks.some((block) => {
    if (block.data.background !== 'noteSpace') return false;
    const frame = frameOf(block);
    return frame.x === rect.x && frame.y === rect.y;
  });
}

/** The edits that add note space beside every page picture of a page. Empty when there is nothing to add. */
export async function noteSpaceEdits(target: EditTarget, side: Side, paper: Paper): Promise<Edit[]> {
  const page = target;
  const blocks = target.blocks();
  const edits: Edit[] = [];
  const pictures = blocks.filter(isPagePicture);
  if (pictures.length > 0 && target.page.initial.view?.layout === 'flow') {
    edits.push({ edit: 'setPage', view: { layout: 'freeform' } });
  }
  for (const picture of pictures) {
    const frame = frameOf(picture);
    if (picture.frame?.x === undefined || picture.frame?.y === undefined) {
      // A locked block can't move, so the picture is unlocked, placed at the top left, and locked again.
      edits.push(
        { edit: 'patchBlock', block: picture.id, lock: null },
        { edit: 'moveBlock', block: picture.id, frame },
        { edit: 'patchBlock', block: picture.id, lock: picture.lock ?? 'position' },
      );
    }
    for (const rect of noteSpaceFrames(frame, side)) {
      if (hasNoteSpace(blocks, rect)) continue;
      const asset = await sheetAsset(page, rect, paper);
      edits.push({ edit: 'addAsset', asset: asset.id }, { edit: 'insertBlock', block: sheetBlock(asset, rect, paper) });
    }
  }
  return edits.some((edit) => edit.edit === 'insertBlock') ? edits : [];
}

/** A page picture to put on a handout: its bytes, name, and shape. */
export interface HandoutPicture {
  bytes: ArrayBuffer;
  mime: string;
  name: string;
  alt: string;
  ratio: number;
}

/** The edits that fill one handout sheet with its pictures and the lines beside them. */
export async function handoutEdits(
  page: Pick<EditTarget, 'importImage'>,
  pictures: readonly HandoutPicture[],
  perSheet: PerSheet,
  paper: Paper,
): Promise<Edit[]> {
  const edits: Edit[] = [{ edit: 'setPage', view: { layout: 'freeform' } }];
  const slots = handoutSlots(
    pictures.map((p) => p.ratio),
    perSheet,
  );
  for (const [index, slot] of slots.entries()) {
    const source = pictures[index];
    const asset = await page.importImage({ kind: 'bytes', bytes: source.bytes, name: source.name, mime: source.mime });
    edits.push({ edit: 'addAsset', asset: asset.id });
    edits.push({
      edit: 'insertBlock',
      block: {
        id: newId() as never,
        type: 'image',
        lock: 'position',
        frame: slot.picture,
        data: { asset: asset.id, alt: source.alt, background: 'handout' },
      },
    });
    const lines = await sheetAsset(page, slot.lines, paper);
    edits.push(
      { edit: 'addAsset', asset: lines.id },
      { edit: 'insertBlock', block: sheetBlock(lines, slot.lines, paper) },
    );
  }
  return edits;
}

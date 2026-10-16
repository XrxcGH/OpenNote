// Shape libraries and text in shapes. Inserting a library shape adds ordinary shape strokes at the middle of the view.
// They take the current pen's color and width, and they are selected. "Add text to shape" puts an empty text box inside
// the selected shape. A text box inside a shape moves with it. Nothing is stored for that: the boxes are found by where
// they sit, so a shape and its label can never come apart.
import { newId } from '../../../editor/ids';
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce } from '../../../ui';
import { strokeBounds, union } from '../geometry/bounds';
import { libraryShape } from '../geometry/shapes';
import type { Bounds } from '../geometry/types';
import { strokeKind } from '../edits/filters';
import type { InkStroke } from '../model/types';
import type { InkHost } from './host';
import { blockItems } from './lasso';
import { snapPolylines } from '../snap';
import { paperSnapNow, showSnapMarks } from './paperSnap';
import { shapeOfStroke } from './shapeEdit';
import { activeSlot, styleOf } from './state';
import type { InkSurface } from './surface';

/** Library shapes are about this wide, in page units. */
export const LIBRARY_SIZE = 170;

/** Adds a library shape at the middle of the view and selects it. */
export async function insertLibraryShape(host: InkHost, surface: InkSurface, id: string): Promise<void> {
  if (surface.readOnly || !isEnabled('ink.shapeTools')) return;
  const camera = surface.cameraNow();
  const center = {
    x: (camera.scrollX + camera.viewport.w / 2) / camera.zoom,
    y: (camera.scrollY + camera.viewport.h / 2) / camera.zoom,
  };
  const pen = styleOf(activeSlot());
  // A highlighter's wide, see-through line is no good for a diagram, so shapes take the pen's color with a pen's tool.
  const tool = pen.tool === 'highlighter' ? 'pen' : pen.tool;
  // On ruled, grid, or dot paper the shape lands on the nearest lines, sized in whole spacings. The middle of the view
  // is no place the person chose, so it reaches as far as half a spacing.
  const snap = paperSnapNow(camera.zoom);
  const made = libraryShape(id, center, LIBRARY_SIZE);
  const placed = snap ? snapPolylines({ ...snap, reach: snap.lattice.step / 2 }, made) : { lines: made, marks: [] };
  const strokes: InkStroke[] = placed.lines.map((points) => ({
    id: newId(),
    tool,
    width: pen.width,
    startTime: Date.now(),
    points: points.map((p) => ({ x: p.x, y: p.y })),
    block: surface.layerFor(),
    slot: pen.slot,
    color: pen.color,
  }));
  if (strokes.length === 0) return;
  if (await surface.add(strokes)) {
    if (placed.marks.length > 0) showSnapMarks(surface, placed.marks, true);
    host.select({ strokes: strokes.map((s) => s.id), blocks: [] });
    announce(t('ink.library.inserted', { shape: t(`ink.library.${id}` as MessageKey) }));
  }
}

/** The box around the selected strokes when every one of them is a shape, else null. */
function shapeBox(surface: InkSurface, ids: readonly string[]): Bounds | null {
  const strokes = surface.strokes(ids);
  if (strokes.length === 0 || strokes.some((stroke) => strokeKind(stroke) !== 'shape')) return null;
  return strokes.map(strokeBounds).reduce(union);
}

/** The text boxes that sit inside the selected shapes, which move with them. */
export function labelsIn(host: InkHost, surface: InkSurface, ids: readonly string[]): string[] {
  if (!isEnabled('ink.shapeTools')) return [];
  const box = shapeBox(surface, ids);
  if (!box) return [];
  const layer = host.layer.get();
  return blockItems(host)
    .filter(
      (item) =>
        item.kind === 'text' &&
        layer?.block(item.id)?.frame?.x !== undefined &&
        item.frame.minX >= box.minX &&
        item.frame.maxX <= box.maxX &&
        item.frame.minY >= box.minY &&
        item.frame.maxY <= box.maxY,
    )
    .map((item) => item.id);
}

/** Adds an empty text box inside the selected shape, ready for its label. */
export async function addTextToShape(host: InkHost, surface: InkSurface): Promise<void> {
  const ids = host.selection.get().strokes;
  const box = shapeBox(surface, ids);
  const queue = host.queue.get();
  const stroke = surface.strokes(ids)[0];
  const shape = ids.length === 1 && stroke ? shapeOfStroke(stroke) : null;
  if (!box || !queue || !shape || surface.readOnly) {
    announce(t('ink.library.selectShape'));
    return;
  }
  const pad = 8;
  const height = 28;
  const id = newId();
  const frame = {
    x: box.minX + pad,
    y: (box.minY + box.maxY) / 2 - height / 2,
    w: Math.max(40, box.maxX - box.minX - 2 * pad),
  };
  try {
    await queue.send({ edits: [{ edit: 'insertBlock', block: { id, type: 'text', frame, data: { markdown: '' } } }] });
    announce(t('ink.library.textAdded'));
    // The new box takes the keyboard, so typing starts the label.
    requestAnimationFrame(() => {
      host.layer.get()?.view(id)?.element.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
    });
  } catch {
    announce(t('ink.errors.notSaved'));
  }
}

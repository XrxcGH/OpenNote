// Puts a drawing made elsewhere (a chemical structure, for one) on the page as ordinary ink: each line is its own
// shape stroke, so a person can select, move, restyle, or reshape any bond, and each label is a text box that can be
// edited. The parts arrive in page units around the origin and land at the middle of the view, selected.
import { newId } from '../../../editor/ids';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { InkStroke } from '../model/types';
import { viewContext } from './context';
import { activeSlot, styleOf } from './state';

export interface DrawingParts {
  /** Each line is a list of points around the origin, in page units. */
  lines: readonly (readonly { x: number; y: number }[])[];
  labels: readonly { x: number; y: number; text: string }[];
}

const LABEL_HEIGHT = 28;
/** Bonds keep one width whatever the pen is, so a molecule reads the same in any pen; the color still follows the pen. */
const BOND_WIDTH = 2.5;

/** Adds the drawing at the middle of the view. Returns false when no editable page is showing. */
export async function insertDrawing(parts: DrawingParts): Promise<boolean> {
  const context = viewContext();
  const surface = context?.surface();
  if (!context || !surface || surface.readOnly) {
    announce(t('chem.structure.noInk'));
    return false;
  }
  const camera = surface.cameraNow();
  const center = {
    x: (camera.scrollX + camera.viewport.w / 2) / camera.zoom,
    y: (camera.scrollY + camera.viewport.h / 2) / camera.zoom,
  };
  const pen = styleOf(activeSlot());
  const strokes: InkStroke[] = parts.lines.map((points) => ({
    id: newId(),
    tool: 'pen' as const,
    width: BOND_WIDTH,
    startTime: Date.now(),
    points: points.map((p) => ({ x: center.x + p.x, y: center.y + p.y })),
    block: surface.layerFor(),
    slot: pen.slot,
    color: pen.color,
  }));
  if (strokes.length === 0 || !(await surface.add(strokes))) return false;
  context.host.select({ strokes: strokes.map((s) => s.id), blocks: [] });
  const queue = context.host.queue.get();
  if (queue && parts.labels.length > 0) {
    try {
      await queue.send({
        edits: parts.labels.map((label) => {
          const width = Math.max(28, label.text.length * 14 + 8);
          return {
            edit: 'insertBlock' as const,
            block: {
              id: newId(),
              type: 'text' as const,
              frame: { x: center.x + label.x - width / 2, y: center.y + label.y - LABEL_HEIGHT / 2, w: width },
              data: { markdown: label.text },
            },
          };
        }),
      });
    } catch {
      announce(t('ink.errors.notSaved'));
    }
  }
  announce(t('chem.structure.drawn', { bonds: strokes.length, labels: parts.labels.length }));
  return true;
}

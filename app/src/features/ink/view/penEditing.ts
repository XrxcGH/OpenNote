// Pen editing on typed text: strike through words to delete them, draw a vertical line between words to add a space or,
// when it is long, to split the paragraph, and circle words to select them. Each shows an Undo toast, can be turned off in
// the command list, and only acts on a stroke that really lies on typed text; anywhere else the stroke stays ink. The
// text edits go through the page's editor, so they join its undo history like typing does.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { boundsOf } from '../geometry/bounds';
import { fitLine } from '../geometry/shapes/lines';
import { pointInPolygon } from '../geometry/primitives';
import type { Vec } from '../geometry/types';
import { detectLoop } from '../input/gestures';
import type { InkStroke } from '../model/types';
import type { InkHost } from './host';
import { inkPrefs } from './prefs';
import type { InkSurface } from './surface';

export type EditGesture = 'strike' | 'space' | 'split' | 'circle';
export const EDIT_GESTURES: readonly EditGesture[] = ['strike', 'space', 'split', 'circle'];

/** The height of a line of text in page units, when the text says nothing else. */
export const LINE_HEIGHT = 26;
/** A line that straight, as a share of its length, is a line and no scribble. */
const STRAIGHT = 0.06;
const DEGREES = Math.PI / 180;

/** What a finished pen path asks of typed text, judged by its shape alone. */
export function classifyEdit(points: readonly Vec[], lineHeight = LINE_HEIGHT): EditGesture | null {
  if (points.length < 3) return null;
  const box = boundsOf(points);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const fit = fitLine(points);
  if (fit && fit.length > 0 && fit.maxDeviation <= STRAIGHT * fit.length) {
    const angle = Math.abs(Math.atan2(fit.to.y - fit.from.y, fit.to.x - fit.from.x)) / DEGREES;
    const flat = Math.min(angle, 180 - angle);
    if (flat <= 12 && fit.length >= lineHeight && h <= 0.5 * lineHeight) return 'strike';
    if (
      Math.abs(angle - 90) <= 15 &&
      fit.length >= 0.6 * lineHeight &&
      fit.length <= 4 * lineHeight &&
      w <= 0.4 * fit.length
    ) {
      return fit.length > 1.7 * lineHeight ? 'split' : 'space';
    }
    return null;
  }
  return detectLoop(points) ? 'circle' : null;
}

export function penEditOn(which: EditGesture): boolean {
  return isEnabled('ink.penEditing') && inkPrefs.get().penEdit[which];
}

/** Tries a pen edit on a finished stroke. Returns true when it edited the text, so the stroke is not added as ink. */
export async function penEdit(host: InkHost, surface: InkSurface, stroke: InkStroke): Promise<boolean> {
  const text = host.text;
  if (!text || !isEnabled('ink.penEditing') || surface.readOnly) return false;
  if (stroke.tool !== 'pen' && stroke.tool !== 'pencil') return false;
  const gesture = classifyEdit(stroke.points);
  if (!gesture || !penEditOn(gesture)) return false;
  const camera = surface.cameraNow();
  const client = (p: Vec): Vec => ({
    x: camera.viewport.x + p.x * camera.zoom - camera.scrollX,
    y: camera.viewport.y + p.y * camera.zoom - camera.scrollY,
  });
  const box = boundsOf(stroke.points);
  const midY = (box.minY + box.maxY) / 2;
  const midX = (box.minX + box.maxX) / 2;
  // A point counts as on the text when the stroke runs through the height of the letters, not above or below them.
  const onText = async (p: Vec, through = true) => {
    const at = client(p);
    const found = await text.hit(at.x, at.y);
    if (!found) return null;
    if (through && !(at.y >= found.top + 0.15 * (found.bottom - found.top) && at.y <= found.bottom)) return null;
    return found;
  };
  const undo = (block: string) => ({ label: t('ink.gestures.undo'), run: () => text.undo(block) });

  if (gesture === 'strike' || gesture === 'circle') {
    const left = gesture === 'strike' ? box.minX : box.minX + (box.maxX - box.minX) * 0.15;
    const right = gesture === 'strike' ? box.maxX : box.maxX - (box.maxX - box.minX) * 0.15;
    const a = await onText({ x: left, y: midY });
    const b = await onText({ x: right, y: midY });
    if (!a || !b || a.block !== b.block) return false;
    if (gesture === 'circle') {
      const loop = detectLoop(stroke.points);
      if (!loop || !pointInPolygon({ x: midX, y: midY }, loop.polygon)) return false;
    }
    const range = await text.words(a.block, a.pos, b.pos);
    if (!range) return false;
    if (gesture === 'circle') {
      if (!(await text.select(a.block, range.from, range.to))) return false;
      announce(t('ink.penEdit.selected', { text: range.text }));
      return true;
    }
    if (!(await text.remove(a.block, range.from, range.to))) return false;
    showToast({ id: 'ink-pen-edit', message: t('ink.penEdit.deleted', { text: range.text }), action: undo(a.block) });
    return true;
  }
  const at = await onText({ x: midX, y: midY }, false);
  if (!at) return false;
  const done = gesture === 'space' ? await text.insert(at.block, at.pos, ' ') : await text.split(at.block, at.pos);
  if (!done) return false;
  showToast({
    id: 'ink-pen-edit',
    message: t(gesture === 'space' ? 'ink.penEdit.spaced' : 'ink.penEdit.split'),
    action: undo(at.block),
  });
  return true;
}

// Handwriting on the page: Convert to text for the lasso, Straighten, Even spacing, and Reflow for tidying, and the writing
// pen, which turns words into typed text a moment after they are written. The recognizer is the on-device one of
// Phase 12, reached through the host's `handwriting` seam. The ink always stays: converting adds text beside it, and the
// writing pen only fades the strokes, so the words are one tap from coming back.
import { newId } from '../../../editor/ids';
import { escapeParagraphText } from '../../../editor/markdown';
import { isEnabled } from '../../../app/flags';
import type { InkLine, InkRecognition, InkStroke as IntelStroke, TidyOperation } from '../../../services/intel';
import type { Edit } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { strokeBounds, union } from '../geometry/bounds';
import { pagePoints } from '../geometry/strokeIndex';
import type { Bounds } from '../geometry/types';
import { strokeKind } from '../edits/filters';
import type { InkStroke } from '../model/types';
import { paletteByName } from '../pens/palette';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

/** Strokes in the recognizer's form: the ID, and the points with each stroke's own transform applied. */
export function toIntel(strokes: readonly InkStroke[]): IntelStroke[] {
  return strokes.map((stroke) => ({
    key: stroke.id,
    points: pagePoints(stroke).map((p): [number, number] => [p.x, p.y]),
  }));
}

export const handwritingAvailable = (host: InkHost): boolean =>
  isEnabled('ink.handwriting') && isEnabled('intel.handwriting') && host.handwriting !== undefined;

const boxOf = (strokes: readonly InkStroke[]): Bounds => strokes.map(strokeBounds).reduce(union);

/** A shape that holds the whole box, so handwriting written inside it becomes its label. */
function shapeAround(surface: InkSurface, box: Bounds, exclude: ReadonlySet<string>): Bounds | null {
  for (const stroke of surface.index.query(box) as InkStroke[]) {
    if (exclude.has(stroke.id) || strokeKind(stroke) !== 'shape') continue;
    const outer = strokeBounds(stroke);
    if (outer.minX <= box.minX && outer.minY <= box.minY && outer.maxX >= box.maxX && outer.maxY >= box.maxY) {
      return outer;
    }
  }
  return null;
}

function insertText(markdown: string, frame: { x: number; y: number; w: number }): Edit {
  return { edit: 'insertBlock', block: { id: newId(), type: 'text', frame, data: { markdown } } };
}

/** Reads the selected handwriting and adds the words as text below it, or inside the shape it was written in. */
export async function convertSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const strokes = surface.strokes(host.selection.get().strokes);
  const queue = host.queue.get();
  if (!handwritingAvailable(host) || !queue || strokes.length === 0 || surface.readOnly) return;
  announce(t('ink.handwriting.working'));
  const recognition = await host.handwriting!.recognize(toIntel(strokes));
  if (!recognition) return;
  const lines = recognition.lines.map((line) => line.text.trim()).filter(Boolean);
  if (lines.length === 0) {
    showToast({ message: t('ink.handwriting.none') });
    return;
  }
  const box = boxOf(strokes);
  const label = shapeAround(surface, box, new Set(strokes.map((s) => s.id)));
  const edit = label
    ? insertText(escapeParagraphText(lines.join(' ')), {
        x: label.minX + 8,
        y: (label.minY + label.maxY) / 2 - 14,
        w: Math.max(40, label.maxX - label.minX - 16),
      })
    : insertText(lines.map((line) => escapeParagraphText(line)).join('\n\n'), {
        x: box.minX,
        y: box.maxY + 16,
        w: Math.max(220, box.maxX - box.minX),
      });
  try {
    await queue.send({ edits: [edit] });
    showToast({
      id: 'ink-converted',
      message: t(label ? 'ink.handwriting.label' : 'ink.handwriting.converted'),
      action: { label: t('ink.gestures.undo'), run: () => queue.undo() },
    });
  } catch {
    announce(t('ink.errors.notSaved'));
  }
}

/** Levels the lines, evens the spacing, or wraps the selected handwriting to a width, as one undo step. */
export async function tidySelection(host: InkHost, surface: InkSurface, operation: TidyOperation): Promise<boolean> {
  const strokes = surface.strokes(host.selection.get().strokes);
  if (!handwritingAvailable(host) || strokes.length === 0 || surface.readOnly) return false;
  const intel = toIntel(strokes);
  announce(t('ink.handwriting.working'));
  const recognition = await host.handwriting!.recognize(intel);
  if (!recognition || recognition.lines.length === 0) {
    if (recognition) showToast({ message: t('ink.handwriting.none') });
    return false;
  }
  const plan = await host.handwriting!.tidy(intel, recognition, operation);
  if (!plan || plan.moves.length === 0) {
    if (plan) announce(t('ink.handwriting.tidyNothing'));
    return false;
  }
  const saved = await surface.transformEach(plan.moves.map((move) => ({ id: move.key, matrix: move.transform })));
  if (saved) {
    showToast({
      id: 'ink-tidied',
      message: t('ink.handwriting.tidied'),
      action: { label: t('ink.gestures.undo'), run: () => host.queue.get()?.undo() },
    });
  }
  return saved;
}

// ---- the writing pen ----

/** How long after the last stroke the words are read. */
export const WRITING_IDLE_MS = 1400;
/** The faded ink keeps this much of its opacity, out of 255. */
export const FADED_ALPHA = 36;

/** A word is unsure when the recognizer has another reading of it. */
export const isUnsure = (word: { alternates: readonly string[] }): boolean => word.alternates.length > 0;

/** The line's box, in page units. */
const lineBox = (line: InkLine): Bounds => ({
  minX: line.bounds.x,
  minY: line.bounds.y,
  maxX: line.bounds.x + line.bounds.width,
  maxY: line.bounds.y + line.bounds.height,
});

export function createWritingPen(host: InkHost, surfaceOf: () => InkSurface | null) {
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Strokes this pen faded, so a tap on Show written ink can bring them back. */
  const faded = new Map<string, InkStroke>();

  const run = async () => {
    timer = null;
    const surface = surfaceOf();
    const queue = host.queue.get();
    const strokes = surface ? surface.strokes(pending) : [];
    pending = [];
    if (!surface || !queue || strokes.length === 0 || !handwritingAvailable(host)) return;
    const recognition = await host.handwriting!.recognize(toIntel(strokes));
    if (!recognition || recognition.lines.length === 0) return;
    const edits: Edit[] = [];
    const underlines: InkStroke[] = [];
    const amber = paletteByName('amber');
    const camera = surface.cameraNow();
    for (const line of recognition.lines) {
      const text = line.text.trim();
      if (!text) continue;
      const box = lineBox(line);
      // Written in a gap of typed text, the words go into the text there; anywhere else they become a text box.
      const at = await host.text?.hit(
        camera.viewport.x + box.minX * camera.zoom - camera.scrollX,
        camera.viewport.y + ((box.minY + box.maxY) / 2) * camera.zoom - camera.scrollY,
      );
      if (at && (await host.text?.insert(at.block, at.pos, `${text} `))) continue;
      edits.push(
        insertText(escapeParagraphText(text), { x: box.minX, y: box.minY, w: Math.max(80, box.maxX - box.minX + 24) }),
      );
      if (amber) {
        for (const word of line.words.filter(isUnsure)) {
          const y = word.bounds.y + word.bounds.height + 2;
          underlines.push({
            id: newId(),
            tool: 'pen',
            width: 1.5,
            startTime: Date.now(),
            points: [
              { x: word.bounds.x, y },
              { x: word.bounds.x + word.bounds.width, y },
            ],
            block: surface.layerFor(),
            slot: amber.slot,
            color: amber.light,
          });
        }
      }
    }
    // The ink stays, faint, behind the words.
    const next = strokes.map((stroke) => ({
      ...stroke,
      color: [stroke.color[0], stroke.color[1], stroke.color[2], FADED_ALPHA] as const,
    }));
    for (const stroke of strokes) faded.set(stroke.id, stroke);
    const batch = {
      edits: [
        ...edits,
        ...strokes.map((stroke): Edit => ({
          edit: 'restyleStrokes',
          strokes: [stroke.id],
          style: { color: [stroke.color[0], stroke.color[1], stroke.color[2], FADED_ALPHA] },
        })),
      ],
      ...(underlines.length > 0 ? { strokes: surface.records(underlines) } : {}),
    };
    surface.show([...next, ...underlines]);
    const ok = await surface.send(batch, () => {
      surface.show(strokes);
      surface.hide(underlines.map((u) => u.id));
    });
    if (ok) {
      announce(t('ink.handwriting.written', { count: recognition.lines.length }));
      showToast({
        id: 'ink-written',
        message: t('ink.handwriting.written', { count: recognition.lines.length }),
        action: { label: t('ink.gestures.undo'), run: () => queue.undo() },
      });
    }
  };

  return {
    /** Strokes the writing pen just added. */
    note(strokes: readonly InkStroke[]): void {
      if (!handwritingAvailable(host)) return;
      pending.push(...strokes.map((stroke) => stroke.id));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(), WRITING_IDLE_MS);
    },
    /** Shows or fades again the ink this pen turned into text. */
    toggleInk(): void {
      const surface = surfaceOf();
      if (!surface || faded.size === 0) return announce(t('ink.handwriting.noWritten'));
      const strokes = surface.strokes([...faded.keys()]);
      const showing = strokes.every((s) => s.color[3] > FADED_ALPHA);
      for (const stroke of strokes) {
        const original = faded.get(stroke.id)!;
        const color = showing
          ? ([original.color[0], original.color[1], original.color[2], FADED_ALPHA] as const)
          : original.color;
        void surface.restyle([stroke.id], [{ ...stroke, color }], { color: [...color] });
      }
      announce(t(showing ? 'ink.handwriting.inkHidden' : 'ink.handwriting.inkShown'));
    },
    destroy(): void {
      if (timer) clearTimeout(timer);
    },
  };
}

export type WritingPen = ReturnType<typeof createWritingPen>;
export type { InkRecognition };

// The fifth pen edit of typed text: handwriting started in a gap between words, or at the caret, is read a moment after
// the pen stops and typed in there. While the words are being written they show as ink that is not saved yet; when the
// recognizer reads nothing, or the text can't take the words, they are kept as ordinary ink, so nothing written is lost.
// The insert goes through the page's editor, so it joins its undo history, and the toast offers Undo as the others do.
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { boundsOf, strokeBounds, union } from '../geometry/bounds';
import type { Bounds, Vec } from '../geometry/types';
import type { InkStroke } from '../model/types';
import { handwritingAvailable, readText } from './handwriting';
import type { InkHost } from './host';
import { classifyEdit, LINE_HEIGHT, penEditOn } from './penEditing';
import type { InkSurface } from './surface';

/** How long after the last stroke in a gap the words are read. */
export const GAP_IDLE_MS = 1100;

/** Whether a stroke could be the start of written words rather than an edit gesture or a drawing. */
export function couldBeWriting(points: readonly Vec[], lineHeight = LINE_HEIGHT): boolean {
  if (points.length < 2 || classifyEdit(points, lineHeight) !== null) return false;
  const box = boundsOf(points);
  return box.maxY - box.minY <= 2.5 * lineHeight && box.maxX - box.minX <= 6 * lineHeight;
}

/** Whether a stroke belongs to the words being written: it lies on their line, close after or among them. */
export function joinsWriting(words: Bounds, stroke: Bounds, lineHeight = LINE_HEIGHT): boolean {
  return (
    stroke.minX <= words.maxX + 1.5 * lineHeight &&
    stroke.maxX >= words.minX - 0.5 * lineHeight &&
    stroke.minY <= words.maxY + 0.75 * lineHeight &&
    stroke.maxY >= words.minY - 0.75 * lineHeight
  );
}

const SPACE = /\s/;

/**
 * Where in a paragraph's text written words go, and the spaces they need around them. A point in the middle of a word
 * is no gap, unless the caret is there; a point in a run of spaces or at a word's edge is.
 */
export function gapInsertion(
  text: string,
  offset: number,
  caret: number | null,
): { offset: number; prefix: string; suffix: string } | null {
  let at = Math.max(0, Math.min(offset, text.length));
  if (caret !== null && Math.abs(caret - at) <= 1) at = caret;
  else {
    const before = at > 0 ? text[at - 1] : ' ';
    const after = at < text.length ? text[at] : ' ';
    if (!SPACE.test(before) && !SPACE.test(after)) return null;
  }
  const prefix = at > 0 && !SPACE.test(text[at - 1]) ? ' ' : '';
  const suffix = at < text.length && !SPACE.test(text[at]) ? ' ' : '';
  return { offset: at, prefix, suffix };
}

interface Session {
  readonly block: string;
  readonly pos: number;
  readonly prefix: string;
  readonly suffix: string;
  readonly surface: InkSurface;
  strokes: InkStroke[];
  box: Bounds;
  timer: ReturnType<typeof setTimeout> | null;
}

/** `keep` saves strokes as ordinary ink, the way a finished stroke is saved. */
export function createGapWriter(host: InkHost, keep: (strokes: InkStroke[], surface: InkSurface) => unknown) {
  let session: Session | null = null;

  const arm = (s: Session) => {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => void read(s), GAP_IDLE_MS);
  };

  const read = async (s: Session) => {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    if (session === s) session = null;
    const ids = s.strokes.map((stroke) => stroke.id);
    const words = await readText(host, s.strokes);
    const text = host.text;
    if (words && text && (await text.insert(s.block, s.pos, `${s.prefix}${words}${s.suffix}`))) {
      s.surface.hide(ids);
      showToast({
        id: 'ink-pen-edit',
        message: t('ink.penEdit.written', { text: words }),
        action: { label: t('ink.gestures.undo'), run: () => text.undo(s.block) },
      });
      return;
    }
    keep(s.strokes, s.surface);
  };

  return {
    /** Takes a stroke that continues the words being written. False when there are none or it lies elsewhere. */
    take(stroke: InkStroke, surface: InkSurface): boolean {
      const s = session;
      if (!s) return false;
      const box = strokeBounds(stroke);
      if (s.surface !== surface || !joinsWriting(s.box, box)) {
        void read(s);
        return false;
      }
      s.strokes.push(stroke);
      s.box = union(s.box, box);
      surface.show([stroke]);
      arm(s);
      return true;
    },
    /** Starts reading words written from a gap in typed text, or at the caret. True when it took the stroke. */
    async start(stroke: InkStroke, surface: InkSurface): Promise<boolean> {
      const text = host.text;
      if (!text?.paragraph || surface.readOnly || !penEditOn('write') || !handwritingAvailable(host)) return false;
      if ((stroke.tool !== 'pen' && stroke.tool !== 'pencil') || !couldBeWriting(stroke.points)) return false;
      const camera = surface.cameraNow();
      const first = stroke.points[0];
      const x = camera.viewport.x + first.x * camera.zoom - camera.scrollX;
      const y = camera.viewport.y + first.y * camera.zoom - camera.scrollY;
      const found = await text.hit(x, y);
      if (!found || y < found.top - 0.25 * (found.bottom - found.top) || y > found.bottom) return false;
      const paragraph = await text.paragraph(found.block, found.pos);
      if (!paragraph || session) return false;
      const gap = gapInsertion(paragraph.text, found.pos - paragraph.start, paragraph.caret);
      if (!gap) return false;
      const s: Session = {
        block: found.block,
        pos: paragraph.start + gap.offset,
        prefix: gap.prefix,
        suffix: gap.suffix,
        surface,
        strokes: [stroke],
        box: strokeBounds(stroke),
        timer: null,
      };
      session = s;
      surface.show([stroke]);
      arm(s);
      return true;
    },
    /** Keeps any words still waiting as ink, as the page closes. */
    destroy(): void {
      const s = session;
      session = null;
      if (!s) return;
      if (s.timer) clearTimeout(s.timer);
      keep(s.strokes, s.surface);
    },
  };
}

export type GapWriter = ReturnType<typeof createGapWriter>;

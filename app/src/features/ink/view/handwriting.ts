// Handwriting on the page: Convert to text for the lasso, Straighten, Even spacing, and Reflow for tidying, and the writing
// pen, which turns words into typed text a moment after they are written. The recognizer is the on-device one of
// Phase 12, reached through the host's `handwriting` seam. The ink always stays: converting adds text beside it, and the
// writing pen only fades the strokes, so the words are one tap from coming back.
import { newId } from '../../../editor/ids';
import { escapeParagraphText } from '../../../editor/markdown/escape';
import { isEnabled } from '../../../app/flags';
import { loadApi as loadIntel } from '../../intel';
import type {
  InkLine,
  InkRecognition,
  InkWord,
  InkStroke as IntelStroke,
  TidyOperation,
} from '../../../services/intel';
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
import { marksFor, showUnsure } from './unsure';
import type { UnsureMark } from './unsure';

/** Strokes in the recognizer's form: the ID, and the points with each stroke's own transform applied. */
export function toIntel(strokes: readonly InkStroke[]): IntelStroke[] {
  return strokes.map((stroke) => ({
    key: stroke.id,
    points: pagePoints(stroke).map((p): [number, number] => [p.x, p.y]),
  }));
}

export const handwritingAvailable = (host: InkHost): boolean =>
  isEnabled('ink.handwriting') && isEnabled('intel.handwriting') && host.handwriting !== undefined;

/** What the app does with recognized words, from features/intel's handwriting API. */
export interface WordHelpers {
  /** The symbols and formulas people mean: -> becomes an arrow and H2O gets its subscript. */
  tidy(text: string): string;
  /** Whether the recognizer was unsure of a word. */
  unsure(word: InkWord): boolean;
  /** The other readings to offer for a word. */
  alternatives(word: InkWord): string[];
}

const PLAIN: WordHelpers = { tidy: (text) => text, unsure: () => false, alternatives: () => [] };

/** features/intel's handwriting helpers, or plain ones when that part can't load. */
export async function wordHelpers(): Promise<WordHelpers> {
  try {
    const intel = await loadIntel();
    return {
      tidy: intel.tidyRecognizedText,
      unsure: intel.isUnsureWord,
      alternatives: (word) => intel.alternativesFor(word),
    };
  } catch {
    return PLAIN;
  }
}

/** Recognized text with the symbols and formulas people mean (features/intel's tidyRecognizedText). */
export async function tidyText(text: string): Promise<string> {
  return (await wordHelpers()).tidy(text);
}

/** The recognizer's reading of some strokes as one tidied line of text, or null when it read nothing. */
export async function readText(host: InkHost, strokes: readonly InkStroke[]): Promise<string | null> {
  const recognition = await host.handwriting?.recognize(toIntel(strokes));
  const text = recognition?.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(' ');
  return text ? tidyText(text) : null;
}

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

function insertText(markdown: string, frame: { x: number; y: number; w: number }, id = newId()): Edit {
  return { edit: 'insertBlock', block: { id, type: 'text', frame, data: { markdown } } };
}

/** The amber lines under a line's unsure words, by word. */
function underlinesFor(surface: InkSurface, words: readonly InkWord[], helpers: WordHelpers): Map<InkWord, InkStroke> {
  const lines = new Map<InkWord, InkStroke>();
  const amber = paletteByName('amber');
  if (!amber) return lines;
  for (const word of words) {
    if (!helpers.unsure(word) || helpers.alternatives(word).length === 0) continue;
    const y = word.bounds.y + word.bounds.height + 2;
    lines.set(word, {
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
    } satisfies InkStroke);
  }
  return lines;
}

/** The marks that let a person pick another reading for each underlined word in a new text box. */
function unsureMarks(
  words: readonly InkWord[],
  lines: ReadonlyMap<InkWord, InkStroke>,
  block: string,
  markdown: string,
  helpers: WordHelpers,
): UnsureMark[] {
  const ids = new Map([...lines].map(([word, stroke]) => [word, stroke.id]));
  return marksFor(words, block, markdown, ids, helpers);
}

/** Reads the selected handwriting and adds the words as text below it, or inside the shape it was written in. */
export async function convertSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const strokes = surface.strokes(host.selection.get().strokes);
  const queue = host.queue.get();
  if (!handwritingAvailable(host) || !queue || strokes.length === 0 || surface.readOnly) return;
  announce(t('ink.handwriting.working'));
  const recognition = await host.handwriting!.recognize(toIntel(strokes));
  if (!recognition) return;
  const helpers = await wordHelpers();
  const read = recognition.lines.filter((line) => line.text.trim() !== '');
  const lines = read.map((line) => helpers.tidy(line.text.trim()));
  if (lines.length === 0) {
    showToast({ message: t('ink.handwriting.none') });
    return;
  }
  const box = boxOf(strokes);
  const label = shapeAround(surface, box, new Set(strokes.map((s) => s.id)));
  const markdown = label
    ? escapeParagraphText(lines.join(' '))
    : lines.map((line) => escapeParagraphText(line)).join('\n\n');
  const block = newId();
  const edit = label
    ? insertText(
        markdown,
        { x: label.minX + 8, y: (label.minY + label.maxY) / 2 - 14, w: Math.max(40, label.maxX - label.minX - 16) },
        block,
      )
    : insertText(markdown, { x: box.minX, y: box.maxY + 16, w: Math.max(220, box.maxX - box.minX) }, block);
  const words = read.flatMap((line) => line.words);
  const underlines = underlinesFor(surface, words, helpers);
  const amber = [...underlines.values()];
  try {
    surface.show(amber);
    await queue.send({ edits: [edit], ...(amber.length > 0 ? { strokes: surface.records(amber) } : {}) });
    showUnsure(host, surface, unsureMarks(words, underlines, block, markdown, helpers));
    showToast({
      id: 'ink-converted',
      message: t(label ? 'ink.handwriting.label' : 'ink.handwriting.converted'),
      action: { label: t('ink.gestures.undo'), run: () => queue.undo() },
    });
  } catch {
    surface.hide(amber.map((stroke) => stroke.id));
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

/** The line's box, in page units. */
const lineBox = (line: InkLine): Bounds => ({
  minX: line.bounds.x,
  minY: line.bounds.y,
  maxX: line.bounds.x + line.bounds.width,
  maxY: line.bounds.y + line.bounds.height,
});

/** Where the page shows a line on the screen, for finding the typed text under it. */
function clientOf(surface: InkSurface, x: number, y: number): { x: number; y: number } {
  const camera = surface.cameraNow();
  return {
    x: camera.viewport.x + x * camera.zoom - camera.scrollX,
    y: camera.viewport.y + y * camera.zoom - camera.scrollY,
  };
}

/** The edit that fades a stroke to a trace behind its words. */
const fadeEdit = (stroke: InkStroke): Edit => ({
  edit: 'restyleStrokes',
  strokes: [stroke.id],
  style: { color: [stroke.color[0], stroke.color[1], stroke.color[2], FADED_ALPHA] },
});

/** A new text box for a recognized line: its edit, its ID, and its text. */
interface Placed {
  readonly edit: Edit;
  readonly block: string;
  readonly markdown: string;
}

/**
 * What a recognized line becomes, tidied: words written in a gap of typed text go into that text, and any others
 * become a text box where they were written. Returns the text box, or null when the words went into the text.
 */
async function placeLine(
  host: InkHost,
  surface: InkSurface,
  line: InkLine,
  helpers: WordHelpers,
): Promise<Placed | null | undefined> {
  const text = helpers.tidy(line.text.trim());
  if (!text) return undefined;
  const box = lineBox(line);
  const at = clientOf(surface, box.minX, (box.minY + box.maxY) / 2);
  const inside = await host.text?.hit(at.x, at.y);
  if (inside && (await host.text?.insert(inside.block, inside.pos, `${text} `))) return null;
  const frame = { x: box.minX, y: box.minY, w: Math.max(80, box.maxX - box.minX + 24) };
  const block = newId();
  const markdown = escapeParagraphText(text);
  return { edit: insertText(markdown, frame, block), block, markdown };
}

export function createWritingPen(host: InkHost, surfaceOf: () => InkSurface | null) {
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Strokes this pen faded, so Show written ink can bring them back. */
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
    const helpers = await wordHelpers();
    const edits: Edit[] = [];
    const underlines: InkStroke[] = [];
    const marks: UnsureMark[] = [];
    for (const line of recognition.lines) {
      const placed = await placeLine(host, surface, line, helpers);
      if (placed) {
        edits.push(placed.edit);
        const lines = underlinesFor(surface, line.words, helpers);
        underlines.push(...lines.values());
        marks.push(...unsureMarks(line.words, lines, placed.block, placed.markdown, helpers));
      }
    }
    for (const stroke of strokes) faded.set(stroke.id, stroke);
    const batch = {
      edits: [...edits, ...strokes.map(fadeEdit)],
      ...(underlines.length > 0 ? { strokes: surface.records(underlines) } : {}),
    };
    surface.show([
      ...strokes.map((s) => ({ ...s, color: [s.color[0], s.color[1], s.color[2], FADED_ALPHA] as const })),
      ...underlines,
    ]);
    const ok = await surface.send(batch, () => {
      surface.show(strokes);
      surface.hide(underlines.map((u) => u.id));
    });
    if (!ok) return;
    showUnsure(host, surface, marks);
    const message = t('ink.handwriting.written', { count: recognition.lines.length });
    showToast({ id: 'ink-written', message, action: { label: t('ink.gestures.undo'), run: () => queue.undo() } });
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

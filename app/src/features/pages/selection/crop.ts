// A selection as a page of its own. The PDF export prints pages, so exporting a selection to PDF is exporting this one:
// a single sheet exactly as large as the crop, holding the selected blocks and strokes at their places. The same page
// feeds the picture export and "Save as element".

import type { ExportBlock, ExportPage, ExportStroke, InkBlock } from '../export/source';
import { round2 } from '../layout/json';
import { DEFAULT_VIEW } from '../layout/view';
import { setBackground, setCustomPaper, setLayout, setMargins, setMode } from '../layout/edit';
import { MIN_MARGIN } from '../pagination/geometry';
import { blockBox, inkOrigin, strokeLine, type SelectContext, type Selection } from './select';

export interface CropOptions extends SelectContext {
  readonly title?: string;
  /** The description of the handwriting, or an empty string to leave it out of assistive technology. */
  readonly inkAlt?: string;
}

/** The ID of the ink block that holds the strokes of a cropped page. */
export const CROP_INK = 'selection-ink';

/** A stroke moved by (dx, dy) into the crop, with its transform applied so it needs none. */
function moved(stroke: ExportStroke, origin: { x: number; y: number }, dx: number, dy: number): ExportStroke {
  const [a, b, c, d] = stroke.transform ?? [1, 0, 0, 1, 0, 0];
  const scale = Math.sqrt(Math.abs(a * d - b * c));
  const line = strokeLine(stroke, origin);
  return {
    ...stroke,
    block: CROP_INK,
    width: round2(stroke.width * scale),
    x: line.map((p) => round2(p.x + dx)),
    y: line.map((p) => round2(p.y + dy)),
    transform: null,
  };
}

function placed(block: ExportBlock, dx: number, dy: number, context: SelectContext): ExportBlock {
  const box = blockBox(block, context.boxes);
  const frame = block.frame;
  if (frame?.x !== undefined && frame.y !== undefined) {
    return { ...block, frame: { ...frame, x: round2(frame.x + dx), y: round2(frame.y + dy) } };
  }
  // A flowing block becomes a floating one where it was laid out.
  if (!box) return block;
  const wide = block.type === 'image' ? { w: round2(box.w), h: round2(box.h) } : { w: round2(box.w) };
  const turn = frame?.rotate === undefined ? {} : { rotate: frame.rotate };
  return { ...block, frame: { ...wide, x: round2(box.x + dx), y: round2(box.y + dy), ...turn } };
}

/**
 * The selection as an `ExportPage`: a freeform page with one custom sheet the size of the crop. Blocks keep their
 * order, flowing blocks become floating where they were laid out, and all selected strokes go into one ink block.
 */
export function cropPage(page: ExportPage, selection: Selection, options: CropOptions = {}): ExportPage {
  const { crop } = selection;
  const dx = -crop.x;
  const dy = -crop.y;
  const chosen = new Set(selection.blocks);
  const blocks: ExportBlock[] = page.blocks.filter((b) => chosen.has(b.id)).map((b) => placed(b, dx, dy, options));
  const wanted = new Set(selection.strokes);
  const strokes = page.strokes
    .filter((s) => wanted.has(s.id))
    .map((s) => moved(s, inkOrigin(page, s.block, options.placements), dx, dy));
  if (strokes.length > 0) {
    const alt = options.inkAlt ?? '';
    const ink: InkBlock = {
      id: CROP_INK,
      type: 'ink',
      order: '~',
      frame: { x: 0, y: 0 },
      role: 'layer',
      alt,
      decorative: alt === '',
      strokeCount: strokes.length,
    };
    blocks.push(ink);
  }
  let view = setLayout(setMode(DEFAULT_VIEW, 'paginated'), 'freeform');
  view = setCustomPaper(view, crop.w, crop.h);
  view = setMargins(view, [MIN_MARGIN, MIN_MARGIN, MIN_MARGIN, MIN_MARGIN]);
  view = setBackground(view, { pattern: 'plain' });
  const used = new Set(blocks.flatMap((b) => (b.type === 'image' || b.type === 'file' ? [b.asset] : [])));
  return {
    ...page,
    title: options.title ?? page.title,
    view: { ...view, readingOrder: page.view.readingOrder.filter((id) => chosen.has(id)) },
    blocks,
    assets: Object.fromEntries(Object.entries(page.assets).filter(([id]) => used.has(id))),
    strokes,
  };
}

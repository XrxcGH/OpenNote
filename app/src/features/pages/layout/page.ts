// The geometry a page's view settings stand for: the sheet, the geometry the flow of text lays out in, the text
// column, and the background in the form the paper generators draw. Everything here is pure.

import { contentBox, sheetGeometry, type SheetGeometry } from '../pagination/geometry';
import { flowGeometry } from '../paper/patterns';
import type { PageBackground, PaperTemplate } from '../paper/types';
import { isFlow, isPaginated, type BackgroundSpec, type PageViewSpec } from './view';

/** The narrowest text column a flow page may have, in page units. */
export const MIN_COLUMN = 120;

export interface Column {
  /** The left edge in page coordinates. */
  readonly x: number;
  readonly width: number;
}

export interface PageLayout {
  readonly view: PageViewSpec;
  /** True when the screen shows sheets. Print and export paginate whatever the mode. */
  readonly paginated: boolean;
  /** True when new blocks flow like a document. */
  readonly flow: boolean;
  /** The sheet, with margins kept within what the sheet allows. */
  readonly sheet: SheetGeometry;
  /** The sheet that the flowing text fills. Only Cornell paper makes it differ from `sheet`. */
  readonly flowSheet: SheetGeometry;
  /** The column flowing blocks lay out in. It is the same in both modes, so switching never rewraps text. */
  readonly column: Column;
  readonly background: PageBackground;
}

/** Finds a saved template by ID. The interface supplies it from the notebook's templates. */
export type TemplateLookup = (id: string) => PaperTemplate | undefined;

/** The background in the form the paper generators take. A template that can't be found draws nothing. */
export function resolveBackground(spec: BackgroundSpec, lookup?: TemplateLookup): PageBackground {
  const template = spec.template === undefined ? undefined : lookup?.(spec.template);
  return {
    pattern: spec.pattern,
    spacing: spec.spacing,
    color: spec.color,
    marginLine: spec.marginLine,
    ...(template ? { template } : {}),
  };
}

/**
 * The text column of a flow page: the whole content box, or `contentWidth` centered in it when that is narrower.
 * Both modes use the same column, because a different width would break lines in other places and move the text
 * under the pointer when the view switches.
 */
export function columnOf(flowSheet: SheetGeometry, contentWidth?: number): Column {
  const box = contentBox(flowSheet, 0);
  const width = contentWidth === undefined ? box.w : Math.min(box.w, Math.max(MIN_COLUMN, contentWidth));
  return { x: box.x + (box.w - width) / 2, width: Math.min(width, box.w) };
}

export function pageLayout(view: PageViewSpec, lookup?: TemplateLookup): PageLayout {
  const { width, height, margins } = view.paper;
  const sheet = sheetGeometry({ width, height }, margins);
  const background = resolveBackground(view.background, lookup);
  const flowSheet = flowGeometry(sheet, background);
  return {
    view,
    paginated: isPaginated(view),
    flow: isFlow(view),
    sheet,
    flowSheet,
    column: columnOf(flowSheet, view.contentWidth),
    background,
  };
}

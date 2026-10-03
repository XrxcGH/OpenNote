// Changes to a page's view, as pure functions that return the new view. The interface calls these from the page setup
// dialog and the view switch. The change is stored as the merge patch from `viewPatch` (format spec 6.2).

import {
  MARGIN_PRESETS,
  PAPER_SIZES,
  clampMargins,
  clampPaper,
  paperDimensions,
  type Margins,
  type Orientation,
  type PaperSizeName,
} from '../pagination/geometry';
import { withSpacing } from '../paper/presets';
import { diffPatch, mergeLayers, type JsonObject } from './json';
import {
  DEFAULT_VIEW,
  defaultPaperFor,
  readView,
  writeView,
  type BackgroundSpec,
  type LayoutKind,
  type PageViewSpec,
  type PaperSpec,
  type ViewMode,
} from './view';

/** A paper size is recognized when both sides are within this many page units of a standard size. */
const SIZE_TOLERANCE = 0.5;

const STANDARD = Object.entries(PAPER_SIZES) as [Exclude<PaperSizeName, 'custom'>, { width: number; height: number }][];

export interface PaperKind {
  readonly size: PaperSizeName;
  readonly orientation: Orientation;
}

/** The size name and orientation that the width and height stand for, or `custom` when they match no standard size. */
export function describePaper(width: number, height: number): PaperKind {
  const orientation: Orientation = width > height ? 'landscape' : 'portrait';
  const [short, long] = width > height ? [height, width] : [width, height];
  const match = STANDARD.find(
    ([, s]) => Math.abs(s.width - short) <= SIZE_TOLERANCE && Math.abs(s.height - long) <= SIZE_TOLERANCE,
  );
  return { size: match?.[0] ?? 'custom', orientation };
}

function withPaper(view: PageViewSpec, paper: Partial<PaperSpec>): PageViewSpec {
  const next = { ...view.paper, ...paper };
  return { ...view, paper: { ...next, margins: clampMargins(next.margins, next.width, next.height) } };
}

/** Sets a standard paper size, keeping the orientation unless a new one is given. */
export function setPaperSize(view: PageViewSpec, size: Exclude<PaperSizeName, 'custom'>, orientation?: Orientation) {
  const wanted = orientation ?? (view.paper.width > view.paper.height ? 'landscape' : 'portrait');
  const { width, height } = paperDimensions(size, wanted);
  return withPaper(view, { size, orientation: wanted, width, height });
}

/** Sets any size. The labels follow the dimensions, so a size that matches a standard one gets its name. */
export function setCustomPaper(view: PageViewSpec, width: number, height: number): PageViewSpec {
  const size = clampPaper({ width, height });
  const label = describePaper(size.width, size.height);
  return withPaper(view, { ...label, ...size });
}

/**
 * Turns the paper on its side or upright. The margins turn with it: a quarter turn clockwise to landscape, and back
 * the other way. The same edge keeps the same margin, and a round trip restores them.
 */
export function setOrientation(view: PageViewSpec, orientation: Orientation): PageViewSpec {
  const { width, height, margins } = view.paper;
  const landscape = width > height;
  if ((orientation === 'landscape') === landscape) return withPaper(view, { orientation });
  const [top, right, bottom, left] = margins;
  const turned: Margins = orientation === 'landscape' ? [left, top, right, bottom] : [right, bottom, left, top];
  return withPaper(view, { orientation, width: height, height: width, margins: turned });
}

export function setMargins(view: PageViewSpec, margins: Margins | keyof typeof MARGIN_PRESETS): PageViewSpec {
  return withPaper(view, { margins: typeof margins === 'string' ? MARGIN_PRESETS[margins] : margins });
}

export function setMode(view: PageViewSpec, mode: ViewMode): PageViewSpec {
  return { ...view, mode };
}

export function setLayout(view: PageViewSpec, layout: LayoutKind): PageViewSpec {
  return { ...view, layout };
}

export function setBackground(view: PageViewSpec, background: Partial<BackgroundSpec>): PageViewSpec {
  return { ...view, background: { ...view.background, ...background } };
}

/** Changes the spacing of ruled and grid paper, kept within the range the pattern allows. */
export function setSpacing(view: PageViewSpec, spacing: number): PageViewSpec {
  const kept = withSpacing({ pattern: view.background.pattern }, spacing);
  return setBackground(view, { spacing: kept.spacing ?? spacing });
}

/** The width of the text column of a flow page, or null to use the whole content box. */
export function setContentWidth(view: PageViewSpec, width: number | null): PageViewSpec {
  const { contentWidth: _before, ...rest } = view;
  return width === null ? rest : { ...rest, contentWidth: width };
}

/** The merge patch (RFC 7396) that turns one view into another, or null when nothing changed. */
export function viewPatch(from: PageViewSpec, to: PageViewSpec): JsonObject | null {
  return diffPatch(writeView(from), writeView(to));
}

/**
 * The view of a new page: the app's defaults for the region, then the notebook's, then the section's, field by
 * field (format spec 4.5). The notebook and the section pass their `defaults.view` objects as stored. The page
 * copies the result and then never follows later changes.
 */
export function newPageView(region: string | undefined, notebook?: JsonObject, section?: JsonObject): PageViewSpec {
  const app = writeView({ ...DEFAULT_VIEW, paper: defaultPaperFor(region) });
  return readView(mergeLayers(app, notebook, section)).view;
}

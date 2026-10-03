// A page's view settings (format spec 5.4): layout, mode, paper, and background. Reading never fails: a bad value
// falls back to its default and is reported. Unknown keys and unknown enum values are kept, as the format requires.
// Writing leaves out every default.

import { PAPER_SIZES, paperInRange, type Margins, type Orientation, type PaperSizeName } from '../pagination/geometry';
import { DEFAULT_SPACING } from '../paper/patterns';
import { geometry, isObject, round2, sameNumber, type Json, type JsonObject } from './json';

/** A value of an enum the format defines. A page from a newer writer may hold another, which readers keep. */
export type Open<T extends string> = T | (string & {});

export type LayoutKind = 'freeform' | 'flow';
export type ViewMode = 'infinite' | 'paginated';

export interface PaperSpec {
  /** A label for the interface. `width` and `height` are the truth. */
  readonly size: Open<PaperSizeName>;
  readonly orientation: Open<Orientation>;
  /** The paper in page units (1/96 inch), as oriented. */
  readonly width: number;
  readonly height: number;
  readonly margins: Margins;
  /** Keys this version doesn't know, written back unchanged. */
  readonly extra: JsonObject;
}

export interface BackgroundSpec {
  readonly pattern: string;
  readonly spacing: number;
  /** `rule`, a pen name, or a hexadecimal color. */
  readonly color: string;
  readonly marginLine: boolean;
  /** The ID of a saved template, for the `template` pattern. */
  readonly template?: string;
  readonly extra: JsonObject;
}

export interface PageViewSpec {
  readonly layout: Open<LayoutKind>;
  readonly mode: Open<ViewMode>;
  readonly paper: PaperSpec;
  readonly background: BackgroundSpec;
  /** On flow pages, the width of the text column in page units. Absent means the whole content box. */
  readonly contentWidth?: number;
  /** Block IDs in reading order (format spec 6.2). Empty means the default order. */
  readonly readingOrder: readonly string[];
  readonly extra: JsonObject;
}

export const DEFAULT_MARGINS: Margins = [72, 72, 72, 72];

export const DEFAULT_PAPER: PaperSpec = {
  size: 'letter',
  orientation: 'portrait',
  width: PAPER_SIZES.letter.width,
  height: PAPER_SIZES.letter.height,
  margins: DEFAULT_MARGINS,
  extra: {},
};

export const DEFAULT_BACKGROUND: BackgroundSpec = {
  pattern: 'plain',
  spacing: DEFAULT_SPACING,
  color: 'rule',
  marginLine: false,
  extra: {},
};

export const DEFAULT_VIEW: PageViewSpec = {
  layout: 'freeform',
  mode: 'infinite',
  paper: DEFAULT_PAPER,
  background: DEFAULT_BACKGROUND,
  readingOrder: [],
  extra: {},
};

/** The paper for a region: Letter in the United States and Canada, A4 elsewhere (format spec 4.5). */
export function defaultPaperFor(region: string | undefined): PaperSpec {
  const letter = region !== undefined && ['US', 'CA'].includes(region.toUpperCase());
  const size = letter ? PAPER_SIZES.letter : PAPER_SIZES.a4;
  return { ...DEFAULT_PAPER, size: letter ? 'letter' : 'a4', width: size.width, height: size.height };
}

export type ViewWarningKind = 'badValue' | 'noArea' | 'paperSize' | 'badMargins';

export interface ViewWarning {
  readonly kind: ViewWarningKind;
  /** The field, such as `paper.width`. */
  readonly path: string;
}

export interface ViewRead {
  readonly view: PageViewSpec;
  readonly warnings: readonly ViewWarning[];
}

const PAPER_KEYS = ['size', 'orientation', 'width', 'height', 'margins'];
const BACKGROUND_KEYS = ['pattern', 'spacing', 'color', 'marginLine', 'template'];
const VIEW_KEYS = ['layout', 'mode', 'paper', 'background', 'contentWidth', 'readingOrder'];

function rest(source: JsonObject, known: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !known.includes(key)));
}

class Reader {
  readonly warnings: ViewWarning[] = [];

  /** A number field: the default when absent, and the default with a warning when it is not a valid number. */
  num(source: JsonObject, key: string, path: string, fallback: number): number {
    if (!(key in source)) return fallback;
    const value = geometry(source[key]);
    if (value === null) this.warnings.push({ kind: 'badValue', path: `${path}${key}` });
    return value ?? fallback;
  }

  str(source: JsonObject, key: string, path: string, fallback: string): string {
    if (!(key in source)) return fallback;
    const value = source[key];
    if (typeof value === 'string') return value;
    this.warnings.push({ kind: 'badValue', path: `${path}${key}` });
    return fallback;
  }

  paper(raw: Json | undefined): PaperSpec {
    const source = isObject(raw) ? raw : {};
    const size = this.str(source, 'size', 'paper.', DEFAULT_PAPER.size);
    const orientation = this.str(source, 'orientation', 'paper.', DEFAULT_PAPER.orientation);
    let width = this.num(source, 'width', 'paper.', DEFAULT_PAPER.width);
    let height = this.num(source, 'height', 'paper.', DEFAULT_PAPER.height);
    if (width <= 0 || height <= 0 || !paperInRange({ width, height })) {
      // A paper of no area, or one far smaller or larger than any printer takes, would plan millions of sheets or
      // pattern marks.
      this.warnings.push({ kind: width <= 0 || height <= 0 ? 'noArea' : 'paperSize', path: 'paper' });
      width = DEFAULT_PAPER.width;
      height = DEFAULT_PAPER.height;
    }
    return { size, orientation, width, height, margins: this.margins(source.margins), extra: rest(source, PAPER_KEYS) };
  }

  margins(raw: Json | undefined): Margins {
    if (raw === undefined) return DEFAULT_MARGINS;
    const values = Array.isArray(raw) && raw.length === 4 ? raw.map(geometry) : null;
    if (values?.every((v): v is number => v !== null)) return values as unknown as Margins;
    this.warnings.push({ kind: 'badMargins', path: 'paper.margins' });
    return DEFAULT_MARGINS;
  }

  background(raw: Json | undefined): BackgroundSpec {
    const source = isObject(raw) ? raw : {};
    const marginLine = 'marginLine' in source ? source.marginLine : false;
    if (typeof marginLine !== 'boolean') this.warnings.push({ kind: 'badValue', path: 'background.marginLine' });
    const template = typeof source.template === 'string' ? source.template : undefined;
    return {
      pattern: this.str(source, 'pattern', 'background.', DEFAULT_BACKGROUND.pattern),
      spacing: this.num(source, 'spacing', 'background.', DEFAULT_BACKGROUND.spacing),
      color: this.str(source, 'color', 'background.', DEFAULT_BACKGROUND.color),
      marginLine: marginLine === true,
      ...(template === undefined ? {} : { template }),
      extra: rest(source, BACKGROUND_KEYS),
    };
  }
}

/** The IDs once each, in order, without anything that isn't a string. */
function idList(raw: Json | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string'))];
}

/** Reads a page's `view` object. Anything that isn't valid falls back to its default and is reported. */
export function readView(raw: unknown): ViewRead {
  const source: JsonObject = isObject(raw) ? raw : {};
  const reader = new Reader();
  const contentWidth = 'contentWidth' in source ? geometry(source.contentWidth) : null;
  if ('contentWidth' in source && contentWidth === null)
    reader.warnings.push({ kind: 'badValue', path: 'contentWidth' });
  const view: PageViewSpec = {
    layout: reader.str(source, 'layout', '', DEFAULT_VIEW.layout),
    mode: reader.str(source, 'mode', '', DEFAULT_VIEW.mode),
    paper: reader.paper(source.paper),
    background: reader.background(source.background),
    ...(contentWidth === null ? {} : { contentWidth }),
    readingOrder: idList(source.readingOrder),
    extra: rest(source, VIEW_KEYS),
  };
  return { view, warnings: reader.warnings };
}

function sameMargins(a: Margins, b: Margins): boolean {
  return a.every((v, i) => sameNumber(v, b[i]));
}

function writePaper(paper: PaperSpec): JsonObject {
  const d = DEFAULT_PAPER;
  const out: Record<string, Json> = {};
  if (paper.size !== d.size) out.size = paper.size;
  if (paper.orientation !== d.orientation) out.orientation = paper.orientation;
  if (!sameNumber(paper.width, d.width)) out.width = round2(paper.width);
  if (!sameNumber(paper.height, d.height)) out.height = round2(paper.height);
  if (!sameMargins(paper.margins, d.margins)) out.margins = paper.margins.map(round2);
  return { ...paper.extra, ...out };
}

function writeBackground(bg: BackgroundSpec): JsonObject {
  const d = DEFAULT_BACKGROUND;
  const out: Record<string, Json> = {};
  if (bg.pattern !== d.pattern) out.pattern = bg.pattern;
  if (!sameNumber(bg.spacing, d.spacing)) out.spacing = round2(bg.spacing);
  if (bg.color !== d.color) out.color = bg.color;
  if (bg.marginLine) out.marginLine = true;
  if (bg.template !== undefined) out.template = bg.template;
  return { ...bg.extra, ...out };
}

/** The view as page.json stores it: values equal to their defaults are left out (format spec 2.2). */
export function writeView(view: PageViewSpec): JsonObject {
  const out: Record<string, Json> = {};
  if (view.layout !== DEFAULT_VIEW.layout) out.layout = view.layout;
  if (view.mode !== DEFAULT_VIEW.mode) out.mode = view.mode;
  const paper = writePaper(view.paper);
  if (Object.keys(paper).length > 0) out.paper = paper;
  const background = writeBackground(view.background);
  if (Object.keys(background).length > 0) out.background = background;
  if (view.contentWidth !== undefined) out.contentWidth = round2(view.contentWidth);
  if (view.readingOrder.length > 0) out.readingOrder = [...new Set(view.readingOrder)];
  return { ...view.extra, ...out };
}

/** True for a page that shows sheets of paper. A mode this version doesn't know is shown as infinite. */
export function isPaginated(view: PageViewSpec): boolean {
  return view.mode === 'paginated';
}

/** True for a page whose new blocks stack like a document. A layout this version doesn't know is freeform. */
export function isFlow(view: PageViewSpec): boolean {
  return view.layout === 'flow';
}

// The data of the Layout tab, read the way the spec says (6.11 and 6.12): columns of a text block, vertical writing in
// a floating text box, and break blocks. Reading never fails: a value out of range reads as its default.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A point in CSS pixels. */
export const PX_PER_POINT = 96 / 72;

export const MAX_COLUMNS = 4;
export const DEFAULT_GAP = 36;
export const MAX_GAP = 1584;

/** The `layout` of a text block (R-LAY-1). */
export interface TextLayout {
  /** 1 to 4 newspaper columns. */
  readonly columns: number;
  /** The space between columns, in points. */
  readonly gap: number;
  /** A line between columns. */
  readonly rule: boolean;
  /** Vertical writing: lines run top to bottom and stack from right to left (floating text boxes). */
  readonly vertical: boolean;
}

export const DEFAULT_TEXT_LAYOUT: TextLayout = { columns: 1, gap: DEFAULT_GAP, rule: false, vertical: false };

/** Reads a text block's `data.layout`. */
export function readTextLayout(data: unknown): TextLayout {
  const raw = isObject(data) && isObject(data.layout) ? data.layout : {};
  const columns =
    typeof raw.columns === 'number' && Number.isInteger(raw.columns) && raw.columns >= 1 && raw.columns <= MAX_COLUMNS
      ? raw.columns
      : 1;
  const gap =
    typeof raw.gap === 'number' && Number.isFinite(raw.gap) && raw.gap >= 0 && raw.gap <= MAX_GAP
      ? Math.round(raw.gap * 20) / 20
      : DEFAULT_GAP;
  return { columns, gap, rule: raw.rule === true, vertical: raw.vertical === true };
}

/** What the style of a laid out block holds, in CSS property names with the values CSS takes. */
export interface LayoutCss {
  readonly columnCount?: number;
  readonly columnGap?: string;
  readonly columnRule?: string;
  readonly writingMode?: string;
}

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

/** The CSS of a layout: `column-count`, the gap in pixels from points, and the writing mode. Empty for the default. */
export function layoutCss(layout: TextLayout): LayoutCss {
  return {
    ...(layout.columns > 1
      ? {
          columnCount: layout.columns,
          columnGap: px(layout.gap * PX_PER_POINT),
          ...(layout.rule ? { columnRule: '1px solid currentColor' } : {}),
        }
      : {}),
    ...(layout.vertical ? { writingMode: 'vertical-rl' } : {}),
  };
}

/** The same CSS as the text of a `style` attribute. */
export function layoutStyle(layout: TextLayout): string {
  const css = layoutCss(layout);
  return [
    css.columnCount !== undefined ? `column-count:${css.columnCount}` : '',
    css.columnGap ? `column-gap:${css.columnGap}` : '',
    css.columnRule ? `column-rule:${css.columnRule}` : '',
    css.writingMode ? `writing-mode:${css.writingMode}` : '',
  ]
    .filter((part) => part !== '')
    .join(';');
}

/**
 * The merge patch that sets a text block's layout keys. A key set to its default is removed, and a layout with no
 * keys left is removed, so a block that goes back to one column is as it was.
 */
export function layoutPatch(
  data: unknown,
  change: Partial<TextLayout>,
): { readonly layout: Record<string, unknown> | null } {
  const raw = isObject(data) && isObject(data.layout) ? { ...data.layout } : {};
  const defaults: Record<keyof TextLayout, unknown> = { columns: 1, gap: DEFAULT_GAP, rule: false, vertical: false };
  for (const [key, value] of Object.entries(change)) {
    if (value === defaults[key as keyof TextLayout]) delete raw[key];
    else raw[key] = value;
  }
  // A gap or a rule means nothing without columns, but the person may have set them first, so they stay.
  return { layout: Object.keys(raw).length === 0 ? null : raw };
}

export type BreakKind = 'page' | 'column';

/** A break block's kind (R-BRK-1): `column` or, for anything else, `page`. */
export function readBreakKind(data: unknown): BreakKind {
  return isObject(data) && data.kind === 'column' ? 'column' : 'page';
}

/** The fallback every break carries (R-BRK-2): a version 1 reader shows a divider. */
export const BREAK_FALLBACK = { markdown: '---' } as const;

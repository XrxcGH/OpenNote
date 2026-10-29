// Wrapping text around an image. In a flow page an image can sit left or right
// with the text wrapping around it, stay in the line beside other images, or stand alone as it always has. The mode
// and the gap to the text are kept in the image block's data as `wrap` and `wrapGap`: the format keeps keys it does
// not know, so they travel with the page. Floating images ignore them, because they sit at their own frame.

export type Wrap = 'alone' | 'inline' | 'left' | 'right';

export const WRAPS: readonly Wrap[] = ['alone', 'inline', 'left', 'right'];

/** The gap between an image and the text wrapped around it, in page units. */
export const DEFAULT_WRAP_GAP = 16;
export const MAX_WRAP_GAP = 64;

export function wrapOf(data: Record<string, unknown>): Wrap {
  return data.wrap === 'inline' || data.wrap === 'left' || data.wrap === 'right' ? data.wrap : 'alone';
}

export function wrapGapOf(data: Record<string, unknown>): number {
  const gap = data.wrapGap;
  return typeof gap === 'number' && Number.isFinite(gap)
    ? Math.min(MAX_WRAP_GAP, Math.max(0, Math.round(gap)))
    : DEFAULT_WRAP_GAP;
}

/** The merge patch for a wrap and a gap. Standing alone, with the usual gap, leaves nothing in the data. */
export function wrapPatch(wrap: Wrap, gap: number): Record<string, unknown> {
  const clean = Math.min(MAX_WRAP_GAP, Math.max(0, Math.round(gap)));
  return {
    wrap: wrap === 'alone' ? null : wrap,
    wrapGap: wrap === 'left' || wrap === 'right' ? (clean === DEFAULT_WRAP_GAP ? null : clean) : null,
  };
}

/** A merge patch applied to block data (RFC 7396): null removes a key. */
export function mergeData(data: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

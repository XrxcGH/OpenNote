// The kit figure block's data in page.json: which kit and tool drew it, the inputs to reopen it with, the SVG, its
// alternative text, and a summary. The page shows the SVG only as an image from a data URL, never as markup in the
// page, so a script in a stored or imported figure cannot run. The fallback text is the summary, so search and
// export keep the words.

/** The largest SVG a figure keeps; a larger drawing is better inserted as a picture. */
export const SVG_LIMIT = 512 * 1024;
/** The largest inputs a figure keeps; larger ones are dropped and the figure can no longer reopen its tool. */
export const FIGURE_INPUT_LIMIT = 64 * 1024;

export interface KitFigureData {
  kit: string;
  tool: string;
  inputs: unknown;
  svg: string;
  alt: string;
  summary: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return Infinity;
  }
}

/** True for text that is one SVG document and nothing else. */
export const isSvg = (svg: string): boolean => /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg) && /<\/svg>\s*$/i.test(svg);

/** The figure as the block stores it: inputs dropped when too large, an SVG that is too large or not one emptied. */
export function kitFigureData(figure: KitFigureData): KitFigureData {
  const svg = figure.svg.length <= SVG_LIMIT && isSvg(figure.svg) ? figure.svg : '';
  return {
    kit: figure.kit,
    tool: figure.tool,
    inputs: sizeOf(figure.inputs) <= FIGURE_INPUT_LIMIT ? (figure.inputs ?? null) : null,
    svg,
    alt: figure.alt,
    summary: figure.summary,
  };
}

/** Reads a block's stored data, whatever a newer version or a hand-edited file left in it. */
export function readKitFigure(data: Record<string, unknown>): KitFigureData {
  return kitFigureData({
    kit: text(data.kit),
    tool: text(data.tool),
    inputs: data.inputs ?? null,
    svg: text(data.svg),
    alt: text(data.alt),
    summary: text(data.summary),
  });
}

/** The fallback text: the summary, or the alternative text when there is no summary. */
export const kitFigureFallback = (figure: KitFigureData): string => figure.summary || figure.alt;

/** The SVG as a data URL for an <img>. */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
